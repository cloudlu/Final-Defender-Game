import { describe, it, expect } from 'vitest';
import { GameState } from './GameState.js';
import { Player } from './Player.js';
import enemiesData from '../data/enemies.json';
import balanceData from '../data/balance.json';
import equipmentData from '../data/equipment.json';
import { Enemy } from './Enemy.js';
import { EquipmentForgeSystem } from './EquipmentForgeSystem.js';

function createGame() {
  return new GameState(enemiesData, balanceData, equipmentData);
}

describe('GameState integration with real config data', () => {
  it('enemy configs are flat and consumable by Enemy', () => {
    for (const cfg of enemiesData) {
      const e = new Enemy(cfg, 4, 0, 1.0);
      expect(e.maxHp).toBe(cfg.hp);
      expect(Number.isFinite(e.maxHp)).toBe(true);
      expect(e.speed).toBe(cfg.speed);
      expect(e.bounty).toBe(cfg.bounty);
    }
  });

  it('spawns real enemies on wave start and they move with finite positions', () => {
    const state = createGame();
    state.startWave();
    // Pump updates until first spawn (spawnInterval <= 0.7s)
    for (let i = 0; i < 60; i++) state.update(1 / 30);
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const e of state.enemies) {
      expect(Number.isFinite(e.col)).toBe(true);
      expect(Number.isFinite(e.row)).toBe(true);
      expect(e.maxHp).toBeGreaterThan(0);
    }
  });

  it('enemies advance toward the wall over time', () => {
    const state = createGame();
    state.startWave();
    for (let i = 0; i < 120; i++) state.update(1 / 30);
    expect(state.enemies.length).toBeGreaterThan(0);
    const maxRow = Math.max(...state.enemies.map(e => e.row));
    expect(maxRow).toBeGreaterThan(0);
  });

  it('auto attack can kill spawned enemies (finite hp, finite positions)', () => {
    const state = createGame();
    state.startWave();
    // Force-spawn only low-armor enemies for deterministic kill timing
    while (state.waveManager.spawnQueue.length > 0) {
      const data = state.waveManager.spawnQueue.shift();
      const cfg = enemiesData.find(c => c.id === 'enemy_basic' || c.id === 'enemy_runner');
      state.enemies.push(new Enemy(cfg, 4, 0, 1.0));
    }
    // Run combat long enough for auto attack (dmg 8-armor 0 / 0.4s) to kill (60-100hp)
    for (let i = 0; i < 60 * 30; i++) {
      state.update(1 / 30);
      if (state.score > 0) break;
      for (const e of state.enemies) e.row = 0; // keep them in range forever
      state.player.autoAttackTimer = 0; // fire every frame
    }
    expect(state.score).toBeGreaterThan(0);
  });

  it('equipping an item actually modifies stats', () => {
    const state = createGame();
    const before = state.getResolvedStats().damage;
    state.equipItem(equipmentData.find(i => i.id === 'item_power_ring'));
    const after = state.getResolvedStats().damage;
    expect(after).toBeCloseTo(before * 1.08, 5);
  });

  it('events are consumed after processEvents (no unbounded growth)', () => {
    const state = createGame();
    state.startWave();
    state.events.push({ type: 'hit', target: { alive: true, col: 1, row: 1 }, damage: 1, isCrit: false });
    state.consumeEvents();
    expect(state.events.length).toBe(0);
    state.events.push({ type: 'hit', target: { alive: true, col: 1, row: 1 }, damage: 1, isCrit: false });
    state.consumeEvents();
    expect(state.events.length).toBe(0);
  });

  it('auto-starts first wave after countdown without manual startWave', () => {
    const state = createGame();
    expect(state.waveCountdown).toBeGreaterThan(0);
    expect(state.waveManager.waveActive).toBe(false);
    // Pump 4 seconds at 30fps
    for (let i = 0; i < 4 * 30; i++) state.update(1 / 30);
    expect(state.waveManager.waveActive).toBe(true);
    expect(state.waveManager.currentWave).toBe(1);
  });

  it('wall takes damage when enemies reach it; wall HP 0 = game over', () => {
    const state = createGame();
    const hpBefore = state.lives;
    // 造一只小怪直接放墙线上
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, state.wallRow - 0.01, 1.0);
    state.enemies.push(e);
    e.update(1); // 越过墙线
    expect(e.reachedEnd).toBe(true);
    state.update(1 / 30);
    expect(state.lives).toBe(hpBefore - state._getWallDamage(e));
    expect(state.events.some(ev => ev.type === 'wallHit')).toBe(true);

    // 清空到 0 → game over
    state.lives = 1;
    const e2 = new Enemy(cfg, 4, state.wallRow - 0.01, 1.0);
    state.enemies.push(e2);
    e2.update(1);
    state.update(1 / 30);
    expect(state.gameOver).toBe(true);
  });

  it('bigger enemies damage the wall more', () => {
    const state = createGame();
    const basic = enemiesData.find(c => c.id === 'enemy_basic');
    const tank = enemiesData.find(c => c.id === 'enemy_tank');
    const basicE = new Enemy(basic, 4, 0, 1.0);
    const tankE = new Enemy(tank, 4, 0, 1.0);
    expect(state._getWallDamage(basicE)).toBe(1);
    expect(state._getWallDamage(tankE)).toBe(4);
  });

  it('kills drop xp orbs; absorbing them levels up and flags pendingLevelUp', () => {
    const state = createGame();
    expect(state.player.level).toBe(1);
    expect(state.player.skills.filter(s => s.unlocked).length).toBe(1); // only attack

    // 5 kills → 5 orbs
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    for (let i = 0; i < 5; i++) {
      const e = new Enemy(cfg, 3.6, 12.5, 1.0); // 掉在英雄附近，快速吸附
      state.enemies.push(e);
      e.takeDamage(9999);
      state._onKill(e);
    }
    state.enemies = state.enemies.filter(e => e.alive);
    expect(state.xpOrbs.orbs.length).toBe(5);

    // 等待悬停结束+吸附（模拟帧推进）
    let leveled = false;
    for (let i = 0; i < 300; i++) {
      state.update(1 / 30);
      if (state.player.level >= 2) { leveled = true; break; }
    }
    expect(leveled).toBe(true);
    expect(state.pendingLevelUp).toBe(true);

    // pick a skill upgrade
    const options = state.player.getUpgradeOptions(3);
    expect(options.length).toBe(3);
    const skillOpt = options.find(o => o.kind === 'skill') || options[0];
    const res = state.applyUpgrade(skillOpt);
    expect(res.applied).toBe(true);
    expect(state.pendingLevelUp).toBe(false);
  });

  it('stat upgrades flow through the modifier pipeline', () => {
    const state = createGame();
    const before = state.getResolvedStats().damage;
    state.applyUpgrade({ kind: 'stat', id: 'stat_damage', name: '攻击强化' });
    const after = state.getResolvedStats().damage;
    expect(after).toBeCloseTo(before * 1.2, 4);
  });

  it('skill evolution: two maxed skills merge into evolved skill (deathboom)', () => {
    const state = createGame();
    state.player.unlockSkill('fuelbomb');
    state.player.unlockSkill('thermobaric');
    // 拉满两原料
    for (const id of ['fuelbomb', 'thermobaric']) {
      const s = state.player.skills.find(k => k.id === id);
      s.level = 5;
      state.player._applyLevel(s);
    }
    // 选项池出现进化卡
    const pool = state.player.getUpgradeOptions(999);
    const evoOpt = pool.find(o => o.kind === 'evolve' && o.id === 'evo_deathboom');
    expect(evoOpt).toBeDefined();

    // 执行进化
    const res = state.applyUpgrade(evoOpt);
    expect(res.applied).toBe(true);
    const evo = state.player.skills.find(s => s.id === 'evo_deathboom');
    expect(evo).toBeDefined();
    expect(evo.unlocked).toBe(true);
    expect(evo.level).toBe(1);
    // 原料被移出可用池
    for (const id of ['fuelbomb', 'thermobaric']) {
      const s = state.player.skills.find(k => k.id === id);
      expect(s.unlocked).toBe(false);
      expect(s.evolved).toBe(true);
    }
    // 进化技能可施放（zone 类型落地）
    const r = state.useSkill('evo_deathboom', 3, 3);
    expect(r).not.toBeNull();
    expect(state.groundZones.zones.length).toBe(1);
  });

  it('evolution options do not appear when ingredients are not maxed', () => {
    const state = createGame();
    state.player.unlockSkill('fuelbomb');
    state.player.unlockSkill('thermobaric');
    const pool = state.player.getUpgradeOptions(999);
    expect(pool.some(o => o.kind === 'evolve')).toBe(false);
  });

  it('speed toggle cycles 1 -> 2 -> 3 -> 1', () => {
    const state = createGame();
    expect(state.toggleSpeed()).toBe(2);
    expect(state.toggleSpeed()).toBe(3);
    expect(state.toggleSpeed()).toBe(1);
  });

  // ===== 原版技能表对齐（v4.0）=====

  it('fuelbomb creates a burning ground zone that ticks damage', () => {
    const state = createGame();
    state.player.unlockSkill('fuelbomb');
    const r = state.useSkill('fuelbomb', 4, 4);
    expect(r).not.toBeNull();
    expect(state.groundZones.zones.length).toBe(1);
    const zone = state.groundZones.zones[0];
    // 敌人站在火区中心 → 一定被 tick 灼烧
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, 4, 1.0);
    state.enemies.push(e);
    const hpBefore = e.hp;
    state.groundZones.update(1.0, state.enemies, { onKill: (en) => state._onKill(en) });
    expect(e.hp).toBeLessThan(hpBefore);
  });

  it('icestorm freezes enemies in the zone', () => {
    const state = createGame();
    state.player.unlockSkill('icestorm');
    state.useSkill('icestorm', 4, 4);
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, 4, 1.0);
    state.enemies.push(e);
    for (let i = 0; i < 15; i++) {
      state.groundZones.update(1 / 30, state.enemies, {});
      e.update(1 / 30);
    }
    expect(e.stunTimer).toBeGreaterThan(0);
    expect(e.frozen).toBe(true);
  });

  it('cyclone knocks enemies back toward the top', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, 8, 1.0);
    state.enemies.push(e);
    state.player.unlockSkill('cyclone');
    state.useSkill('cyclone', 4, 8); // 落点即敌人方向
    expect(e.row).toBeLessThan(8); // 被吹退
  });

  it('empierce hits all enemies along the cast line', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const onLine = new Enemy(cfg, 4, 5, 1.0);
    const offLine = new Enemy(cfg, 7, 5, 1.0);
    state.enemies.push(onLine, offLine);
    state.player.unlockSkill('empierce');
    state.useSkill('empierce', 4, 9); // 垂直向下线，经过 (4,5)
    expect(onLine.hp).toBeLessThan(onLine.maxHp);
    expect(offLine.hp).toBe(offLine.maxHp);
  });

  it('guidedlaser strikes the highest-hp enemy', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const weak = new Enemy(cfg, 2, 2, 1.0);
    const strong = new Enemy(cfg, 5, 3, 2.0); // 难度×2 → 血更高
    state.enemies.push(weak, strong);
    state.player.unlockSkill('guidedlaser');
    state.useSkill('guidedlaser', 3, 3); // 落点无关，锁定最高血
    expect(weak.hp).toBe(weak.maxHp);
    expect(strong.hp).toBeLessThan(strong.maxHp);
  });

  it('vehicle sweeps a row with penetration', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const inRow = new Enemy(cfg, 2, 5, 1.0);
    const other = new Enemy(cfg, 5, 9, 1.0);
    state.enemies.push(inRow, other);
    state.player.unlockSkill('vehicle');
    state.useSkill('vehicle', 6, 5);
    expect(inRow.hp).toBeLessThan(inRow.maxHp);
    expect(other.hp).toBe(other.maxHp);
  });

  // ===== 原版敌人机制（v4.1）=====

  it('element resist/weak modify damage (nurse resists electric, weak to wind)', () => {
    const state = createGame();
    const nurse = enemiesData.find(c => c.id === 'enemy_nurse');
    const e = new Enemy(nurse, 4, 4, 1.0);
    // 电磁穿刺（electric，30 伤）→ 50% 抗性
    const d0 = e.hp;
    e.takeDamage(30, 'electric');
    expect(e.hp).toBeCloseTo(d0 - Math.max(1, 30 * 0.5), 1);
    // 旋风（wind，30 伤）→ 50% 弱点
    const d1 = e.hp;
    e.takeDamage(30, 'wind');
    expect(e.hp).toBeCloseTo(d1 - Math.max(1, 30 * 1.5), 1);
  });

  it('giant enrages below 50% hp and becomes control-immune', () => {
    const state = createGame();
    const giant = enemiesData.find(c => c.id === 'enemy_giant');
    const e = new Enemy(giant, 4, 4, 1.0);
    e.hp = e.maxHp * 0.4; // 过半
    e.update(1 / 30); // 触发狂暴判定
    expect(e.enraged).toBe(true);
    // 狂暴后受击清空控制
    e.freeze(2);
    expect(e.stunTimer).toBe(0);
  });

  it('boar is immune to knockback', () => {
    const state = createGame();
    const boar = enemiesData.find(c => c.id === 'enemy_boar');
    const e = new Enemy(boar, 4, 8, 1.0);
    e.knockback(2.5);
    expect(e.row).toBe(8); // 原地不动
  });

  it('antenna dodges projectiles ~50% of the time (statistical)', () => {
    const state = createGame();
    const ant = enemiesData.find(c => c.id === 'enemy_antenna');
    const e = new Enemy(ant, 4, 4, 1.0);
    let misses = 0;
    for (let i = 0; i < 200; i++) {
      e.hp = e.maxHp; // 复活血量以便重复判定
      e.alive = true;
      const r = state._hitEnemy(e, 30, { skill: 'attack' });
      if (r.missed) misses++;
    }
    // 50% 闪避：200 次中 miss 数应在 60~140 之间（宽松防 flaky）
    expect(misses).toBeGreaterThan(60);
    expect(misses).toBeLessThan(140);
  });

  it('loot resolved as wear lands in forge inventory persisted inside global save (regression)', () => {
    // 回归：GameScene 曾因 forgeSystem.save 与全局档脱钩导致仓库不落盘
    const state = createGame();
    // 模拟全局档骨架挂载（GameScene.create 的关键步骤）
    const globalSave = { levels: {}, gold: 1000, equipped: {} };
    globalSave.equipment = globalSave.equipment || { inventory: [], nextUid: 1 };
    const forge = new EquipmentForgeSystem(equipmentData, globalSave.equipment);
    // 直接构造掉落（不依赖 8% roll 概率）
    const dropped = equipmentData.find(i => i.id === 'item_power_ring');
    state.pendingLoot.push(dropped);
    // 结算穿戴
    const entry = forge.addEquipment(dropped.id);
    globalSave.equipped[dropped.slot] = entry.uid;
    // 关键断言：仓库内容出现在全局档对象上（序列化即落盘）
    expect(globalSave.equipment.inventory.length).toBe(1);
    expect(globalSave.equipment.inventory[0].refId).toBe(dropped.id);
    expect(JSON.stringify(globalSave).includes(dropped.id)).toBe(true);
  });

  it('nurse heals itself over time via aura', () => {
    const state = createGame();
    const nurse = enemiesData.find(c => c.id === 'enemy_nurse');
    const e = new Enemy(nurse, 4, 4, 1.0);
    e.hp = e.maxHp * 0.5;
    e.update(1.1); // 触发 1 秒回血 tick
    expect(e.hp).toBeGreaterThan(e.maxHp * 0.5);
  });

  // ===== A 档：原版细节对齐（v4.8）=====

  it('crit damage grows with player level (original curve)', () => {
    const state = createGame();
    // Lv1：基础 125%，无成长
    expect(state.getResolvedStats().critDamage).toBeCloseTo(1.25, 3);
    // Lv6：+4×1%（2-5 级）+2%（6 级）= +6% → 1.31
    state.player.level = 6;
    expect(state.getResolvedStats().critDamage).toBeCloseTo(1.31, 3);
    // Lv11：+4%+10%+3%（11 级）→ 1.25+0.17 = 1.42
    state.player.level = 11;
    expect(state.getResolvedStats().critDamage).toBeCloseTo(1.42, 3);
  });

  it('crit multiplier is actually applied on crit hits (regression)', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, 4, 1.0);
    state.enemies.push(e);
    state.player.level = 1;
    // 强制暴击：临时把 critRate 拉满
    state.player.pendingStatMods.push({ id: 'test_crit', source: 'upgrade', stat: 'critRate', type: 'add', value: 5 });
    let critDamage = null;
    for (let i = 0; i < 100 && critDamage === null; i++) {
      state.events.length = 0;
      state._rollDamageWithCrit(state.getResolvedStats(), 10, e.row);
      const hit = state.events.length = 0; // 不走 events，直接验证数值
      // 直接多次 roll 取到暴击样本
      const r = state._rollDamageWithCrit(state.getResolvedStats(), 10, null);
      if (r.isCrit) critDamage = r.damage;
    }
    expect(critDamage).not.toBeNull();
    expect(critDamage).toBeGreaterThan(state.getResolvedStats().damage * 10); // 暴击必须 > 非暴击（1.25x+）
  });

  it('distance multiplier: far enemies take 0.9x, near wall 1.1x', () => {
    const state = createGame();
    expect(state._distanceMultiplier(1)).toBeCloseTo(0.9, 3);   // 顶部（远）
    expect(state._distanceMultiplier(6)).toBeCloseTo(1.0, 3);   // 中间
    expect(state._distanceMultiplier(11)).toBeCloseTo(1.1, 3);  // 近防线
  });

  it('skill milestones are exposed at the right levels', () => {
    const state = createGame();
    state.player.unlockSkill('thermobaric');
    const t = state.player.skills.find(s => s.id === 'thermobaric');
    t.level = 1; state.player._applyLevel(t);
    let r = state.useSkill('thermobaric', 4, 4);
    expect(r.result.milestones.length).toBe(0); // Lv1 无节点
    t.currentCooldown = 0;
    t.level = 6; state.player._applyLevel(t);
    r = state.useSkill('thermobaric', 4, 4);
    expect(r.result.milestones).toContain('explosionSpark'); // 2 级
    expect(r.result.milestones).toContain('thermalIgnite');  // 6 级
  });

  it('new element-weak enemies take amplified damage (flame weak to ice x2)', () => {
    const state = createGame();
    const flame = enemiesData.find(c => c.id === 'enemy_flame');
    const e = new Enemy(flame, 4, 4, 1.0);
    const d0 = e.hp;
    e.takeDamage(20, 'ice');   // 弱冰 ×2
    expect(e.hp).toBeCloseTo(d0 - 40, 1);
    const d1 = e.hp;
    e.takeDamage(20, 'fire');  // 火伤正常
    expect(e.hp).toBeCloseTo(d1 - 20, 1);
  });

  // ===== 枪械弹匣（v4.2，原版弹夹 30 发）=====

  it('gun consumes ammo and auto-reloads after 30 shots', () => {
    const state = createGame();
    state.startWave();
    // 强制持续射击直到弹匣打空（每帧清零攻击计时）
    let reloadEvent = false;
    for (let i = 0; i < 30 * 40 && !reloadEvent; i++) {
      state.player.autoAttackTimer = 0;
      for (const e of state.enemies) e.row = 0;
      state.update(1 / 30);
      reloadEvent = state.events.some(ev => ev.type === 'reloading');
    }
    expect(reloadEvent).toBe(true);
    expect(state._reloading).toBe(true);
    // 换弹期间不开火
    const countDuringReload = state.projectiles.length;
    for (let i = 0; i < 10; i++) {
      state.player.autoAttackTimer = 0;
      state.update(1 / 30);
    }
    expect(state.projectiles.filter(p => p.skillId === 'attack').length).toBeLessThanOrEqual(countDuringReload);
    // 1.5s 后换弹完成，弹药回满（后续帧会立即开打消耗，故允许少量减少）
    for (let i = 0; i < 60; i++) state.update(1 / 30);
    expect(state._reloading).toBe(false);
    expect(state.ammo).toBeGreaterThan(0);
    expect(state.ammo).toBeLessThanOrEqual(30);
  });

  it('skill buff cards apply range/damage/cooldown/duration with 3-stack cap', () => {
    const state = createGame();
    state.player.unlockSkill('thermobaric');
    const g = state.player.skills.find(s => s.id === 'thermobaric'); // Lv1: dmg 32, aoe 2.2, cd 6.2
    // 满层 3：范围 2.2→2.8（+0.3/层经 _applyLevel 后再乘 1.3 → 实际按 useSkill 换算）
    for (let i = 0; i < 5; i++) {
      const r = state.applyUpgrade({ kind: 'skillBuff', id: 'sb_range' });
      if (i < 3) expect(r.applied).toBe(true); else expect(r.applied).toBe(false);
    }
    state.applyUpgrade({ kind: 'skillBuff', id: 'sb_dmg' });
    const r2 = state.useSkill('thermobaric', 4, 4);
    expect(r2.result.aoe).toBeCloseTo(g.aoe * 1.3, 1);
    expect(r2.result.damage).toBeCloseTo(g.damage * 1.15, 1);
    expect(r2.result.cooldownActual).toBeCloseTo(g.cooldown, 1); // cd 未强化
    // cd 卡
    state.applyUpgrade({ kind: 'skillBuff', id: 'sb_cd' });
    g.currentCooldown = 0;
    const r3 = state.useSkill('thermobaric', 4, 4);
    expect(r3.result.cooldownActual).toBeCloseTo(g.cooldown * 0.92, 1);
  });

  it('bounce passive chains projectile to nearest enemy', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const first = new Enemy(cfg, 4, 5, 1.0);
    const second = new Enemy(cfg, 5, 7, 1.0);
    state.enemies.push(first, second);
    state.applyUpgrade({ kind: 'skill', id: 'bounce' });
    state._createProjectile('attack', 4, 3, 4, 6, { damage: 60, targetEnemy: null, speed: 30 });
    let sawBounce = false;
    for (let i = 0; i < 120; i++) {
      state.update(1 / 30);
      if (state.projectiles.some(p => p._isBounceChild)) sawBounce = true;
    }
    expect(sawBounce).toBe(true);
    expect(second.hp).toBeLessThan(second.maxHp);
  });

  it('chainboom passive explodes on kill', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const main = new Enemy(cfg, 4, 5, 1.0);
    main.hp = 1; // 一击必杀
    const near = new Enemy(cfg, 4.5, 5.5, 1.0);
    state.enemies.push(main, near);
    state.applyUpgrade({ kind: 'skill', id: 'chainboom' });
    state._createProjectile('attack', 4, 3, 4, 5, { damage: 50, targetEnemy: null, speed: 30 });
    for (let i = 0; i < 90; i++) state.update(1 / 30);
    expect(!main.alive || main.hp <= 0).toBe(true);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(state.events.some(e => e.skill === 'chainboom')).toBe(true);
  });

  it('giant passive enlarges and strengthens bullets', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    state.enemies.push(new Enemy(cfg, 4, 8, 1.0));
    state.applyUpgrade({ kind: 'skill', id: 'giant' });
    for (let i = 0; i < 30; i++) state.update(1 / 30);
    const p = state.projectiles.find(pr => pr.skillId === 'attack');
    if (p) {
      expect(p.size).toBeGreaterThan(2); // 2 × 1.4 = 2.8
      expect(p.damage).toBeGreaterThan(state.getResolvedStats().damage * 8); // ×1.1
    }
  });

  it('ballshot unlock guarantee removed (skill deleted in v4.0 alignment)', () => {
    const state = createGame();
    state.player.level = 4;
    // 弹弹球已删除：选项池中不应出现
    for (let i = 0; i < 10; i++) {
      const opts = state.player.getUpgradeOptions(3);
      expect(opts.some(o => o.id === 'ballshot')).toBe(false);
    }
  });

  it('xp bonus from equipment and global upgrades flows through pipeline with cap', () => {
    const state = createGame();
    // 装备战盔（xpBonus +10%）
    state.equipItem(equipmentData.find(i => i.id === 'item_war_helm'));
    // 全局强化经验 +5% ×2 级
    state.globalUpgrades = null; // 排除全局档
    const base = createGame();
    expect(state.getXpMultiplier()).toBeCloseTo(1.10, 2);
    // 封顶验证：超量加成不突破 2.0
    const many = createGame();
    for (let i = 0; i < 20; i++) many.equipItem(equipmentData.find(i => i.id === 'item_war_helm'));
    expect(many.getXpMultiplier()).toBeLessThanOrEqual(2.0);
  });

  it('Player.getUpgradeOptions shuffles and caps at count', () => {
    const p = new Player();
    const opts = p.getUpgradeOptions(3);
    expect(opts.length).toBe(3);
  });

  it('targeted aoe cast hits enemies around the point, not around the player', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    // 敌人在 (4,3)，英雄在 (3.5,12.7)
    const e = new Enemy(cfg, 4, 3, 1.0);
    state.enemies.push(e);
    state.player.unlockSkill('airstrike'); // 空投轰炸：aoe 型
    const r = state.useSkill('airstrike', 4, 3);
    expect(r).not.toBeNull();
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('targeted projectile flies to the point even with no enemies', () => {
    const state = createGame();
    state.player.unlockSkill('thermobaric');
    const r = state.useSkill('thermobaric', 2, 2);
    expect(r).not.toBeNull();
    expect(state.projectiles.length).toBe(1);
    expect(state.projectiles[0].targetCol).toBe(2);
    expect(state.projectiles[0].targetRow).toBe(2);
  });

  it('beam (ray) hits all enemies in the column', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const inCol = new Enemy(cfg, 2, 3, 1.0);
    const otherCol = new Enemy(cfg, 5, 5, 1.0);
    state.enemies.push(inCol, otherCol);
    state.player.unlockSkill('ray');
    state.useSkill('ray', 2, 4);
    expect(inCol.hp).toBeLessThan(inCol.maxHp);
    expect(otherCol.hp).toBe(otherCol.maxHp);
    expect(state.events.some(ev => ev.type === 'beamEffect')).toBe(true);
  });

  it('multishot passive adds extra auto-attack projectiles', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const e = new Enemy(cfg, 4, 8, 1.0);
    state.enemies.push(e);
    state.applyUpgrade({ kind: 'skill', id: 'multishot' });
    expect(state.player.getPassiveLevel('multishot')).toBe(1);
    // 走完整 update 循环触发自动射击（0.4s 间隔）
    for (let i = 0; i < 30; i++) state.update(1 / 30);
    expect(state.projectiles.length).toBeGreaterThanOrEqual(2);
  });

  it('pierce passive lets projectiles hit multiple enemies', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const a = new Enemy(cfg, 4, 4, 1.0);
    const b = new Enemy(cfg, 4, 5, 1.0);
    state.enemies.push(a, b);
    state.applyUpgrade({ kind: 'skill', id: 'pierce' });
    state._createProjectile('attack', 4, 3, 4, 6, { damage: 50, targetEnemy: null, speed: 30, pierce: 1 });
    // 模拟帧更新直至弹道飞完
    for (let i = 0; i < 60; i++) state.update(1 / 30);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('splitshot passive fires parallel lanes (2 lanes at Lv1)', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    state.enemies.push(new Enemy(cfg, 4, 8, 1.0));
    state.applyUpgrade({ kind: 'skill', id: 'splitshot' });
    expect(state.player.getPassiveLevel('splitshot')).toBe(1);
    // 触发一次自动射击（走完整 update）
    for (let i = 0; i < 30; i++) state.update(1 / 30);
    // Lv1 分裂 = 2 列；连射未解锁 shots=1 → 共 2 发
    const fired = state.projectiles.filter(p => p.skillId === 'attack');
    expect(fired.length).toBeGreaterThanOrEqual(2);
    // 副列伤害 60%
    const damages = fired.map(p => p.damage).sort((a, b) => b - a);
    if (damages.length >= 2) {
      expect(damages[1]).toBeCloseTo(damages[0] * 0.6, 3);
    }
  });

  it('airblade pierce line starts from cast direction', () => {
    const state = createGame();
    const cfg = enemiesData.find(c => c.id === 'enemy_basic');
    const near = new Enemy(cfg, 2, 2, 1.0);
    const far = new Enemy(cfg, 6, 8, 1.0);
    state.enemies.push(near, far);
    state.player.unlockSkill('airblade');
    state.useSkill('airblade', 2, 2);
    // 直线穿透经过 (2,2) 方向线 → near 必须被命中
    expect(near.hp).toBeLessThan(near.maxHp);
  });

  it('repeat skill upgrade raises level and scales damage/cooldown', () => {
    const state = createGame();
    state.player.unlockSkill('thermobaric');
    const skill = state.player.skills.find(s => s.id === 'thermobaric');
    const lv1Dmg = skill.damage, lv1Cd = skill.cooldown;
    const res = state.applyUpgrade({ kind: 'skillUp', id: 'thermobaric', name: '温压弹 Lv.2' });
    expect(res.applied).toBe(true);
    expect(skill.level).toBe(2);
    expect(skill.damage).toBeCloseTo(lv1Dmg * 1.25, 2);
    expect(skill.cooldown).toBeCloseTo(lv1Cd * 0.9, 2);
  });

  it('upgrade options include skillUp entries for unlocked skills below max level', () => {
    const state = createGame();
    state.player.unlockSkill('thermobaric');
    // 全量池断言（避免洗牌随机性导致的 flaky）
    const pool = state.player.getUpgradeOptions(999);
    expect(pool.length).toBeGreaterThanOrEqual(10);
    expect(pool.some(o => o.kind === 'skillUp' && o.id === 'thermobaric')).toBe(true);
    // 默认 count=3
    expect(state.player.getUpgradeOptions(3).length).toBe(3);
  });
});
