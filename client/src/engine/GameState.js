import { Enemy } from './Enemy.js';
import { WaveManager } from './WaveManager.js';
import { Player } from './Player.js';
import { EquipmentManager } from './EquipmentManager.js';
import { ModifierPipeline } from './ModifierPipeline.js';
import { XpOrbSystem } from './XpOrbSystem.js';
import { GroundZoneSystem } from './GroundZoneSystem.js';
import { BossManager } from './BossManager.js';
import { SeededRNG } from './SeededRNG.js';
import { distanceCells, GRID } from './GridConstants.js';

let nextProjectileId = 1;

export class GameState {
  constructor(enemyConfigs, balanceConfig, equipmentData = [], levelRuntime = null, { globalUpgrades = null, forgeSystem = null, equippedMap = null, bossConfig = null, vipSystem = null, mercenarySystem = null, rngSeed = Date.now() } = {}) {
    this.rng = new SeededRNG(rngSeed);
    this.wallRow = GRID.ROWS; // 城墙线：敌人越过 row 12 即漏怪

    this.enemyConfigs = enemyConfigs;
    this.balance = balanceConfig;
    this.levelRuntime = levelRuntime;
    this.globalUpgrades = globalUpgrades; // GlobalUpgradeSystem 实例（可空）
    this.forgeSystem = forgeSystem;       // EquipmentForgeSystem 实例（可空）
    this.equippedMap = equippedMap;       // { slot: uid }（可空）
    this.mercenarySystem = mercenarySystem; // MercenarySystem 实例（v4.4 起替代宠物系统）
    this._mercTimers = [0, 0];
    this.bossConfig = bossConfig;         // boss.json.bosses（可空）
    this.bossManager = new BossManager();
    this.vipSystem = vipSystem;           // VipSystem 实例（可空，§13.4 金币加成走管线封顶）
    this.playerSilenceTimer = 0;          // roar 击晕玩家技能
    this._roarPendings = [];              // [{delay, silenceSeconds}]
    const wallBonus = globalUpgrades ? globalUpgrades.getWallHpBonus() : 0;
    this.wallHpMax = (levelRuntime?.wallHp ?? balanceConfig.startingLives) + wallBonus;
    this.waveManager = new WaveManager(balanceConfig, enemyConfigs, levelRuntime);
    this.equipmentManager = new EquipmentManager(equipmentData);

    this.player = new Player();
    this.modifiers = new ModifierPipeline(balanceConfig.modifierCap);
    this.xpOrbs = new XpOrbSystem(this.player);
    this.groundZones = new GroundZoneSystem();
    this.gold = balanceConfig.startingGold;
    this.lives = this.wallHpMax;
    this.score = 0;

    this.enemies = [];
    this.projectiles = [];
    this.gameOver = false;
    this.events = [];
    this.pendingItem = null;
    this.pendingLoot = []; // 本局拾取的装备暂存栏（战斗零打断，结算时统一处理）

    this.speed = 1;
    this.paused = false;
    this.invulnTimer = 0; // 复活无敌

    // 枪械弹匣（原版：弹夹默认 30 发）
    this.magazineSize = 30;
    this.ammo = 30;
    this.reloadTime = 1.5;
    this.reloadTimer = 0;
    this._reloading = false;

    this.leakedThisWave = 0;
    this.killedThisWave = 0;

    // 自动出波：首波 3 秒，波间 5 秒
    this.autoWave = balanceConfig.autoWave || { firstWaveDelay: 3, interWaveDelay: 5 };
    this.waveCountdown = this.autoWave.firstWaveDelay;
  }

  startWave() {
    if (this.waveManager.waveActive) return null;
    this.waveCountdown = 0;
    this.leakedThisWave = 0;
    this.killedThisWave = 0;
    return this.waveManager.startWave(this.rng);
  }

