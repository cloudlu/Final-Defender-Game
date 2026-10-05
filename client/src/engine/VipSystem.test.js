import { describe, it, expect } from 'vitest';
import { VipSystem, VIP_LEVELS, PERK_NAMES } from './VipSystem.js';

describe('VipSystem (v7.10 原版对齐: 功能性特权)', () => {
  it('defaults to level 0', () => {
    const v = new VipSystem();
    expect(v.level).toBe(0);
  });

  it('setInfo updates level', () => {
    const v = new VipSystem();
    v.setInfo({ vipLevel: 3, vipExp: 60 });
    expect(v.level).toBe(3);
  });

  it('perk names resolve for current level', () => {
    const v = new VipSystem({ vipLevel: 1, vipExp: 6 });
    expect(v.getPerkNames()).toContain('快速战斗次数+1');
  });

  it('next level yuan threshold', () => {
    const v = new VipSystem({ vipLevel: 1, vipExp: 6 });
    expect(v.nextLevelYuan).toBe(30); // VIP2 需要 30 元
    const max = new VipSystem({ vipLevel: 15, vipExp: 40000 });
    expect(max.nextLevelYuan).toBeNull(); // 满级
  });

  it('VIP table matches original game thresholds (15 tiers)', () => {
    const expected = [6, 30, 60, 120, 200, 300, 600, 1200, 2000, 4000, 6000, 12000, 20000, 28000, 40000];
    const actual = VIP_LEVELS.filter(l => l.level > 0).map(l => l.requiredYuan);
    expect(actual).toEqual(expected);
  });
});
