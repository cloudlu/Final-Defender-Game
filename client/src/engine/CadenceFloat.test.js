import { describe, it, expect } from 'vitest';
import { Player } from './Player.js';

/** v8.9 回归：setAttackCadence 写入的冷却/间隔不得带浮点尾数（用户看到 0.220000000000003s） */
describe('射击节奏浮点取整', () => {
  it('gun.cooldown 与 autoAttackInterval 永远 ≤3 位小数', () => {
    const p = new Player();
    // 模拟各类攻速（含除不尽的连分数）
    for (const speed of [1, 1.176, 1.42857142857, 1.8181818181811818, 2.0, 1.3333333333]) {
      p.setAttackCadence(0.4 / speed);
      const dec = (v) => (String(v).split('.')[1] || '').length;
      expect(dec(p.autoAttackInterval)).toBeLessThanOrEqual(3);
      const gun = p.skills.find(s => s.id === 'attack');
      expect(dec(gun.cooldown)).toBeLessThanOrEqual(3);
      expect(String(p.autoAttackInterval)).not.toMatch(/\d{4,}$/); // 无长尾数
    }
  });

  it('升级预览描述中的冷却无浮点尾数（用户报告的 0.220000000000003s 场景）', () => {
    const p = new Player();
    p.setAttackCadence(0.22); // 攻速覆盖后
    const gun = p.skills.find(s => s.id === 'attack');
    const nextCd = Math.round(gun.cooldown * 0.9 * 100) / 100;
    const desc = `冷却 ${gun.cooldown}s→${nextCd}s`;
    expect(desc).not.toContain('0000000');
    expect(desc).toMatch(/冷却 0\.22s→0\.2s/);
  });
});
