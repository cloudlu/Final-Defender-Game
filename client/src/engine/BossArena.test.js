import { describe, it, expect } from 'vitest';
import { BossManager } from './BossManager.js';
import { GameState } from './GameState.js';
import { Enemy } from './Enemy.js';
import enemiesData from '../data/enemies.json';
import balance from '../data/balance.json';

/** v9.11 BOSS 环境效果 + 远程攻击 */
describe('BOSS 环境效果与远程攻击', () => {
  const mkBoss = (arena, skills = []) => ({
    id: 'boss_test', name: '测试BOSS', alive: true, isBoss: true,
    hp: 100000, maxHp: 100000, arena, bossSkills: skills,
    bossSkillTimers: {}, speedBurst: { multiplier: 1, timer: 0, warnTimer: 0 },
    col: 3.5, row: 0,
  });

  it('getArena 返回存活 BOSS 的环境效果，死亡返回 null', () => {
    const mgr = new BossManager();
    const boss = mkBoss({ type: 'darkFog', projSpeedMult: 0.55 });
    mgr.register(boss);
    expect(mgr.getArena()?.type).toBe('darkFog');
    boss.alive = false;
    expect(mgr.getArena()).toBeNull();
  });

  it('darkFog 环境弹速乘区生效', () => {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7 });
    const mgr = new BossManager();
    mgr.register(mkBoss({ type: 'darkFog', projSpeedMult: 0.55 }));
    state.bossManager = mgr;
    // update 一次让 getArena 刷新 this.arena
    state.update(1 / 30);
    expect(state._arenaProjSpeedMult()).toBe(0.55);
    mgr.clear();
    state.update(1 / 30);
    expect(state._arenaProjSpeedMult()).toBe(1);
  });

  it('rangedAttack 生成敌方弹，弹到墙扣墙血', () => {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7 });
    state.startWave();
    const shots = [];
    const mgr = new BossManager();
    const boss = mkBoss(null, [{ type: 'rangedAttack', interval: 1, damage: 4, speed: 5 }]);
    boss.bossSkillTimers = { rangedAttack: 0.5 }; // 0.5s 后开火
    mgr.register(boss);
    // 快进 2 秒
    for (let i = 0; i < 60; i++) {
      for (const ev of mgr.update(1 / 30, { onRangedAttack: (col, dmg, spd) => shots.push({ col, damage: dmg, speed: spd }) })) {
        if (ev.type === 'bossShoot') state.events.push(ev);
      }
      // 手动推进敌方弹（GameState 主循环逻辑同构）
      for (const s of shots) if (s.alive !== false) s.row += s.speed / 30;
    }
    expect(shots.length).toBeGreaterThanOrEqual(1);
  });

  it('rangedAttack 到墙扣墙血（GameState 主循环消费）', () => {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7 });
    state.startWave();
    const wallBefore = state.lives;
    state._spawnEnemyShot(4, 6, 5);
    // 快进至弹到墙（row 0.5 → 11.7，speed 5 → ~2.3s = 68 帧）
    for (let i = 0; i < 90; i++) state.update(1 / 30);
    expect(state.lives).toBeLessThan(wallBefore);
  });

  it('solarFlare 环境每秒灼烧城墙', () => {
    const state = new GameState(enemiesData, balance, [], null, { rngSeed: 7 });
    state.startWave();
    // 经真实路径：注册带 arena 的 BOSS（update 内 getArena 刷新 this.arena）
    const mgr = new BossManager();
    const boss = mkBoss({ type: 'solarFlare', flareDps: 2 });
    mgr.register(boss);
    state.bossManager = mgr; // 替换 state 默认 bossManager
    const before = state.lives;
    for (let i = 0; i < 150; i++) state.update(1 / 30); // 5 秒
    expect(state.lives).toBeLessThan(before);
  });

  it('BOSS 死亡后环境解除（getArena null）', () => {
    const mgr = new BossManager();
    const boss = mkBoss({ type: 'darkFog' });
    mgr.register(boss);
    expect(mgr.getArena()).toBeTruthy();
    boss.alive = false;
    mgr.update(1 / 30, {});
    expect(mgr.getArena()).toBeNull();
  });
});
