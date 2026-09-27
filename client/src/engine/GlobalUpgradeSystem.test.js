import { describe, it, expect } from 'vitest';
import { GlobalUpgradeSystem } from './GlobalUpgradeSystem.js';
import { XpOrbSystem } from './XpOrbSystem.js';
import globalUpgradesData from '../data/globalUpgrades.json';
import { Player } from './Player.js';

describe('GlobalUpgradeSystem', () => {
  it('starts at level 0 with correct first cost', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    expect(s.getLevel('g_attack')).toBe(0);
    expect(s.getNextCost('g_attack')).toBe(200);
  });

  it('cost scales exponentially', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    s.upgrade('g_attack', 10000);
    expect(s.getNextCost('g_attack')).toBe(Math.round(200 * 1.35));
  });

  it('upgrade deducts nothing itself; validates gold passed in', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    expect(s.upgrade('g_attack', 100).success).toBe(false);
    const r = s.upgrade('g_attack', 200);
    expect(r.success).toBe(true);
    expect(s.getLevel('g_attack')).toBe(1);
  });

  it('respects maxLevel', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    const cfg = globalUpgradesData.upgrades.find(u => u.id === 'g_xp');
    for (let i = 0; i < cfg.maxLevel; i++) s.upgrade('g_xp', 999999);
    expect(s.getNextCost('g_xp')).toBeNull();
    expect(s.upgrade('g_xp', 999999).reason).toBe('maxed');
  });

  it('getAllModifiers emits pipeline modifiers with source global', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    s.upgrade('g_attack', 999999);
    s.upgrade('g_gold', 999999);
    const mods = s.getAllModifiers();
    expect(mods.some(m => m.stat === 'damage' && m.source === 'global' && m.value === 0.05)).toBe(true);
    expect(mods.some(m => m.stat === 'goldBonus' && m.value === 0.05)).toBe(true);
    expect(mods.some(m => m.stat === 'wallHp')).toBe(false); // 非管线 stat
  });

  it('wall and xp bonuses are consumed separately', () => {
    const s = new GlobalUpgradeSystem(globalUpgradesData.upgrades);
    s.upgrade('g_wall', 999999);
    s.upgrade('g_xp', 999999);
    expect(s.getWallHpBonus()).toBe(4);
    expect(s.getXpMultiplier()).toBeCloseTo(1.05, 5);
  });
});

describe('XpOrbSystem', () => {
  const player = { x: 3.5, y: 12.7 };
  const noRng = () => 0; // scatter 固定角度

  it('spawn scatters near kill point and hovers before attracting', () => {
    const s = new XpOrbSystem(player);
    s.spawn(4, 5, 1, noRng);
    expect(s.orbs.length).toBe(1);
    expect(s.orbs[0].state).toBe('hover');
    s.update(0.1, 1);
    expect(s.orbs[0].state).toBe('hover'); // still hovering (< hoverTime)
  });

  it('absorbs orb when it reaches the player, applying xp multiplier', () => {
    const s = new XpOrbSystem(player, { hoverTime: 0.1 });
    s.spawn(3.6, 12.6, 2, noRng);
    let absorbed = 0;
    for (let i = 0; i < 600 && absorbed === 0; i++) {
      absorbed += s.update(1 / 30, 1.5);
    }
    expect(absorbed).toBe(3); // 2 × 1.5
    expect(s.orbs.length).toBe(0);
  });
});

describe('GlobalUpgradeSystem + Player xp flow', () => {
  it('xp multiplier scales xp gained via Player.addXp', () => {
    const p = new Player();
    // xpToNext = 5；3 经验 × 1.5 倍 = 4.5 → round 后 5 → 升级
    expect(p.addXp(3).leveledUp).toBe(false);
    const r = p.addXp(Math.round(3 * 1.5));
    expect(r.leveledUp).toBe(true);
  });
});
