import { describe, it, expect } from 'vitest';

/** v8.23：一键穿戴最强的选件逻辑（与 ForgePanel._equipBestAll 同构的纯逻辑） */
describe('一键穿戴最强', () => {
  // 与 ForgePanel.score 同构的简化评分
  const score = (e) => e.affixes.reduce((s, a) => s + (a.pct ? a.value : a.value), 0) + e.tier * 3;

  function equipBestAll(inventory, equipped) {
    const SLOTS = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
    let changed = 0;
    for (const slot of SLOTS) {
      const pool = inventory.filter(i => i.slot === slot);
      if (pool.length === 0) continue;
      pool.sort((a, b) => score(b) - score(a));
      const best = pool[0];
      if (equipped[slot] === best.uid) continue;
      equipped[slot] = best.uid;
      changed++;
    }
    return changed;
  }

  it('每部位穿评分最高件，部位间互不干扰', () => {
    const inventory = [
      { uid: 1, slot: 'weapon', tier: 1, affixes: [{ value: 5, pct: true }] },   // 弱
      { uid: 2, slot: 'weapon', tier: 5, affixes: [{ value: 25, pct: true }] },  // 强
      { uid: 3, slot: 'helmet', tier: 3, affixes: [{ value: 10, pct: true }] },
    ];
    const equipped = {};
    const changed = equipBestAll(inventory, equipped);
    expect(changed).toBe(2); // 只有 weapon/helmet 两个部位有库存（其余部位 pool 为空跳过）
    expect(equipped.weapon).toBe(2); // 战力高的胜出
    expect(equipped.helmet).toBe(3);
    // 再跑一遍：无变化（幂等）
    expect(equipBestAll(inventory, equipped)).toBe(0);
  });

  it('已穿最强件的部位不重复计数', () => {
    const inventory = [
      { uid: 1, slot: 'weapon', tier: 9, affixes: [{ value: 30, pct: true }] },
      { uid: 2, slot: 'weapon', tier: 1, affixes: [{ value: 3, pct: true }] },
    ];
    const equipped = { weapon: 1 }; // 已穿最强
    expect(equipBestAll(inventory, equipped)).toBe(0);
    expect(equipped.weapon).toBe(1);
  });
});
