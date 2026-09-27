import { describe, it, expect } from 'vitest';
import { MercenarySystem } from './MercenarySystem.js';
import mercData from '../data/mercenaries.json';

const freshSave = () => ({ owned: {}, deployed: [null, null] });
const rng01 = { next: () => 0 };

describe('MercenarySystem', () => {
  it('recruit grants new mercenary at Lv1 base quality; duplicate gives shards', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    const r1 = m.recruit(rng01); // rng.next()=0 → 第一位（火焰尖兵）
    expect(r1.isNew).toBe(true);
    expect(m.save.owned['merc_flame'].level).toBe(1);
    expect(m.save.owned['merc_flame'].quality).toBe('卓越');
    const r2 = m.recruit(rng01);
    expect(r2.isNew).toBe(false);
    expect(m.save.owned['merc_flame'].shards).toBe(2);
  });

  it('passive attack stacks from ALL owned mercenaries (no deploy needed)', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    m.acquire('merc_flame');  // 卓越 30
    m.acquire('merc_mg');     // 精良 15
    m.save.owned['merc_mg'].level = 30; // +90 等级加成（29×6.5≈188 floor）
    const total = m.getTotalPassiveAttack();
    expect(total).toBeGreaterThanOrEqual(30 + 15 + 100); // 保底品质加成+等级成长
  });

  it('deploy: two slots, no duplicates', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    m.acquire('merc_flame');
    m.acquire('merc_mg');
    expect(m.deploy(0, 'merc_flame')).toBe(true);
    expect(m.deploy(1, 'merc_flame')).toBe(false); // 重复上阵拒绝
    expect(m.deploy(1, 'merc_mg')).toBe(true);
    expect(m.getDeployed().length).toBe(2);
  });

  it('combat stats inherit player attack by quality ratio', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    m.acquire('merc_sniper'); // 精良 0.35 继承
    m.acquire('merc_chrono'); // 完美 0.5 继承
    m.deploy(0, 'merc_sniper');
    m.deploy(1, 'merc_chrono');
    const stats = m.getCombatStats(100); // 主角攻击 100
    const sniper = stats.find(s => s.id === 'merc_sniper');
    const chrono = stats.find(s => s.id === 'merc_chrono');
    // 狙击 0.35×0.7 系数 = 24.5
    expect(sniper.damage).toBeCloseTo(100 * 0.35 * 0.7, 1);
    // 超时空 0.5×1.64 = 82
    expect(chrono.damage).toBeCloseTo(100 * 0.5 * 1.64, 1);
  });

  it('level up costs gold and caps at 100', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    m.acquire('merc_mg');
    expect(m.levelUp('merc_mg', 1000).level).toBe(2);
    expect(m.levelUp('merc_mg', 0).reason).toBe('poor');
    m.save.owned['merc_mg'].level = 100;
    expect(m.levelUp('merc_mg', 999999).reason).toBe('maxed');
  });

  it('quality upgrade raises inherit tier', () => {
    const m = new MercenarySystem(mercData.mercenaries, freshSave());
    m.acquire('merc_mg'); // 精良
    m.save.owned['merc_mg'].contractShards = 100;
    const r = m.upgradeQuality('merc_mg');
    expect(r.success).toBe(true);
    expect(r.quality).toBe('卓越'); // 精良 → 卓越
  });
});
