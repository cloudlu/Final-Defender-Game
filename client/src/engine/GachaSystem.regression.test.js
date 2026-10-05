import { describe, it, expect } from 'vitest';
import { GachaSystem } from './GachaSystem.js';
import { SeededRNG } from './SeededRNG.js';
import { GemSystem } from './GemSystem.js';
import equipmentData from '../data/equipment.json';
import gemsData from '../data/gems.json';

/** 回归：MenuScene 真实传参路径——旧档 globalSave 无 pity/ownedRefIds 时 pull 不崩（v8.4 前在此崩溃） */
describe('GachaSystem regression (menu real wiring)', () => {
  const freshGlobalSave = () => ({
    gold: 100000, diamond: 100000,
    levels: {}, equipment: { inventory: [], nextUid: 1 },
    gems: { collection: {}, sockets: {}, nextUid: 1 },
    mercs: { owned: {}, deployed: [null, null] },
  });
  const realGemSystem = (save) => new GemSystem(gemsData, save.gems);

  it('pull works when save lacks pity/ownedRefIds skeleton', () => {
    const save = freshGlobalSave();
    const g = new GachaSystem(
      equipmentData, save, undefined,
      { addEquipment: () => {} },
      { acquire: () => ({ isNew: true }) },
      realGemSystem(save),
    );
    let gemCount = 0, mercCount = 0;
    for (let i = 0; i < 60; i++) {
      const r = g.pull('diamond', 1, save, new SeededRNG(i + 1));
      expect(r).not.toBeNull();
      for (const x of r.results) {
        if (x.item.gemUid) gemCount++;
        if (x.item.mercId) mercCount++;
      }
    }
    expect(gemCount).toBeGreaterThan(0);
    expect(g.save.pity.diamond).toBeGreaterThanOrEqual(0);
    expect(g.save.totalPulls).toBe(60);
    expect(Object.keys(save.gems.collection).length).toBe(gemCount);
  });

  /** 回归（v8.6）：抽卡宝石掉落必须尊重词条 minQuality 门槛——白品质不得再出"冰系冻伤+0"废宝石 */
  it('gem drops respect affix minQuality (no dead +0 gems at low quality)', () => {
    const save = freshGlobalSave();
    const g = new GachaSystem(
      equipmentData, save, undefined,
      { addEquipment: () => {} },
      { acquire: () => ({ isNew: true }) },
      realGemSystem(save),
    );
    const deadGems = [];
    for (let i = 0; i < 200; i++) {
      const r = g.pull('diamond', 1, save, new SeededRNG(i + 7));
      for (const x of r.results) {
        if (!x.item.gemUid) continue;
        const gem = save.gems.collection[x.item.gemUid];
        const v = g.gemSystem.gemValue(gem);
        if (v <= 0) deadGems.push(gem);
      }
    }
    expect(deadGems).toHaveLength(0);
  });

  it('mercenary branch no longer mis-wired (mercenarySystem actually receives acquire)', () => {
    const save = freshGlobalSave();
    let acquired = 0;
    const g = new GachaSystem(
      equipmentData, save, undefined,
      { addEquipment: () => {} },
      { acquire: () => { acquired++; return { isNew: true }; } },
      realGemSystem(save),
    );
    for (let i = 0; i < 80; i++) g.pull('diamond', 1, save, new SeededRNG(i + 100));
    expect(acquired).toBeGreaterThan(0);
  });

  /** 回归：GachaPanel 传入的表现层 rng 只有 next()（无 nextInt），佣兵分支不得假设 SeededRNG（v8.5 前在此崩溃） */
  it('pull works with bare next()-only rng (panel-layer rng contract)', () => {
    const save = freshGlobalSave();
    const g = new GachaSystem(
      equipmentData, save, undefined,
      { addEquipment: () => {} },
      { acquire: () => ({ isNew: true }) },
      realGemSystem(save),
    );
    let mercCount = 0;
    const bareRng = { next: () => Math.random() }; // GachaPanel 实际传入的形态
    for (let i = 0; i < 120; i++) {
      const r = g.pull('diamond', 1, save, bareRng);
      expect(r).not.toBeNull();
      for (const x of r.results) if (x.item.mercId) mercCount++;
    }
    expect(mercCount).toBeGreaterThan(0); // 佣兵分支（30% 内 20%）在 120 抽中必达
  });
});
