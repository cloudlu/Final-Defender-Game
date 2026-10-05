import { describe, it, expect } from 'vitest';
import { GemSystem } from './GemSystem.js';
import gemsData from '../data/gems.json';

/** v8.7 原版对齐：宝石战力评分（战力=攻击聚合，数值=品质定档无随机） */
describe('GemSystem 战力评分', () => {
  const mk = () => new GemSystem(gemsData, { collection: {}, sockets: {}, nextUid: 1 });

  it('gemValue 数值由品质定档（无随机）——对齐原版数值表', () => {
    const g = mk();
    const atkGem = { affixId: 'atk', quality: 0 };
    expect(g.gemValue(atkGem)).toBe(10);  // 白
    expect(g.gemValue({ affixId: 'atk', quality: 3 })).toBe(40);  // 紫
    expect(g.gemValue({ affixId: 'atk', quality: 6 })).toBe(70);  // 至尊
  });

  it('gemPower：废宝石（值0）计0分，词条分随品质单调升', () => {
    const g = mk();
    expect(g.gemPower({ affixId: 'coat_icerank', quality: 2 })).toBe(0); // 至尊词条蓝品质=废
    const p1 = g.gemPower({ affixId: 'atk', quality: 0 });
    const p2 = g.gemPower({ affixId: 'atk', quality: 3 });
    const p3 = g.gemPower({ affixId: 'atk', quality: 6 });
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it('功能型词条（秒杀/头选）固定高分——攻略共识：百分比>穿透>秒杀>传送', () => {
    const g = mk();
    const ik = g.gemPower({ affixId: 'pants_instantkill', quality: 3 }); // 秒杀 3%
    const tp = g.gemPower({ affixId: 'shoes_teleport', quality: 4 });    // 传送 2%
    expect(ik).toBe(200);
    expect(tp).toBe(100);
    expect(ik).toBeGreaterThan(tp);
  });

  it('镶嵌宝石提升全局战力（镶→卸 可逆）', () => {
    const g = mk();
    const uid = 'gT1';
    g.save.collection[uid] = { affixId: 'atk', quality: 3 }; // 紫 40 攻
    g.equip('weapon', 0, uid);
    const withGem = g.getTotalGemPower();
    expect(withGem).toBe(40);
    g.unequip('weapon', 0);
    expect(g.getTotalGemPower()).toBe(0);
  });

  /** 回归（v8.19）：套装分支（镶满 12 孔）——旧代码引用未限定类名的 BASE_POWER_UNIT 直接 ReferenceError */
  it('套装加成分支不崩且计入总分（12 孔镶满）', () => {
    const g = mk();
    const SLOTS = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
    let n = 0;
    for (const slot of SLOTS) {
      for (let i = 0; i < 2; i++) {
        const uid = `gS${n++}`;
        g.save.collection[uid] = { affixId: 'atk', quality: 0 }; // 白 10 攻
        g.equip(slot, i, uid);
      }
    }
    // 12 颗 × 10 = 120 + 套装 12% × BASE_POWER_UNIT(1) = 12 → 132
    expect(g.getSocketedCount()).toBe(12);
    expect(g.getTotalGemPower()).toBe(132);
  });
});
