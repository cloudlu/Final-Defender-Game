import { describe, it, expect } from 'vitest';
import { GemSystem } from './GemSystem.js';
import gemsData from '../data/gems.json';

/** v8.20：一键合成循环收敛性（UI 循环同构逻辑）。构造确定性重复组而非随机撒（30 种词条随机难撞 3 同）。 */
describe('一键合成全部', () => {
  it('循环合成至无 3 同组，结果集收敛', () => {
    const g = new GemSystem(gemsData, { collection: {}, sockets: {}, nextUid: 1 });
    // 构造：3×白攻 + 3×白攻（共 6，合成后变 2 颗绿攻 → 又满 3 不够）+ 4×白暴击（合成 1 绿暴 + 剩 1）
    let n = 0;
    const add = (affixId) => {
      for (let i = 0; i < 3; i++) g.save.collection[`gA${n++}`] = { affixId, quality: 0 };
    };
    add('atk'); add('atk'); // 6 颗白攻
    for (let i = 0; i < 4; i++) g.save.collection[`gA${n++}`] = { affixId: 'crit', quality: 0 }; // 4 颗白暴击
    const before = Object.keys(g.save.collection).length;
    let done = 0, guard = 0;
    while (guard < 100) {
      guard++;
      const sock = new Set(g.getSocketed().map(x => x.uid));
      const groups = {};
      for (const [uid, gem] of Object.entries(g.save.collection)) {
        if (sock.has(uid)) continue;
        const key = `${gem.affixId}_${gem.quality}`;
        (groups[key] = groups[key] || []).push(uid);
      }
      const ready = Object.values(groups).find(arr => arr.length >= 3);
      if (!ready) break;
      const r = g.combine(ready.slice(0, 3));
      if (r.success) done++;
      else break;
    }
    expect(done).toBeGreaterThan(0);
    // 终态：任意词条×品质组 < 3
    const sock = new Set(g.getSocketed().map(x => x.uid));
    const g2 = {};
    for (const [uid, gem] of Object.entries(g.save.collection)) {
      if (sock.has(uid)) continue;
      const key = `${gem.affixId}_${gem.quality}`;
      (g2[key] = g2[key] || []).push(uid);
    }
    for (const arr of Object.values(g2)) expect(arr.length).toBeLessThan(3);
    console.log(`${before} 颗 → 合成 ${done} 组 → ${Object.keys(g.save.collection).length} 颗`);
  });
});