  /**
   * 施放技能。target 为落点（网格坐标）：
   * - projectile: 英雄向落点发射弹道（无敌人也可发射，落点爆炸）
   * - aoe: 以落点为中心的范围打击
   * - chain: 从落点最近的敌人开始链式跳跃
   * 自动射击仍走 useSkill('attack') 无落点 → 追踪最近敌人。
   */
  useSkill(skillId, targetCol = null, targetRow = null) {
    const hasTarget = targetCol !== null && targetRow !== null;
    const result = this.player.useSkill(skillId, hasTarget ? targetCol : this.player.x, hasTarget ? targetRow : this.player.y);
    if (!result) return null;
    const affected = [];
    const skill = this.player.skills.find(s => s.id === skillId);
    const stats = this.getResolvedStats();
    const tx = hasTarget ? targetCol : this.player.x;
    const ty = hasTarget ? targetRow : this.player.y;

    if (result.type === 'projectile') {
      // 弹道技（温压弹/干冰弹）：落点飞行+爆炸；干冰弹冻结效果由 effect 携带
      if (hasTarget) {
        this._createProjectile(skillId, this.player.x, this.player.y, tx, ty, {
          damage: this._rollDamage(stats, skill.damage), aoe: skill.aoe || 0, effect: skill.effect || null,
          targetEnemy: null, color: this._getSkillColor(skillId),
          size: skillId === 'thermobaric' ? 5 : 3, speed: skillId === 'thermobaric' ? 14 : 20,
        });
      } else {
        // 自动射击路径：弹道技锁定最近敌人
        const targets = this.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
        if (targets.length > 0) {
          const target = targets[0];
          this._createProjectile(skillId, this.player.x, this.player.y, target.col, target.row, {
            damage: this._rollDamage(stats, skill.damage), aoe: skill.aoe || 0, effect: skill.effect || null,
            targetEnemy: target, color: this._getSkillColor(skillId),
            size: skillId === 'thermobaric' ? 5 : 3, speed: skillId === 'thermobaric' ? 14 : 20,
          });
        }
      }
    } else if (result.type === 'zone') {
      // 地面区域场：燃油弹（燃烧区）/ 冰暴（冻结场）/ 死亡爆炸等
      // 节点效果：thermobaric[热能燃爆]→灼烧翻倍；fuelbomb[点燃死亡留火区]→标记
      const hasThermalIgnite = result.milestones?.includes('thermalIgnite');
      this.groundZones.spawn({
        col: tx, row: ty, radius: result.aoe,
        duration: result.effect?.duration || 4,
        tickDamage: result.effect?.type === 'burn'
          ? (result.effect.damage || 5) * (hasThermalIgnite ? 2 : 1)
          : (result.damage * 0.15),
        slowFactor: null, freezeOnEnter: result.effect?.type === 'freeze' ? (result.effect.duration || 1.5) : 0,
        color: this._getSkillColor(skillId),
        onDeathLeaveZone: result.milestones?.includes('igniteOnDeath') || false,
      });
      // 落地瞬间的一次性伤害
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(tx, ty, e.col, e.row) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          this._hitEnemy(e, damage, { element: skill.element, skill: skillId });
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed: !e.alive, skill: skillId });
          if (!e.alive) this._onKill(e);
        }
      }
      this.events.push({ type: 'zoneEffect', skill: skillId, x: tx, y: ty, radius: result.aoe, color: this._getSkillColor(skillId) });
    } else if (result.type === 'pierceLine') {
      // 直线穿透（电磁穿刺/压缩气刃）：英雄到落点方向的整条线上敌人全吃伤害
      const dx = tx - this.player.x, dy = ty - this.player.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const vx = e.col - this.player.x, vy = e.row - this.player.y;
        const proj = vx * ux + vy * uy; // 在线上的投影长度
        if (proj < 0) continue;
        const perp = Math.abs(vx * uy - vy * ux); // 到线的垂距
        if (perp <= 0.7) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (result.effect) this._applyEffect(e, result.effect);
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'lineEffect', skill: skillId, x: this.player.x, y: this.player.y, ux, uy });
    } else if (result.type === 'cone') {
      // 扇形吹退（旋风加农）：英雄前方扇形内敌人受击退
      const dx = tx - this.player.x, dy = ty - this.player.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dist = distanceCells(this.player.x, this.player.y, e.col, e.row);
        if (dist > result.range + result.aoe) continue;
        const dot = ((e.col - this.player.x) * dx + (e.row - this.player.y) * dy) / (len * dist || 1);
        if (dot > 0.4) { // 半张角约 66°
          const kbPower = result.effect?.power || 2.5;
          e.knockback(kbPower);
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'coneEffect', skill: skillId, x: this.player.x, y: this.player.y, tx, ty });
    } else if (result.type === 'guided') {
      // 制导（制导激光/制导电磁）：锁定全场最高 HP 敌人大额伤害
      const target = this.enemies.filter(e => e.alive).sort((a, b) => b.hp - a.hp)[0];
      if (target) {
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
        this._hitEnemy(target, damage, { element: skill.element, skill: skillId });
        this.events.push({ type: 'hit', target, damage, isCrit, killed: !target.alive, skill: skillId });
        if (result.effect && target.alive) this._applyEffect(target, result.effect);
        if (!target.alive) this._onKill(target);
        this.events.push({ type: 'guidedEffect', skill: skillId, targetId: target.id, col: target.col, row: target.row });
      }
    } else if (result.type === 'sweep') {
      // 装甲车：从英雄所在行横向扫过整行（穿透+概率眩晕）
      const row = ty;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.row - row) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (result.effect && this.rng.next() < 0.5) this._applyEffect(e, result.effect); // 50% 眩晕
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'sweepEffect', skill: skillId, row, dir: tx >= this.player.x ? 1 : -1 });
    } else if (result.type === 'airstrike') {
      // 空投轰炸：延迟 0.4s 落地的大范围爆炸（覆盖落点圈）
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(tx, ty, e.col, e.row) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'aoeImpact', x: tx, y: ty, radius: result.aoe, color: 0xffcc44 });
    } else if (result.type === 'beam') {
      // 镭射：贯穿落点所在整列（从英雄到屏幕顶部），命中路径上所有敌人
      const col = tx;
      let hitAny = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.col - col) <= 0.6) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (result.effect) this._applyEffect(e, result.effect);
          if (killed) this._onKill(e);
          hitAny = true;
        }
      }
      this.events.push({ type: 'beamEffect', skill: skillId, col, fromRow: this.player.y, toRow: -1 });
    } else if (result.type === 'drone') {
      // 无人机：轰炸距离落点最近的敌人（周期性自动施放的定点小爆炸）
      const anchor = this.enemies
        .filter(e => e.alive)
        .sort((a, b) => distanceCells(tx, ty, a.col, a.row) - distanceCells(tx, ty, b.col, b.row))[0];
      const bx = anchor ? anchor.col : tx, by = anchor ? anchor.row : ty;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(bx, by, e.col, e.row) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'aoeImpact', x: bx, y: by, radius: result.aoe, color: this._getSkillColor(skillId) });
    } else if (result.type === 'aoe') {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const dist = distanceCells(tx, ty, enemy.col, enemy.row);
        if (dist <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
          const killed = enemy.takeDamage(damage);
          this.events.push({ type: 'hit', target: enemy, damage, isCrit, killed, skill: skillId });
          affected.push({ enemy, killed });
          if (result.effect) this._applyEffect(enemy, result.effect);
          if (killed) this._onKill(enemy);
        }
      }
      this.events.push({ type: 'skillEffect', skill: skillId, x: tx, y: ty, range: result.aoe });
    } else if (result.type === 'chain') {
      // 从落点附近最近的敌人起链；落点无敌人则空放（仍播特效）
      const anchor = this.enemies
        .filter(e => e.alive)
        .sort((a, b) => distanceCells(tx, ty, a.col, a.row) - distanceCells(tx, ty, b.col, b.row))[0];
      let cx = tx, cy = ty;
      const hit = new Set();
      if (anchor) {
        // 锚点敌人吃满第一跳伤害
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
        const killed = anchor.takeDamage(damage);
        this.events.push({ type: 'hit', target: anchor, damage, isCrit, killed, chain: true, chainFrom: { col: cx, row: cy }, skill: skillId });
        affected.push({ enemy: anchor, killed });
        if (killed) this._onKill(anchor);
        cx = anchor.col; cy = anchor.row;
        hit.add(anchor.id);
      }
      const targets = this.enemies.filter(e => e.alive).sort((a, b) => a.row - b.row);
      let jumped = hit.size;
      for (let i = jumped; i < (skill.chain || 3) && i < targets.length; i++) {
        const enemy = targets.find(t => !hit.has(t.id));
        if (!enemy) break;
        hit.add(enemy.id);
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty);
        const killed = enemy.takeDamage(damage);
        this.events.push({ type: 'hit', target: enemy, damage, isCrit, killed, chain: true, chainFrom: { col: cx, row: cy }, skill: skillId });
        affected.push({ enemy, killed });
        if (killed) this._onKill(enemy);
        cx = enemy.col; cy = enemy.row;
      }
      this.events.push({ type: 'skillEffect', skill: skillId, x: cx, y: cy, chainTo: affected.map(a => ({ col: a.enemy.col, row: a.enemy.row })) });
    }
    return { result, affected };
  }

  /** Resolve base damage through the modifier pipeline with a crit roll. enemyRow 可选：启用距离系数 */
  _rollDamageWithCrit(stats, baseDamage, enemyRow = null) {
    let dmg = stats.damage * baseDamage;
    if (enemyRow !== null) dmg *= this._distanceMultiplier(enemyRow);
    const isCrit = this.rng.next() < stats.critRate;
    if (isCrit) dmg *= stats.critDamage; // 暴击倍率（原版此前缺失，静默 bug 已修）
    return { damage: dmg, isCrit };
  }

  /** Resolve base damage without a separate crit roll (crit decided on projectile impact). */
  _rollDamage(stats, baseDamage) {
    return stats.damage * baseDamage;
  }

  /**
   * Resolve all player stats through the modifier pipeline.
   * attackSpeed 约定：skills/equipment 配置里用负 mul_pct 表示"更快"（缩短间隔），此处换算为攻速倍率。
   */
  getResolvedStats() {
    const mods = [
      ...this.equipmentManager.getAllModifiers(),
      ...(this.forgeSystem ? this.forgeSystem.getEquippedModifiers(this.equippedMap || {}) : []),
      ...(this.vipSystem ? this.vipSystem.getAllModifiers() : []),
      ...(this.player.pendingStatMods || []),
      ...(this.globalUpgrades ? this.globalUpgrades.getAllModifiers() : []),
    ];
    // 佣兵被动攻击加成（拥有即生效，原版核心）：以 add 注入枪械伤害基数
    if (this.mercenarySystem) {
      const mercAtk = this.mercenarySystem.getTotalPassiveAttack();
      if (mercAtk > 0) {
        mods.push({ id: 'merc_passive_atk', source: 'mercenary', stat: 'damage', type: 'add', value: mercAtk / 10 }); // 攻击力/10 → 技能伤害加成映射
      }
    }
    const baseDamage = 1, baseCritRate = 0.05, baseCritDamage = 1.25;
    const attackIntervalScale = this.modifiers.resolve(1, 'attackSpeed', mods); // <1 = faster
    const attackSpeed = attackIntervalScale > 0 ? 1 / attackIntervalScale : 1;
    return {
      damage: this.modifiers.resolve(baseDamage, 'damage', mods),
      attackSpeed,
      range: this.modifiers.resolve(0, 'range', mods),
      critRate: this.modifiers.resolve(baseCritRate, 'critRate', mods),
      // 原版暴击伤害成长曲线（玩家等级分段递增），基础倍率 125%
      critDamage: this.modifiers.resolve(baseCritDamage + this._critDamageGrowth(), 'critDamage', mods),
      goldBonus: this.modifiers.resolve(1, 'goldBonus', mods),
    };
  }

  _createProjectile(skillId, fromCol, fromRow, toCol, toRow, opts) {
    // 方向速度弹（反弹球）：给 bouncesLeft 时按"方向+速率"飞行而非追点
    const isDirectional = opts.bouncesLeft !== undefined;
    let dirX = 0, dirY = 0, speed = opts.speed || 18;
    if (isDirectional) {
      const dx = toCol - fromCol, dy = toRow - fromRow;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dirX = dx / len; dirY = dy / len;
    }
    this.projectiles.push({
      id: nextProjectileId++, skillId, col: fromCol, row: fromRow,
      targetCol: toCol, targetRow: toRow, targetEnemy: opts.targetEnemy,
      damage: opts.damage, aoe: opts.aoe || 0, effect: opts.effect || null,
      color: opts.color || 0xffffff, size: opts.size || 3, speed,
      pierceLeft: opts.pierce || 0, hitIds: new Set(), trail: [], alive: true,
      splitGen: opts.splitGen || 0,
      // 弹射球专用
      directional: isDirectional, dirX, dirY,
      bouncesLeft: opts.bouncesLeft ?? null, lifespan: opts.lifespan ?? null,
    });
  }

  _getSkillColor(id) {
    return {
      attack: 0xffffff, thermobaric: 0xff6600, fuelbomb: 0xff4400, empierce: 0xffff00,
      dryice: 0x66ddff, icestorm: 0x88eeff, cyclone: 0xaaffcc, airblade: 0xccffdd,
      ray: 0xff2266, guidedlaser: 0xff66aa, vehicle: 0xccaa66, airstrike: 0xffcc44,
      drone: 0x88ddff,
    }[id] || 0xffffff;
  }

  _applyEffect(enemy, effect) {
    // 狂暴巨人免疫控制（晕眩/减速/冻结）
    const isControl = ['stun', 'freeze', 'slow', 'knockback'].includes(effect.type);
    if (enemy.enraged && isControl) return;
    if (effect.type === 'slow') { enemy.slowFactor = effect.factor; enemy.slowTimer = effect.duration; }
    else if (effect.type === 'dot' || effect.type === 'burn') { enemy.dotEffects.push({ damage: effect.damage, duration: effect.duration }); }
    else if (effect.type === 'stun') { enemy.stunTimer = Math.max(enemy.stunTimer, effect.duration); }
    else if (effect.type === 'freeze') enemy.freeze(effect.duration);
    else if (effect.type === 'knockback') enemy.knockback(effect.power || 1.5);
  }

  _onKill(enemy) {
    const stats = this.getResolvedStats();
    const bounty = Math.round(enemy.bounty * stats.goldBonus);
    this.gold += bounty;
    this.score += bounty;
    this.killedThisWave++;
    // 经验球：击杀掉球，吸附到英雄时结算 XP（加成在吸收时算）
    this.xpOrbs.spawn(enemy.col, enemy.row, 1, () => this.rng.next());
    const drop = this.equipmentManager.rollDrop(this.rng);
    if (drop) { this.pendingLoot.push(drop); this.events.push({ type: 'itemDrop', item: drop }); }

    // Split behavior: spawn children at the parent's position (children give no bounty)
    const split = enemy.getSplitConfig();
    if (split && !enemy._isSplitChild) {
      const childConfig = this.enemyConfigs.find(c => c.id === split.enemyId) || this.enemyConfigs[0];
      for (let i = 0; i < split.count; i++) {
        const child = new Enemy(childConfig, enemy.col + (i - (split.count - 1) / 2) * 0.5, enemy.row, 1, this.rng);
        child._isSplitChild = true;
        child.bounty = 0; // 防 cheese：分裂子体无赏金
        this.enemies.push(child);
      }
    }

    // BOSS 击杀：固定奖励（不进即时赏金）+ 清除 BOSS 状态
    if (enemy.isBoss) {
      this.gold += enemy.bossReward?.gold || 500;
      this.bossRewardDiamond = (this.bossRewardDiamond || 0) + (enemy.bossReward?.diamond || 0);
      this.score += (enemy.bossReward?.gold || 500);
      this.bossManager.clear();
      this.events.push({ type: 'bossKill', bossId: enemy.id, gold: enemy.bossReward?.gold || 500, diamond: enemy.bossReward?.diamond || 0 });
    }

    // 连锁爆炸被动：击杀时小范围爆炸（40% 伤害 × 该被动等级）
    const boomLv = this.player.getPassiveLevel('chainboom');
    if (boomLv > 0) {
      const dmg = this.getResolvedStats().damage * 20 * 0.4 * boomLv;
      for (const other of this.enemies) {
        if (!other.alive || other === enemy) continue;
        if (distanceCells(enemy.col, enemy.row, other.col, other.row) <= 1.0) {
          const killed = other.takeDamage(dmg);
          this.events.push({ type: 'hit', target: other, damage: dmg, isCrit: false, killed, skill: 'chainboom' });
          if (killed) this._onKill(other);
        }
      }
      this.events.push({ type: 'aoeImpact', x: enemy.col, y: enemy.row, radius: 1.0, color: 0xffaa33 });
    }
  }

  update(dt) {
    if (this.gameOver || this.paused) return null;
    dt *= this.speed;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    // 自动出波倒计时（波间递减，到 0 自动开波）
    if (!this.waveManager.waveActive && this.waveCountdown > 0) {
      this.waveCountdown -= dt;
      if (this.waveCountdown <= 0) {
        this.waveCountdown = 0;
        this.startWave();
      }
    }

    // Spawn
    const spawn = this.waveManager.update(dt);
    if (spawn) {
      const enemy = new Enemy(spawn.config, spawn.spawnCol, spawn.spawnRow, spawn.difficultyMultiplier, this.rng);
      this.enemies.push(enemy);
    }

    // BOSS 生成：BOSS 波开始时生成一次
    if (this.waveManager.waveActive && this.waveManager.bossWave && !this._bossSpawnedForWave) {
      this._bossSpawnedForWave = true;
      this._spawnBoss();
    }
    if (!this.waveManager.waveActive) this._bossSpawnedForWave = false;

    // BOSS 技能推进
    const bossEvents = this.bossManager.update(dt, {
      spawnEnemyFn: (enemyId) => this._spawnMinion(enemyId),
    });
    for (const ev of bossEvents) {
      this.events.push(ev);
      if (ev.type === 'warnRoar') this._roarPendings.push({ delay: ev.warnSeconds, silenceSeconds: ev.silenceSeconds });
    }
    // roar 预警落地
    for (let i = this._roarPendings.length - 1; i >= 0; i--) {
      this._roarPendings[i].delay -= dt;
      if (this._roarPendings[i].delay <= 0) {
        this.player.silencedTimer = this._roarPendings[i].silenceSeconds;
        this.events.push({ type: 'roar', silenceSeconds: this._roarPendings[i].silenceSeconds });
        this._roarPendings.splice(i, 1);
      }
    }
    if (this.player.silencedTimer > 0) {
      this.player.silencedTimer = Math.max(0, this.player.silencedTimer - dt);
    }

    // Player
    this.player.update(dt);
    const stats = this.getResolvedStats();
    this.player.autoAttackInterval = 0.4 / stats.attackSpeed;

    // 枪械弹匣：空匣换弹（原版弹夹 30 发）
    if (this._reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._reloading = false;
        this.ammo = this.magazineSize;
        this.events.push({ type: 'reloadDone' });
      }
    }

    this.player.autoAttackTimer = Math.max(0, this.player.autoAttackTimer - dt);
    const auto = this.player.autoAttack(this.enemies);
    if (auto && !this._reloading) {
      // 消耗弹药；空匣 → 进入换弹
      this.ammo--;
      if (this.ammo <= 0) {
        this._reloading = true;
        this.reloadTimer = this.reloadTime;
        this.events.push({ type: 'reloading', duration: this.reloadTime });
      }
      const targets = this.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
      if (targets[0]) {
        const pierceLv = this.player.getPassiveLevel('pierce');
        const multiLv = this.player.getPassiveLevel('multishot');
        // 主弹 + 连射副弹（扇形偏移）
        const shots = 1 + multiLv;      // 连射：扇形多弹
        const splitLv = this.player.getPassiveLevel('splitshot'); // 分裂：平行多列
        const giantLv = this.player.getPassiveLevel('giant');
        const lanes = 1 + splitLv;      // 总列数（含主列）
        const totalShots = shots * lanes;
        for (let i = 0; i < totalShots; i++) {
          const shotIdx = i % shots;    // 同"组"内扇形
          const laneIdx = Math.floor(i / shots); // 列偏移
          const spread = shots > 1 ? (shotIdx - (shots - 1) / 2) * 0.5 : 0;
          const laneOffset = (laneIdx - (lanes - 1) / 2) * 0.9; // 平行列横向偏移（格）
          const t = targets[i % targets.length];
          // 子弹尺寸随伤害加成+巨大化被动成长（玩家可"看到"攻击力成长）
          const size = Math.min(7, (2 + (stats.damage - 1) * 1.5) * (1 + 0.4 * giantLv));
          const isMainLane = laneIdx === Math.floor((lanes - 1) / 2);
          // 原版弹道：全部直线弹（锁定发射瞬间目标位置，飞行中不跟随）
          this._createProjectile('attack', this.player.x, this.player.y, t.col + spread + laneOffset, t.row, {
            damage: stats.damage * auto.damage * (1 + 0.1 * giantLv) * (isMainLane ? 1 : 0.6),
            targetEnemy: null,
            color: stats.damage > 1.5 ? 0x88ffcc : 0xffffff, size,
            speed: 22, pierce: pierceLv,
          });
        }
      }
    }

    // 地面区域场：tick 伤害/减速/冻结
    this.groundZones.update(dt, this.enemies, {
      onKill: (e) => this._onKill(e),
    });

    // 佣兵（上阵 2 位）：按各自间隔周期施放（伤害=主角攻击×继承比例×系数，不吃装备/技能卡加成）
    if (this.mercenarySystem) {
      this.mercenarySystem.setPlayerAttack(stats.damage * 8); // 面板攻击近似：基础枪伤 8 为基准 × 加成
      const mercs = this.mercenarySystem.getCombatStats(stats.damage * 8);
      mercs.forEach((merc, idx) => {
        this._mercTimers[idx] = Math.max(0, this._mercTimers[idx] - dt);
        if (this._mercTimers[idx] <= 0 && this.enemies.some(e => e.alive)) {
          this._mercTimers[idx] = merc.interval;
          this._fireMercenary(merc);
        }
      });
    }

    // Enemies
    for (const e of this.enemies) e.update(dt);

    // 经验球：吸附/吸收（倍率统一走管线：装备 xpBonus + 全局强化 xpBonus，受 cap 封顶）
    const xpMult = this.getXpMultiplier();
    const absorbedXp = this.xpOrbs.update(dt, xpMult);
    if (absorbedXp > 0) {
      const xpResult = this.player.addXp(absorbedXp);
      if (xpResult?.leveledUp) {
        this.pendingLevelUp = true;
        this.events.push({ type: 'levelUp', level: xpResult.level });
      }
    }

    // Projectiles：直线飞行 + 碰撞检测（支持穿透）；追踪弹（targetEnemy）保持追踪
    for (const p of this.projectiles) {
      if (!p.alive) continue;

      // 弹射球：方向速度弹（撞边界反弹、寿命递减）
      if (p.directional) {
        if (p.lifespan !== null) {
          p.lifespan -= dt;
          if (p.lifespan <= 0) { p.alive = false; this._onProjectileEnd(p); continue; }
        }
        p.col += p.dirX * p.speed * dt;
        p.row += p.dirY * p.speed * dt;
        // 边界反弹（左右墙 + 顶部 + 底部墙线前反弹=不进英雄区）
        const leftEdge = 0.2, rightEdge = GRID.COLS - 0.2, topEdge = -0.2, bottomEdge = this.wallRow - 0.3;
        if (p.col <= leftEdge) { p.col = leftEdge; p.dirX = Math.abs(p.dirX); p.bouncesLeft--; }
        if (p.col >= rightEdge) { p.col = rightEdge; p.dirX = -Math.abs(p.dirX); p.bouncesLeft--; }
        if (p.row <= topEdge) { p.row = topEdge; p.dirY = Math.abs(p.dirY); p.bouncesLeft--; }
        if (p.row >= bottomEdge) { p.row = bottomEdge; p.dirY = -Math.abs(p.dirY); p.bouncesLeft--; }
        // 路径碰撞（穿透式：不消失不反弹，只造成伤害）
        for (const e of this.enemies) {
          if (!e.alive || p.hitIds.has(e.id)) continue;
          if (p.lifespan !== null && p.lifespan > 0 && distanceCells(p.col, p.row, e.col, e.row) < 0.55) {
            p.hitIds.add(e.id);
            const killed = e.takeDamage(p.damage);
            this.events.push({ type: 'hit', target: e, damage: p.damage, isCrit: false, killed, skill: p.skillId });
            if (killed) this._onKill(e);
          }
        }
        continue;
      }

      if (p.targetEnemy?.alive) {
        p.targetCol = p.targetEnemy.col;
        p.targetRow = p.targetEnemy.row;
      }
      const dx = p.targetCol - p.col, dy = p.targetRow - p.row;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = p.speed * dt;
      if (dist <= step) {
        // 到达落点
        p.col = p.targetCol; p.row = p.targetRow;
        p.alive = false;
        this._onProjectileEnd(p);
        continue;
      }
      p.col += (dx / dist) * step;
      p.row += (dy / dist) * step;
      p.trail.push({ col: p.col, row: p.row });
      if (p.trail.length > 10) p.trail.shift();

      // 穿透碰撞：命中路径上的敌人（每弹每敌一次），pierceLeft 用尽后消失
      if (p.pierceLeft >= 0 && p.pierceLeft !== undefined) {
        for (const e of this.enemies) {
          if (!e.alive || p.hitIds.has(e.id)) continue;
          if (distanceCells(p.col, p.row, e.col, e.row) < 0.6) {
            p.hitIds.add(e.id);
            const isCrit = this.rng.next() < stats.critRate;
            const dmg = isCrit ? p.damage * stats.critDamage : p.damage;
            const killed = e.takeDamage(dmg);
            this.events.push({ type: 'hit', target: e, damage: dmg, isCrit, killed, skill: p.skillId });
            if (p.effect) this._applyEffect(e, p.effect);
            if (killed) this._onKill(e);
            if (p.pierceLeft <= 0) { p.alive = false; this._onProjectileEnd(p); break; }
            p.pierceLeft--;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.alive);

    // 城墙受击：敌人碰到墙，按伤害扣墙血；自爆尸额外引爆；无敌期免伤
    for (const e of this.enemies) {
      if (e.reachedEnd && !e._counted) {
        e._counted = true;
        if (this.invulnTimer > 0) continue;
        let wallDamage = this._getWallDamage(e);
        const explode = e.behavior?.type === 'explode' ? e.behavior : null;
        if (explode && !e.exploded) {
          e.exploded = true;
          wallDamage += 3; // 自爆额外墙伤
          this.events.push({ type: 'aoeImpact', x: e.col, y: e.row, radius: explode.radius, color: 0xff6600 });
        }
        this.lives = Math.max(0, this.lives - wallDamage);
        this.leakedThisWave++;
        this.events.push({ type: 'wallHit', damage: wallDamage, enemyId: e.id, col: e.col, row: e.row });
        if (this.lives <= 0) this.gameOver = true;
      }
    }

    this.enemies = this.enemies.filter(e => e.alive);

    // Wave complete
    if (this.waveManager.isWaveComplete(this.enemies.length)) {
      this.waveManager.endWave();
      this.waveManager.notifyWaveEnded();
      this.waveCountdown = this.autoWave.interWaveDelay;
      let goldBonus = this.waveManager.getWaveGoldBonus();
      if (this.leakedThisWave === 0 && this.killedThisWave > 0) {
        goldBonus += this.balance.perfectWaveBonus || 30;
        this.events.push({ type: 'perfectWave', bonus: this.balance.perfectWaveBonus || 30 });
      }
      const levelCleared = this.waveManager.isLevelComplete();
      if (levelCleared) {
        this.levelCleared = true;
        this.events.push({ type: 'levelClear', levelId: this.levelRuntime?.levelId, score: this.score });
      }
      return {
        type: 'waveComplete', wave: this.waveManager.currentWave, goldBonus,
        perfectWave: this.leakedThisWave === 0, killed: this.killedThisWave, leaked: this.leakedThisWave,
        levelCleared,
      };
    }
    return null;
  }

  /** 弹道终点结算：aoe 爆炸 + 效果；穿透伤害已在路径碰撞中处理 */
  _onProjectileEnd(p) {
    // 弹射被动：到点后向最近敌人反弹（70% 伤害递减/次，反弹弹不再弹射分裂）
    const bounceLv = this.player.getPassiveLevel('bounce');
    if (bounceLv > 0 && p.skillId === 'attack' && !p._isBounceChild && (p.splitGen || 0) === 0) {
      let dmgMult = 1;
      let from = { col: p.col, row: p.row };
      const bounced = new Set(p.hitIds);
      for (let i = 0; i < bounceLv; i++) {
        dmgMult *= 0.7;
        const next = this.enemies
          .filter(e => e.alive && !bounced.has(e.id))
          .sort((a, b) => distanceCells(from.col, from.row, a.col, a.row) - distanceCells(from.col, from.row, b.col, b.row))[0];
        if (!next) break;
        bounced.add(next.id);
        this._createProjectile('attack', from.col, from.row, next.col, next.row, {
          damage: p.damage * dmgMult, targetEnemy: next, color: 0xffeeaa,
          size: Math.max(1.5, (p.size || 2) * 0.85), speed: 20,
        });
        const child = this.projectiles[this.projectiles.length - 1];
        child._isBounceChild = true;
        from = { col: next.col, row: next.row };
      }
    }
    if (p.aoe > 0) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(p.col, p.row, e.col, e.row) <= p.aoe) {
          const isCrit = this.rng.next() < this.getResolvedStats().critRate;
          const dmg = isCrit ? p.damage * this.getResolvedStats().critDamage : p.damage;
          const killed = e.takeDamage(dmg);
          this.events.push({ type: 'hit', target: e, damage: dmg, isCrit, killed, skill: p.skillId });
          if (p.effect) this._applyEffect(e, p.effect);
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'aoeImpact', x: p.col, y: p.row, radius: p.aoe, color: p.color });
    } else if (p.targetEnemy?.alive && !p.hitIds.has(p.targetEnemy.id)) {
      // 非 aoe 追踪弹终点单体结算（宠物弹/穿透用尽的弹：路径碰撞没打到的补一刀）
      const isCrit = this.rng.next() < this.getResolvedStats().critRate;
      const dmg = isCrit ? p.damage * this.getResolvedStats().critDamage : p.damage;
      const killed = p.targetEnemy.takeDamage(dmg);
      this.events.push({ type: 'hit', target: p.targetEnemy, damage: dmg, isCrit, killed, skill: p.skillId });
      if (p.effect) this._applyEffect(p.targetEnemy, p.effect);
      if (killed) this._onKill(p.targetEnemy);
    } else if (!p.aoe) {
      // 非 aoe 无目标弹（定点空射）：落点邻近敌人补结算（防大步长跳过路径碰撞）
      const near = this.enemies.find(e => e.alive && !p.hitIds.has(e.id) && distanceCells(p.col, p.row, e.col, e.row) < 0.7);
      if (near) {
        p.hitIds.add(near.id);
        const isCrit = this.rng.next() < this.getResolvedStats().critRate;
        const dmg = isCrit ? p.damage * this.getResolvedStats().critDamage : p.damage;
        const killed = near.takeDamage(dmg);
        this.events.push({ type: 'hit', target: near, damage: dmg, isCrit, killed, skill: p.skillId });
        if (p.effect) this._applyEffect(near, p.effect);
        if (killed) this._onKill(near);
      }
    }
    this.events.push({ type: 'projectileHit', x: p.col, y: p.row, color: p.color, skillId: p.skillId });
  }

  /** 经验倍率（管线化：局内装备 + 锻造仓库穿戴件 + 全局强化，xpBonus 合并受 cap 封顶，基数 1） */
  getXpMultiplier() {
    const mods = [
      ...this.equipmentManager.getAllModifiers(),
      ...(this.forgeSystem ? this.forgeSystem.getEquippedModifiers(this.equippedMap || {}) : []),
      ...(this.globalUpgrades ? this.globalUpgrades.getAllModifiers() : []),
    ].filter(m => m.stat === 'xpBonus');
    return this.modifiers.resolve(1, 'xpBonus', mods);
  }

  /**
   * 暴击伤害成长（原版曲线）：随玩家等级分段递增。
   * 5 级前每级+1%，6-10 级+2%，11-15 级+3%，16-20 级+4%，21 级以上封顶 +5%/级。
   */
  _critDamageGrowth() {
    const lv = this.player.level;
    let bonus = 0;
    for (let i = 2; i <= lv; i++) {
      if (i <= 5) bonus += 0.01;
      else if (i <= 10) bonus += 0.02;
      else if (i <= 15) bonus += 0.03;
      else if (i <= 20) bonus += 0.04;
      else bonus += 0.05;
    }
    return bonus;
  }

  /** 距离系数（原版）：远墙 0.9x / 中间 1x / 近防线 1.1x（按敌人行位置） */
  _distanceMultiplier(enemyRow) {
    const ratio = enemyRow / this.wallRow; // 0（远/顶）→ 1（近防线）
    if (ratio < 0.33) return 0.9;
    if (ratio > 0.66) return 1.1;
    return 1.0;
  }

  /** 统一受击入口：带元素修正（抗性/弱点）与闪避判定 */
  _hitEnemy(enemy, damage, { element = null, isCrit = false, skill = null } = {}) {
    if (!enemy.alive) return { killed: false, missed: false };
    // 弹道闪避（天线僵尸）：只有弹道类技能可被闪避
    const projectileLike = !skill || ['attack', 'thermobaric', 'dryice', 'ballshot'].includes(skill);
    if (enemy.dodge > 0 && projectileLike && this.rng.next() < enemy.dodge) {
      this.events.push({ type: 'miss', target: enemy });
      return { killed: false, missed: true };
    }
    const killed = enemy.takeDamage(damage, element, this.rng);
    if (enemy.enraged) {
      // 狂暴巨人免疫控制——控制效果由调用方 _applyEffect 前置判断
    }
    return { killed, missed: false };
  }

  /** 佣兵出战技能：single 单体 / spread 扇形 / aoe 范围 / pierce 直线 */
  _fireMercenary(merc) {
    const targets = this.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
    if (targets.length === 0) return;
    const px = this.player.x, py = this.player.y;
    const fireAt = (t, dmg) => {
      this._createProjectile('merc', px, py - 0.5, t.col, t.row, {
        damage: dmg, targetEnemy: null, color: 0xffcc88, size: 3, speed: 18, effect: merc.effect,
      });
    };
    if (merc.type === 'spread') {
      // 霰弹：扇形多发
      for (let i = 0; i < merc.count; i++) {
        const t = targets[i % targets.length];
        fireAt(t, merc.damage);
      }
    } else if (merc.aoe > 0) {
      // 能量球类：落点小范围
      const t = targets[0];
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(t.col, t.row, e.col, e.row) <= merc.aoe) {
          const killed = e.takeDamage(merc.damage);
          this.events.push({ type: 'hit', target: e, damage: merc.damage, isCrit: false, killed, skill: 'merc' });
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'aoeImpact', x: t.col, y: t.row, radius: merc.aoe, color: 0xffcc88 });
    } else {
      fireAt(targets[0], merc.damage);
    }
    this.events.push({ type: 'mercFire', name: merc.name });
  }

  /** Drain pending events for UI consumption. */
  consumeEvents() {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** 生成关卡 BOSS（取 bossConfig 第一个；难度乘数用当前波次） */
  _spawnBoss() {
    const cfg = this.bossConfig?.[0];
    if (!cfg) return;
    const diffMult = 1 + (this.waveManager.currentWave - 1) * this.balance.difficultyScalePerWave;
    const boss = new Enemy({
      id: cfg.id, name: cfg.name, hp: cfg.hp, speed: cfg.speed, armor: cfg.armor,
      bounty: cfg.bounty || 0, isBoss: true, bossSkills: cfg.skills,
    }, 3.5, 0, diffMult, this.rng);
    boss.wallDamageOverride = cfg.wallDamage || 10;
    boss.bossReward = cfg.reward || { gold: 500, diamond: 50 };
    boss.bossMeta = { size: cfg.size, color: parseInt(String(cfg.color ?? '#cc4444').replace('#', ''), 16), icon: cfg.icon };
    this.enemies.push(boss);
    this.bossManager.register(boss);
    this.events.push({ type: 'bossSpawn', bossId: boss.id, name: cfg.name });
  }

  /** BOSS 召唤的小怪（顶部随机列） */
  _spawnMinion(enemyId) {
    const cfg = this.enemyConfigs.find(c => c.id === enemyId) || this.enemyConfigs[0];
    const col = 1 + Math.floor(this.rng.next() * (GRID.COLS - 2));
    const diffMult = 1 + (this.waveManager.currentWave - 1) * this.balance.difficultyScalePerWave;
    this.enemies.push(new Enemy(cfg, col, 0, diffMult, this.rng));
  }

  /**
   * 敌人撞墙伤害：小怪 1，中怪 2，大体型怪 4；BOSS 用配置覆盖。
   * 墙血 balance.json 的 startingLives 即墙 HP（默认 20）。
   */
  _getWallDamage(enemy) {
    if (enemy.wallDamageOverride) return enemy.wallDamageOverride;
    const hp = enemy.maxHp;
    if (hp >= 400) return 4;
    if (hp >= 150) return 2;
    return 1;
  }

  togglePause() { this.paused = !this.paused; return this.paused; }

  /**
   * 执行复活（ReviveSystem 校验扣费后调用）。
   * 墙血回 50%、清屏敌人、无敌。返回 false 表示参数无效。
   */
  applyRevive({ wallHpRestorePct = 0.5, clearEnemies = true, invulnSeconds = 1.5 } = {}) {
    if (!this.gameOver) return false;
    this.gameOver = false;
    this.lives = Math.max(1, Math.round(this.wallHpMax * wallHpRestorePct));
    if (clearEnemies) {
      this.enemies = [];
      this.waveManager.spawnQueue = [];
      this.waveManager.endWave();
      this.waveCountdown = Math.max(this.waveCountdown, 3);
    }
    this.invulnTimer = invulnSeconds;
    this.events.push({ type: 'revive' });
    return true;
  }

  /** 关卡通关钻石首奖（由 GameScene 在通关结算时调用一次） */
  grantDiamondReward(amount) {
    this.diamondEarned = (this.diamondEarned || 0) + amount;
  }
  toggleSpeed() { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1; return this.speed; }
  getWaveInfo() { return { wave: this.waveManager.currentWave, active: this.waveManager.waveActive, remaining: this.waveManager.spawnQueue.length + this.enemies.length }; }
  /** 升级三选一：转发给 Player（技能解锁 / 属性卡→Modifier 管线），并清除升级待处理标记 */
  applyUpgrade(option) {
    const r = this.player.applyUpgrade(option);
    this.pendingLevelUp = false;
    return r;
  }
  getUpgradeOptions(n = 3) { return this.player.getUpgradeOptions(n, this.rng); }
  equipItem(i) { const r = this.equipmentManager.equip(i); this.pendingItem = null; return r; }
  skipItem() { this.pendingItem = null; }
  /** 结算时处理暂存装备：穿（入全局仓库+穿戴槽）或分解（折金币入本局收益） */
  resolveLoot(item, { wear = true } = {}) {
    this.pendingLoot = this.pendingLoot.filter(i => i !== item);
    return { item, wear };
  }
  getEquipmentInfo() { return { inventory: this.equipmentManager.getInventory(), maxSlots: this.equipmentManager.maxSlots }; }
}
