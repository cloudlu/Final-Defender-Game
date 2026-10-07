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
  constructor(enemyConfigs, balanceConfig, equipmentData = [], levelRuntime = null, { globalUpgrades = null, forgeSystem = null, equippedMap = null, bossConfig = null, vipSystem = null, mercenarySystem = null, gemSystem = null, rngSeed = Date.now() } = {}) {
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
    this.gemSystem = gemSystem;           // GemSystem 实例（可空，v4.9）
    this.gold = balanceConfig.startingGold;
    this.lives = this.wallHpMax;
    this.score = 0;

    this.enemies = [];
    this.projectiles = [];
    this.gameOver = false;
    this.events = [];
    this.pendingItem = null;
    this.pendingLoot = []; // 本局拾取的装备（拾取即入仓，此列表仅供结算页展示快捷操作）

    this.speed = 1;
    this.paused = false;
    this.invulnTimer = 0; // 复活无敌

    // 枪械弹匣（原版：弹夹默认 30 发）
    this.magazineSize = 30;
    this.ammo = 30;
    this.reloadTime = 1.0;
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: target });
        this._hitEnemy(target, damage, { element: skill.element, skill: skillId });
        this.events.push({ type: 'hit', target, damage, isCrit, killed: !target.alive, skill: skillId });
        if (result.effect && target.alive) this._applyEffect(target, result.effect);
        if (!target.alive) this._onKill(target);
        this.events.push({ type: 'guidedEffect', skill: skillId, targetId: target.id, col: target.col, row: target.row });
      }
    } else if (result.type === 'sweep') {
      // 装甲车：沿 Y 轴竖列碾压（原版：直线无限穿透），命中该列所有敌人
      const col = tx;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.col - col) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, e.row, { enemy: e });
          const killed = e.takeDamage(damage);
          this.events.push({ type: 'hit', target: e, damage, isCrit, killed, skill: skillId });
          if (result.effect && this.rng.next() < 0.05) this._applyEffect(e, result.effect); // 原版 18 级 5% 概率眩晕
          if (killed) this._onKill(e);
        }
      }
      this.events.push({ type: 'sweepEffect', skill: skillId, col, dir: 1 });
    } else if (result.type === 'airstrike') {
      // 空投轰炸：延迟 0.4s 落地的大范围爆炸（覆盖落点圈）
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (distanceCells(tx, ty, e.col, e.row) <= result.aoe) {
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: e });
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
          const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy });
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
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy: anchor });
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
        const { damage, isCrit } = this._rollDamageWithCrit(stats, skill.damage, ty, { element: skill.element, skillId, enemy });
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

  /** Resolve base damage through the modifier pipeline with a crit roll.
   *  enemyRow 可选：距离系数；element/skillId 可选：宝石六系/技能专属增伤；
   *  enemy 可选：精英/首领增伤判定（v8.12 修复：旧版引用未定义 enemy 直接 ReferenceError） */
  _rollDamageWithCrit(stats, baseDamage, enemyRow = null, { element = null, skillId = null, enemy = null } = {}) {
    let dmg = stats.damage * baseDamage;
    if (enemyRow !== null) dmg *= this._distanceMultiplier(enemyRow);
    // 宝石：六系伤害 / 技能专属伤害（对齐原版词条乘区）
    const sp = this.gemSpecials;
    if (sp) {
      if (element && sp.elements?.[element]) dmg *= 1 + sp.elements[element] / 100;
      if (skillId && sp.skillDmg?.[skillId]) dmg *= 1 + sp.skillDmg[skillId] / 100;
      if (sp.explodeDamage && ['thermobaric', 'airstrike', 'grenade'].includes(skillId)) {
        dmg *= 1 + sp.explodeDamage / 100;
      }
      if (sp.eliteDamage && enemy && (enemy.isBoss || enemy.elite)) {
        dmg *= 1 + sp.eliteDamage / 100;
      }
    }
    const isCrit = this.rng.next() < stats.critRate;
    if (isCrit) dmg *= stats.critDamage;
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
      ...(this.player.pendingStatMods || []),
      ...(this.globalUpgrades ? this.globalUpgrades.getAllModifiers() : []),
    ];
    // 宝石：通用词条进管线；特殊词条缓存供战斗事件消费
    if (this.gemSystem) {
      const { mods: gemMods, specials } = this.gemSystem.getAllModifiers();
      mods.push(...gemMods);
      this.gemSpecials = specials;
    } else {
      this.gemSpecials = null;
    }
    // 装备附加属性已并入 getEquippedModifiers（v7.2 属性容器重构）
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
    // v9.2：directionAngle（弧度）——纯角度定向（连射扇面弹），toCol/toRow 忽略
    const isDirectional = opts.bouncesLeft !== undefined || opts.directionAngle !== undefined;
    let dirX = 0, dirY = 0, speed = opts.speed || 18;
    if (opts.directionAngle !== undefined) {
      dirX = Math.cos(opts.directionAngle);
      dirY = Math.sin(opts.directionAngle);
    } else if (isDirectional) {
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
      // 角度弹（连射/分裂扇面）：无反弹、限时 lifespan；纯角度弹不再依赖 bouncesLeft
      bouncesLeft: opts.bouncesLeft ?? null, lifespan: opts.lifespan ?? (opts.directionAngle !== undefined ? 1.2 : null),
      angleBullet: opts.directionAngle !== undefined,
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
    // 负面时间减免（胆小僵尸 -100%、巨食者 -50%）：控制/dot/burn 持续时间按比例缩短
    const negResist = enemy.negativeTimeResist || 0;
    if (effect.duration && negResist > 0) {
      const eff = { ...effect, duration: effect.duration * (1 - negResist) };
      if (eff.duration <= 0) return; // 完全免疫
      return this._applyEffect(enemy, eff);
    }
    if (effect.type === 'slow') { enemy.slowFactor = effect.factor; enemy.slowTimer = effect.duration; }
    else if (effect.type === 'dot' || effect.type === 'burn') {
      if (enemy.burnImmune && effect.type === 'burn') return; // 火焰僵尸/巨齿鲨：免疫燃烧
      enemy.dotEffects.push({ damage: effect.damage, duration: effect.duration });
    }
    else if (effect.type === 'stun') {
      if (enemy.stunImmune) return; // 傀儡：免疫眩晕
      enemy.stunTimer = Math.max(enemy.stunTimer, effect.duration);
    }
    else if (effect.type === 'freeze') enemy.freeze(effect.duration);
    else if (effect.type === 'knockback') enemy.knockback(effect.power || 1.5);
  }

  _onKill(enemy) {
    const stats = this.getResolvedStats();
    const bounty = Math.round(enemy.bounty * stats.goldBonus);
    this.gold += bounty;
    this.score += bounty;
    this.killedThisWave++;
    // 死亡光环（护士/咸鱼僵尸）：死亡时治疗周围怪物（原版机制）
    if (enemy.deathHealAura > 0) {
      let healed = 0;
      for (const other of this.enemies) {
        if (!other.alive || other === enemy) continue;
        if (distanceCells(enemy.col, enemy.row, other.col, other.row) <= 2.5) {
          other.hp = Math.min(other.maxHp, other.hp + other.maxHp * enemy.deathHealAura);
          healed++;
        }
      }
      if (healed > 0) {
        this.events.push({ type: 'healAura', x: enemy.col, y: enemy.row, healed });
      }
    }
    // 经验球：击杀掉球，吸附到英雄时结算 XP（加成在吸收时算）
    this.xpOrbs.spawn(enemy.col, enemy.row, 1, () => this.rng.next());
    const drop = this.equipmentManager.rollDrop(this.rng);
    if (drop) {
      // 原版语义：掉落即获得——立刻入锻造仓库（属性容器，v7.2）
      this.pendingLoot.push(drop);
      if (this.forgeSystem) {
        const slots = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
        const slot = slots[Math.floor(this.rng.next() * slots.length)];
        const qMap = { white: 'white', blue: 'blue', purple: 'purple', orange: 'orange' };
        this.forgeSystem.generate({ slot, tier: Math.max(1, Math.ceil(this.waveManager.currentWave / 10)), quality: qMap[drop.rarity] || 'white', rngLike: this.rng });
      }
      this.events.push({ type: 'itemDrop', item: drop });
    }

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

    // 自动出波倒计时（波间递减，到 0 自动开波）；通关后停止（等玩家点结算）
    if (!this.waveManager.waveActive && this.waveCountdown > 0 && !this.levelCleared) {
      this.waveCountdown -= dt;
      if (this.waveCountdown <= 0) {
        this.waveCountdown = 0;
        this.startWave();
      }
    }
    // v9.4 自愈：波间卡死检测——既无怪又无 queue 且 countdown≤0 超过 8 秒（正常应为 0 帧过渡）强制开波
    if (!this.waveManager.waveActive && !this.levelCleared && this.waveCountdown <= 0) {
      const q = this.waveManager.spawnQueue.length;
      const alive = this.enemies.filter(e => e.alive).length;
      if (q === 0 && alive === 0) {
        this._idleSince = (this._idleSince ?? 0) + dt;
        if (this._idleSince > 8) {
          console.warn('[自愈] 波间空转超 8s，强制开波', this.waveManager.currentWave + 1);
          this._idleSince = 0;
          this.startWave();
        }
      } else this._idleSince = 0;
    } else {
      this._idleSince = 0;
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
    // 攻速同时作用于射击间隔与枪械自身冷却（消除双闸门节拍漏射）；3 位取整防浮点尾数（0.22000000000003）
    this.player.setAttackCadence(Math.round((0.4 / stats.attackSpeed) * 1000) / 1000);

    // 枪械弹匣：空匣换弹（原版弹夹 30 发）
    // 换弹时间也受攻速加成（攻速越高换弹越快）——消除"攻速快反而换弹停顿刺耳"的感知问题
    if (this._reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._reloading = false;
        this.ammo = this.magazineSize;
        this.events.push({ type: 'reloadDone' });
      }
    } else if (this.ammo <= 0) {
      this._reloading = true;
      this.reloadTimer = this.reloadTime / stats.attackSpeed;
      this.events.push({ type: 'reloading', duration: this.reloadTimer });
    }

    this.player.autoAttackTimer = Math.max(0, this.player.autoAttackTimer - dt);
    const auto = (!this._reloading) ? this.player.autoAttack(this.enemies) : null;
      if (auto && !this._reloading) {
        // 消耗弹药（空匣触发在上方统一处理，换弹时间吃攻速加成）
        this.ammo--;
        const targets = this.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
        if (targets[0]) {
          const pierceLv = this.player.getPassiveLevel('pierce');
          const multiLv = this.player.getPassiveLevel('multishot');
          const giantLv = this.player.getPassiveLevel('giant');
          const gunMult = (1 + (this.gemSpecials?.gunDamage || 0) / 100) * (this.forgeSystem?.getResearchMultiplier() || 1);
          const size = Math.min(7, (2 + (stats.damage - 1) * 1.5) * (1 + 0.4 * giantLv));
          const color = stats.damage > 1.5 ? 0x88ffcc : 0xffffff;

          // v9.7 连射：主弹追踪必中（targetEnemy 跟飞），副弹方向弹扇形散开打偏移目标——
          // v9.6 全方向弹后怪移动即打空，瞄准手感丢失
          const shots = 1 + multiLv;
          const SPREAD_ARC = 0.22; // 相邻弹夹角 ≈12.6°
          for (let s = 0; s < shots; s++) {
            const shotIdx = s - (shots - 1) / 2;
            const isMain = s === Math.floor((shots - 1) / 2);
            const t = targets[s % targets.length];
            if (isMain) {
              // 主弹：追踪 targetEnemy（锁定发射目标，飞行中跟随）
              this._createProjectile('attack', this.player.x, this.player.y, t.col, t.row, {
                damage: stats.damage * auto.damage * (1 + 0.1 * giantLv) * gunMult,
                targetEnemy: t, color, size,
                speed: 22, pierce: pierceLv,
              });
            } else {
              // 副弹：方向弹朝扇形偏角（打偏移目标位置，允许打空）
              const angle = Math.atan2(t.row - this.player.y, t.col - this.player.x) + shotIdx * SPREAD_ARC;
              this._createProjectile('attack', this.player.x, this.player.y, angle, 0, {
                damage: stats.damage * auto.damage * (1 + 0.1 * giantLv) * 0.6 * gunMult,
                targetEnemy: null, color, size: size * 0.85,
                speed: 22, pierce: pierceLv,
                directionAngle: angle,
              });
            }
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
          this._fireMercenary(merc, idx);
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

      // 方向速度弹（反弹球 + 角度弹）：按"方向+速率"飞行
      if (p.directional) {
        if (p.lifespan !== null) {
          p.lifespan -= dt;
          if (p.lifespan <= 0) { p.alive = false; this._onProjectileEnd(p); continue; }
        }
        p.col += p.dirX * p.speed * dt;
        p.row += p.dirY * p.speed * dt;
        // 边界处理：角度弹（连射/分裂）飞离出发区后出界即消失（出发时在墙后，不能立即判出界）
        const leftEdge = 0.2, rightEdge = GRID.COLS - 0.2, topEdge = -0.2, bottomEdge = this.wallRow - 0.3;
        if (p.angleBullet) {
          if (!p._leftSpawn && p.row > bottomEdge) {
            // 仍在出发区（墙后）：仅当飞出左右边界才消失
            if (p.col <= leftEdge || p.col >= rightEdge) { p.alive = false; this._onProjectileEnd(p); continue; }
          } else {
            p._leftSpawn = true;
            if (p.col <= leftEdge || p.col >= rightEdge || p.row <= topEdge) { p.alive = false; this._onProjectileEnd(p); continue; }
          }
          if (p.lifespan !== null) {
            p.lifespan -= dt;
            if (p.lifespan <= 0) { p.alive = false; this._onProjectileEnd(p); continue; }
          }
        } else {
          if (p.col <= leftEdge) { p.col = leftEdge; p.dirX = Math.abs(p.dirX); p.bouncesLeft--; }
          if (p.col >= rightEdge) { p.col = rightEdge; p.dirX = -Math.abs(p.dirX); p.bouncesLeft--; }
          if (p.row <= topEdge) { p.row = topEdge; p.dirY = Math.abs(p.dirY); p.bouncesLeft--; }
          if (p.row >= bottomEdge) { p.row = bottomEdge; p.dirY = -Math.abs(p.dirY); p.bouncesLeft--; }
        }
        // 路径碰撞（穿透式：不消失不反弹，只造成伤害；角度弹条件放宽——不再要求 lifespan 判定）
        for (const e of this.enemies) {
          if (!e.alive || p.hitIds.has(e.id)) continue;
          const hitOk = p.angleBullet ? true : (p.lifespan !== null && p.lifespan > 0);
          if (hitOk && distanceCells(p.col, p.row, e.col, e.row) < 0.55) {
            p.hitIds.add(e.id);
            // v9.6 分裂：主弹（含角度弹）首次命中时溅射
            if (p.skillId === 'attack' && (p.splitGen || 0) === 0 && !p._isSplitChild && !p._splitDone) {
              const splitLv = this.player.getPassiveLevel('splitshot');
              if (splitLv > 0) { p._splitDone = true; this._spawnHitSplits(p, splitLv); }
            }
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
        let splitDone = false;
        for (const e of this.enemies) {
          if (!e.alive || p.hitIds.has(e.id)) continue;
          if (distanceCells(p.col, p.row, e.col, e.row) < 0.6) {
            p.hitIds.add(e.id);
            // v9.6 分裂：主弹首次命中时溅射（splitGen=0 才触发）
            if (!splitDone && p.skillId === 'attack' && (p.splitGen || 0) === 0 && !p._isSplitChild) {
              const splitLv = this.player.getPassiveLevel('splitshot');
              if (splitLv > 0) { this._spawnHitSplits(p, splitLv); splitDone = true; }
            }
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

  /** v9.6 分裂被动（splitshot）：主弹命中时从命中点分裂出 2 个 40% 小弹向两侧散射（每级+1 对）。
   *  与连射（发射期扇形）语义区分：分裂=命中后溅射。splitGen 防止子弹再分裂。 */
  _spawnHitSplits(p, splitLv) {
    const base = p.directional ? Math.atan2(p.dirY, p.dirX) : Math.atan2(p.row - this.player.y, p.col - this.player.x);
    const ARC = 0.5; // 两侧偏角 ≈28.6°
    for (let k = 0; k < splitLv; k++) {
      for (const side of [-1, 1]) {
        const a = base + side * ARC * (k + 1);
        this._createProjectile('attack', p.col, p.row, a, 0, {
          damage: p.damage * 0.4,
          targetEnemy: null, color: p.color, size: Math.max(1.5, (p.size || 2) * 0.7),
          speed: p.speed * 0.9, pierce: 0,
          directionAngle: a, splitGen: (p.splitGen || 0) + 1,
        });
        const child = this.projectiles[this.projectiles.length - 1];
        child._isSplitChild = true;
        child.hitIds.add(p.hitIds.size ? [...p.hitIds][p.hitIds.size - 1] : -1); // 不回伤命中目标
      }
    }
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

  /** 统一受击入口：带元素修正（抗性/弱点）、闪避判定、宝石秒杀/传送 */
  _hitEnemy(enemy, damage, { element = null, isCrit = false, skill = null } = {}) {
    if (!enemy.alive) return { killed: false, missed: false };
    // 弹道闪避（天线僵尸）：只有弹道类技能可被闪避
    const projectileLike = !skill || ['attack', 'thermobaric', 'dryice'].includes(skill);
    if (enemy.dodge > 0 && projectileLike && this.rng.next() < enemy.dodge) {
      this.events.push({ type: 'miss', target: enemy });
      return { killed: false, missed: true };
    }
    // 秒杀宝石：3% 概率秒杀小怪（对 BOSS 无效——原版设定）
    const sp = this.gemSpecials;
    if (sp?.instantKill > 0 && !enemy.isBoss && this.rng.next() < sp.instantKill / 100) {
      enemy.hp = 0;
      enemy.alive = false;
      this.events.push({ type: 'instantKill', target: enemy });
      return { killed: true, missed: false, instantKill: true };
    }
    const killed = enemy.takeDamage(damage, element, this.rng);
    return { killed, missed: false };
  }

  /** 佣兵出战技能：single 单体 / spread 扇形 / aoe 范围 / pierce 直线。
   * 弹道从佣兵自身位置发出（slotIdx: 0=左佣兵 / 1=右佣兵），每佣兵专属颜色区分主角弹道 */
  _fireMercenary(merc, slotIdx = 0) {
    const targets = this.enemies.filter(e => e.alive).sort((a, b) => b.row - a.row);
    if (targets.length === 0) return;
    // 出发点=佣兵悬浮位（主角左右两侧 36px≈0.72 格）；颜色按佣兵技能元素区分
    const mx = this.player.x + (slotIdx === 0 ? -0.72 : 0.72);
    const my = this.player.y - 0.3;
    const MERC_COLORS = {
      merc_flame: 0xff5522,    // 火焰尖兵：炽红
      merc_shotgun: 0xddaa33,  // 霰弹：土黄
      merc_mg: 0xffee66,       // 机枪：亮黄
      merc_sniper: 0x66ffcc,   // 狙击：青绿
      merc_arrow: 0x88ff44,    // 弓箭：草绿
      merc_chrono: 0xcc66ff,   // 时空：紫
    };
    const color = MERC_COLORS[merc.id] || 0xffaa44;
    const fireAt = (t, dmg) => {
      this._createProjectile('merc', mx, my, t.col, t.row, {
        damage: dmg, targetEnemy: null, color, size: 4, speed: 14, effect: merc.effect, // 稍慢+大弹体：玩家可感知的佣兵弹道
      });
    };
    if (merc.type === 'spread') {
      // 霰弹：扇形多发
      for (let i = 0; i < merc.count; i++) {
        const t = targets[i % targets.length];
        fireAt(t, merc.damage);
      }
    } else if (merc.aoe > 0) {
      // 能量球类：发射可见弹道（v8.11 修复：旧实现直接落点结算无弹道飞行，5s 间隔下玩家看不到该佣兵出手），
      // 落点 aoe 结算由 _onProjectileEnd 的 p.aoe 分支统一处理
      const t = targets[0];
      this._createProjectile('merc', mx, my, t.col, t.row, {
        damage: merc.damage, targetEnemy: null, color, size: 5, speed: 12, aoe: merc.aoe, effect: merc.effect,
      });
    } else {
      fireAt(targets[0], merc.damage);
    }
    this.events.push({ type: 'mercFire', name: merc.name, slotIdx, color });
  }

  /**
   * 全局战力（原版语义：战力 = 总攻击力聚合，装备/宝石/佣兵/全局强化全部折算成一个数字）。
   * 镶嵌/拆卸宝石、换装、强化都会即时改变此值——玩家唯一的"变强"指标。
   */
  getTotalPower() {
    // 1) 装备侧：六部位 基础攻击(品阶×10+品质×5) + 部位强化加成 + 词条折算
    let equipmentPower = 0;
    if (this.forgeSystem) {
      const equipped = this.equippedMap || {};
      const QUALITY_IDX = { white: 0, green: 1, blue: 2, purple: 3, orange: 4, red: 5, rainbow: 6 };
      // 词条折算：与 GemSystem.gemPower 同锚点（百分比 × 100 基准攻）
      const FULL = { wallHp: 0.1, critRate: 12, damage: 1, gunDamage: 1, eliteDamage: 0.8, debuffTargetDamage: 0.7, highHpTargetDamage: 0.7, lowHpWallDamage: 0.7, explodeDamage: 0.8 };
      for (const [slot, uid] of Object.entries(equipped)) {
        const entry = this.forgeSystem.save.inventory.find(i => i.uid === uid);
        if (!entry) continue;
        equipmentPower += this.forgeSystem.getBaseAttack(entry); // 基础攻击 1:1
        for (const a of entry.affixes || []) {
          if (a.pct) equipmentPower += a.value * (FULL[a.stat] ?? 1);      // 百分比词条 × 基准攻
          else if (a.stat === 'wallHp') equipmentPower += a.value * 0.1;
          else if (a.stat !== 'baseAttack') equipmentPower += a.value;     // add 型攻击 1:1（baseAttack 在底盘里）
        }
        equipmentPower += this.forgeSystem.getSlotLevel(slot) * 15;        // 部位强化 ≈ 每级 +15 攻
      }
    }
    // 2) 宝石侧：已镶宝石折算 + 套装
    const gemPower = this.gemSystem ? this.gemSystem.getTotalGemPower() : 0;
    // 3) 佣兵被动（拥有即加攻——原版 1:1 攻击）
    const mercPower = this.mercenarySystem ? this.mercenarySystem.getTotalPassiveAttack() : 0;
    // 4) 全局强化攻击档（g_attack 每级 +5% → ×100 基准攻折算）
    const globalAtkLv = this.globalUpgrades?.getLevel('g_attack') || 0;
    const globalPower = globalAtkLv * 5;
    // 5) 面板伤害乘区（升级卡/品质技能加成等聚合）折算
    const stats = this.getResolvedStats();
    const dmgMultPower = Math.round((stats.damage - 1) * 100);
    return Math.max(0, Math.round(equipmentPower + gemPower + mercPower + globalPower + dmgMultPower));
  }

  /** 加成来源明细（📊 先锋官面板数据源）：结构化对象（UI 层负责玩家语言渲染）。
   *  stats 实时值 + bySource 分来源汇总（stat 中文名+数值），不再输出 stat 英文字段名 */
  getBonusBreakdown() {
    const STAT_CN = {
      damage: '伤害', attackSpeed: '攻速', critRate: '暴击率', critDamage: '暴击伤害',
      goldBonus: '金币', xpBonus: '经验', wallHp: '防线血量', range: '射程', baseAttack: '攻击力',
      slowPct: '减速', gunDamage: '枪械伤害',
      element_fire: '火系伤害', element_ice: '冰系伤害', element_electric: '电系伤害',
      element_wind: '风系伤害', element_physical: '物理系伤害', element_energy: '能量系伤害',
      debuffTargetDamage: '对负面怪伤害', highHpTargetDamage: '对高血怪伤害',
      lowHpWallDamage: '残墙增伤', explodeDamage: '爆炸伤害', eliteDamage: '对精英增伤',
    };
    const mods = [
      ...this.equipmentManager.getAllModifiers(),
      ...(this.forgeSystem ? this.forgeSystem.getEquippedModifiers(this.equippedMap || {}) : []),
      ...(this.player.pendingStatMods || []),
      ...(this.globalUpgrades ? this.globalUpgrades.getAllModifiers() : []),
    ];
    if (this.mercenarySystem) {
      const mercAtk = this.mercenarySystem.getTotalPassiveAttack();
      if (mercAtk > 0) {
        mods.push({ id: 'merc_passive_atk', source: 'mercenary', stat: 'damage', type: 'add', value: mercAtk / 10 });
      }
    }
    if (this.gemSystem) {
      const { mods: gemMods } = this.gemSystem.getAllModifiers();
      mods.push(...gemMods);
    }
    const SOURCE_NAMES = {
      equipment: '装备', quality: '品质加成', reroll: '洗练', gem: '宝石', gem_set: '宝石套装',
      mercenary: '佣兵被动', vip: 'VIP', upgrade: '升级卡', global: '全局强化',
    };
    const stats = this.getResolvedStats();
    // 分来源汇总：同来源同 stat 合并（百分比相加、扁平相加）
    const bySource = {};
    for (const m of mods) {
      const src = SOURCE_NAMES[m.source] || m.source;
      const key = `${src}|${m.stat}`;
      const e = bySource[key] = bySource[key] || { source: src, stat: m.stat, pct: 0, flat: 0 };
      if (m.type === 'mul_pct' || m.pct) e.pct += m.value * 100;
      else e.flat += m.value;
    }
    const sources = Object.values(bySource)
      .filter(e => Math.abs(e.pct) > 0.01 || Math.abs(e.flat) > 0.01)
      .map(e => ({
        source: e.source,
        text: `${STAT_CN[e.stat] || e.stat} ${e.pct !== 0 ? `${e.pct > 0 ? '+' : ''}${Math.round(e.pct * 10) / 10}%` : ''}${e.pct !== 0 && e.flat !== 0 ? ' ' : ''}${e.flat !== 0 ? `+${Math.round(e.flat * 10) / 10}` : ''}`,
      }));
    return {
      power: this.getTotalPower(),
      stats: {
        damageMult: stats.damage,
        attackSpeed: stats.attackSpeed,
        msPerShot: Math.round(400 / stats.attackSpeed),
        critRate: stats.critRate,
        critDamage: stats.critDamage,
        goldBonus: stats.goldBonus,
        xpBonus: this.getXpMultiplier(),
        gunMult: (1 + (this.gemSpecials?.gunDamage || 0) / 100) * (this.forgeSystem?.getResearchMultiplier() || 1),
      },
      sources,
    };
  }

  /** Drain pending events for UI consumption. */
  consumeEvents() {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** 生成关卡 BOSS（按 levels.bossId 匹配 boss.json；默认第一个） */
  _spawnBoss() {
    const cfgId = this.levelRuntime?.bossId;
    const cfg = this.bossConfig?.find(b => b.id === cfgId) || this.bossConfig?.[0];
    if (!cfg) return;
    const diffMult = 1 + (this.waveManager.currentWave - 1) * this.balance.difficultyScalePerWave;
    const boss = new Enemy({
      id: cfg.id, name: cfg.name, hp: cfg.hp, speed: cfg.speed, armor: cfg.armor,
      bounty: cfg.bounty || 0, isBoss: true, bossSkills: cfg.skills,
      resist: cfg.resist, weak: cfg.weak, immuneKnock: !!cfg.immuneKnock,
      resistFreeze: !!cfg.resistFreeze, elementImmune: !!cfg.elementImmune,
      freezeHeal: !!cfg.freezeHeal, healOnHurt: !!cfg.healOnHurt,
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
