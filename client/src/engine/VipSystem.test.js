import { describe, it, expect } from 'vitest';
import { VipSystem, VIP_LEVELS } from './VipSystem.js';
import { ModifierPipeline } from './ModifierPipeline.js';

describe('VipSystem', () => {
  it('defaults to level 0 with no bonus', () => {
    const v = new VipSystem();
    expect(v.level).toBe(0);
    expect(v.getAllModifiers().length).toBe(0);
  });

  it('setInfo updates level and emits goldBonus modifier', () => {
    const v = new VipSystem();
    v.setInfo({ vipLevel: 3, vipExp: 9800, goldBonus: 0.3 });
    const mods = v.getAllModifiers();
    expect(mods.length).toBe(1);
    expect(mods[0]).toMatchObject({ source: 'vip', stat: 'goldBonus', type: 'mul_pct', value: 0.3 });
  });

  it('nextLevelExp returns null at max level', () => {
    const v = new VipSystem({ vipLevel: 6, vipExp: 64800, goldBonus: 0.6 });
    expect(v.nextLevelExp).toBeNull();
    const v2 = new VipSystem({ vipLevel: 1, vipExp: 600, goldBonus: 0.1 });
    expect(v2.nextLevelExp).toBe(3000);
  });

  it('VIP gold bonus does NOT break pipeline cap (§13.4 护栏)', () => {
    // VIP6 = +60% 金币；其他来源 +100% → 合并 Σmul_pct = 1.6 → 2.0 base × 2.6 = 5.2 → cap 2x base = 4
    const pipeline = new ModifierPipeline({ goldBonus: 2.0 });
    const vip = new VipSystem({ vipLevel: 6, vipExp: 64800, goldBonus: 0.6 });
    const mods = [
      ...vip.getAllModifiers(),
      { id: 'g_gold', source: 'global', stat: 'goldBonus', type: 'mul_pct', value: 1.0 },
    ];
    const result = pipeline.resolve(2, 'goldBonus', mods); // base bounty 2
    expect(result).toBe(4); // capped at 2x base（免费玩家可到 90% 上限的对齐验证）
  });
});
