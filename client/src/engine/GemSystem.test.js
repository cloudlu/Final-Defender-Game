import { describe, it, expect } from 'vitest';
import { GemSystem } from './GemSystem.js';
import gemData from '../data/gems.json';

const freshSave = () => ({ collection: {}, sockets: {}, nextUid: 1 });
const rng01 = { next: () => 0 }; // 恒 0 → 品质白/池第一词条

describe('GemSystem (v5.3 部位池+套装)', () => {
  it('generate from general pool at quality 0 (rng=0)', () => {
    const g = new GemSystem(gemData, freshSave());
    const gem = g.generate(rng01);
    expect(gem.quality).toBe(0);
    expect(g.gemName(gem)).toBe('攻击力'); // 通用池第一项
  });

  it('slot-specific pool: helmet can roll exclusive affixes (30% chance)', () => {
    const g = new GemSystem(gemData, freshSave());
    // 强制专属：next 序列 0.2(<0.3 专属)+0.5(选池内偏后词条)
    const rngCustom = { next: (() => { let n = 0; return () => [0.2, 0.99, 0.5][n++ % 3]; })() };
    const gem = g.generate(rngCustom, 'helmet');
    const names = g.config.slotAffixes.helmet.map(a => a.id);
    expect(names.includes(gem.affixId) || g.config.generalAffixes.some(a => a.id === gem.affixId)).toBe(true);
  });

  it('equip/re-equip auto unsockets', () => {
    const g = new GemSystem(gemData, freshSave());
    const a = g.generate(rng01);
    const b = g.generate(rng01);
    g.equip('weapon', 0, a.uid);
    g.equip('weapon', 1, b.uid);
    g.equip('pants', 0, a.uid);
    expect(g.save.sockets.weapon[0]).toBeNull();
    expect(g.save.sockets.pants[0]).toBe(a.uid);
  });

  it('element gems accumulate into specials.elements', () => {
    const g = new GemSystem(gemData, freshSave());
    const fire1 = 'gF1', fire2 = 'gF2';
    g.save.collection[fire1] = { affixId: 'fire_dmg', quality: 1 }; // 绿 8%
    g.save.collection[fire2] = { affixId: 'fire_dmg', quality: 2 }; // 蓝 12%
    g.equip('weapon', 0, fire1);
    g.equip('coat', 0, fire2);
    const { specials } = g.getAllModifiers();
    expect(specials.elements.fire).toBe(20); // 8+12 叠加
  });

  it('elite damage gem (bracers exclusive) flows to specials', () => {
    const g = new GemSystem(gemData, freshSave());
    const elite = 'gE';
    g.save.collection[elite] = { affixId: 'bracer_elite', quality: 6 }; // 至尊 140%
    g.equip('bracers', 0, elite);
    const { specials } = g.getAllModifiers();
    expect(specials.eliteDamage).toBe(140);
  });

  it('set bonus: 12 socketed gems → damage +12%', () => {
    const g = new GemSystem(gemData, freshSave());
    // 镶满 12 孔
    const slots = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
    slots.forEach(s => {
      for (let i = 0; i < 2; i++) {
        const gem = g.generate(rng01);
        g.equip(s, i, gem.uid);
      }
    });
    const { mods } = g.getAllModifiers();
    expect(mods.some(m => m.id === 'gem_set_bonus' && m.value === 0.12)).toBe(true);
  });

  it('combine upgrades quality, respects socketed protection', () => {
    const g = new GemSystem(gemData, freshSave());
    const a = g.generate(rng01), b = g.generate(rng01), c = g.generate(rng01);
    const r = g.combine([a.uid, b.uid, c.uid]);
    expect(r.success).toBe(true);
    expect(r.gem.quality).toBe(1);
    g.equip('weapon', 0, r.gem.uid);
    const d = g.generate(rng01), e2 = g.generate(rng01);
    const u1 = 'gX1';
    g.save.collection[u1] = { affixId: g.gemName({ affixId: d.affixId }) === '攻击力' ? d.affixId : d.affixId, quality: d.quality };
    g.save.collection[u1] = { ...g.save.collection[u1] };
    // 用同词条但其中一件在镶 → socketed
    g.save.collection[u1] = { affixId: d.affixId, quality: d.quality };
    const r2 = g.combine([d.uid, e2.uid, r.gem.uid]);
    expect(r2.reason).toBe('socketed');
  });
});
