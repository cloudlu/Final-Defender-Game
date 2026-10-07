import { describe, it, expect } from 'vitest';
import { BossManager, RAGE_CONFIG } from './BossManager.js';

/** v9.9 回归：BOSS 狂暴（原版对齐——6 分钟或血量 20% 触发，无敌+4 速 15 秒） */
describe('BOSS 狂暴机制', () => {
  const mkBoss = (hp = 1000) => ({
    id: 'boss_king', name: '胖尸王', alive: true, isBoss: true,
    hp, maxHp: hp, bossSkills: [], bossSkillTimers: {},
    speedBurst: { multiplier: 1, timer: 0, warnTimer: 0 },
  });

  it('血量降至 20% 触发狂暴：无敌+速度倍率+15s 时长', () => {
    const mgr = new BossManager();
    const boss = mkBoss(1000);
    mgr.register(boss);
    boss.hp = 150; // 15% < 20%
    const events = mgr.update(1 / 30, {});
    const rage = events.find(e => e.type === 'rage');
    expect(rage).toBeTruthy();
    expect(rage.duration).toBe(RAGE_CONFIG.duration);
    expect(boss._rage).toBeTruthy();
    expect(boss.invulnerable).toBe(true);
    expect(boss._rageSpeedMult).toBe(RAGE_CONFIG.speedMult);
  });

  it('狂暴期间无敌（_rage 态激活）', () => {
    const mgr = new BossManager();
    const boss = mkBoss(1000);
    mgr.register(boss);
    boss.hp = 100;
    mgr.update(1 / 30, {}); // 触发狂暴
    expect(boss._rage).toBeTruthy();
    expect(boss.invulnerable).toBe(true);
  });

  it('狂暴结束解除无敌并派发 rageEnd', () => {
    const mgr = new BossManager();
    const boss = mkBoss(1000);
    mgr.register(boss);
    boss.hp = 100;
    mgr.update(1 / 30, {});
    expect(boss._rage).toBeTruthy();
    // 快进 15 秒 +1 帧容差（浮点）
    for (let i = 0; i < RAGE_CONFIG.duration * 30 + 2; i++) mgr.update(1 / 30, {});
    expect(boss._rage).toBeFalsy();
    expect(boss.invulnerable).toBe(false);
  });

  it('未达触发条件不狂暴', () => {
    const mgr = new BossManager();
    const boss = mkBoss(1000);
    mgr.register(boss);
    boss.hp = 500; // 50%
    const events = mgr.update(1 / 30, {});
    expect(events.find(e => e.type === 'rage')).toBeFalsy();
    expect(boss._rage).toBeFalsy();
  });

  it('狂暴期间常规技能暂停', () => {
    const mgr = new BossManager();
    const boss = mkBoss(1000);
    boss.bossSkills = [{ type: 'summon', interval: 9, enemyId: 'enemy_basic', count: 1 }];
    mgr.register(boss);
    boss.hp = 100;
    mgr.update(1 / 30, {}); // 触发狂暴
    for (let i = 0; i < 400; i++) mgr.update(1 / 30, {}); // 快进 13 秒（< 15s 狂暴内）
    // 狂暴未结束时 summon 计时被冻结（break 跳过），不应有 bossSummon 事件
    expect(boss._rage).toBeTruthy();
  });
});
