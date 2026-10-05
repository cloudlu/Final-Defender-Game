import { describe, it, expect } from 'vitest';
import { EquipmentForgeSystem, QUALITY_ORDER, QUALITY_NAMES } from './EquipmentForgeSystem.js';
import equipmentData from '../data/equipment.json';

const freshSave = () => ({
  inventory: [], nextUid: 1, forgeLevels: {}, forgeStones: 100,
  gunResearch: { level: 0 }, equipped: {},
});
const rng01 = { next: () => 0 };

describe('EquipmentForgeSystem (v7.2 属性容器重构)', () => {
  it('generate creates equipment with slot/tier/quality and rolls by quality', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const white = s.generate({ slot: 'weapon', tier: 3, quality: 'white', rngLike: rng01 });
    expect(white.slot).toBe('weapon');
    expect(white.tier).toBe(3);
    expect(white.affixes.length).toBe(0); // 白 0 条
    const purple = s.generate({ slot: 'coat', tier: 1, quality: 'purple', rngLike: rng01 });
    expect(purple.affixes.length).toBe(2); // 紫 2 条
  });

  it('base attack = tier×10 + quality×5', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'weapon', tier: 3, quality: 'green', rngLike: rng01 });
    expect(s.getBaseAttack(a)).toBe(35); // 30 + 5
  });

  it('slot forge: level persists on slot (inherit across equipment swap)', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    expect(s.forgeSlot('weapon', 200).success).toBe(true);
    expect(s.getSlotLevel('weapon')).toBe(1);
    const newEquip = s.generate({ slot: 'weapon', tier: 1, quality: 'blue', rngLike: rng01 });
    expect(s.getSlotLevel('weapon')).toBe(1); // 换装备继承
    expect(newEquip.slot).toBe('weapon');
  });

  it('slot forge validates gold and max level', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    expect(s.forgeSlot('weapon', 0).reason).toBe('poor_gold');
    s.save.forgeLevels.weapon = 10;
    expect(s.forgeSlot('weapon', 99999).reason).toBe('maxed');
  });

  it('quality upgrade consumes stones, auto-fills new roll slots, caps at rainbow', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'coat', tier: 1, quality: 'white', rngLike: rng01 });
    expect(s.getUpgradeQualityCost(a.uid)).toBe(10);
    s.save.forgeStones = 5;
    expect(s.upgradeQuality(a.uid).reason).toBe('poor_stones');
    s.save.forgeStones = 1000;
    expect(s.upgradeQuality(a.uid).quality).toBe('green');
    expect(a.affixes.length).toBe(1); // 绿解锁 1 条
    // 逐档升到 rainbow（每档补 roll）
    s.save.forgeStones = 100000;
    while (s.upgradeQuality(a.uid).success) { /* 逐档升 */ }
    expect(a.quality).toBe('rainbow');
    expect(a.affixes.length).toBe(4); // 彩 4 条
  });

  it('reroll refreshes specific affix; locked affix skipped; costs stones', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'weapon', tier: 1, quality: 'blue', rngLike: rng01 });
    s.save.forgeStones = 100;
    const r = s.rerollSlot(a.uid, 0, rng01);
    expect(r.success).toBe(true);
    expect(s.save.forgeStones).toBe(80);
    a.affixes[0].locked = true;
    expect(s.rerollSlot(a.uid, 0, rng01).reason).toBe('locked');
  });

  it('scrap returns gold + stones by quality/tier', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const e = s.generate({ slot: 'coat', tier: 2, quality: 'blue', rngLike: rng01 });
    expect(s.getScrapValue(e.uid)).toBe(150 + 40);
    const r = s.scrap(e.uid);
    expect(r.stones).toBe(15); // blue = (2+1)×5
    expect(s.save.inventory.length).toBe(0);
  });

  it('combine: 3 same slot+quality → same slot one quality higher', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'weapon', tier: 1, quality: 'white', rngLike: rng01 });
    const b = s.generate({ slot: 'weapon', tier: 2, quality: 'white', rngLike: rng01 });
    const c = s.generate({ slot: 'weapon', tier: 3, quality: 'white', rngLike: rng01 });
    const r = s.combine([a.uid, b.uid, c.uid]);
    expect(r.success).toBe(true);
    expect(r.item.tier).toBe(3); // 保留最高品阶
    expect(r.item.quality).toBe('green'); // 升一档
    expect(s.save.inventory.length).toBe(1);
  });

  it('combine rejects equipped materials', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'weapon', tier: 1, quality: 'white', rngLike: rng01 });
    s.save.equipped.weapon = a.uid;
    s.setEquippedMap(s.save.equipped);
    const b = s.generate({ slot: 'weapon', tier: 1, quality: 'white', rngLike: rng01 });
    const c = s.generate({ slot: 'weapon', tier: 1, quality: 'white', rngLike: rng01 });
    expect(s.combine([a.uid, b.uid, c.uid]).reason).toBe('equipped');
  });

  it('equipped modifiers: base attack + affixes + quality skill bonus', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.generate({ slot: 'coat', tier: 2, quality: 'blue', rngLike: rng01 });
    // 手动设定词条验证
    a.affixes = [
      { poolId: 'atk', name: '攻击力', stat: 'damage', type: 'add', value: 10, pct: false, locked: false },
      { poolId: 'alldmg', name: '所有伤害', stat: 'damage', type: 'mul_pct', value: 8, pct: true, locked: false },
    ];
    s.save.forgeLevels.coat = 5;
    const mods = s.getEquippedModifiers({ coat: a.uid });
    // 基础攻击：tier2×10 + blue(idx2)×5 = 30
    const baseAtk = mods.find(m => m.stat === 'baseAttack');
    expect(baseAtk.value).toBe(30);
    // 品质技能加成
    const qBonus = mods.find(m => m.id.startsWith('quality_bonus_'));
    expect(qBonus.value).toBeCloseTo(0.06, 4);
    // 附加词条（两条都进管线；alldmg 是 pct 折算）
    const affixAtk = mods.find(m => m.id.startsWith('affix_') && m.type === 'add');
    expect(affixAtk.value).toBe(10);
    const affixPct = mods.find(m => m.id.startsWith('affix_') && m.type === 'mul_pct');
    expect(affixPct.value).toBeCloseTo(0.08, 4);
  });

  it('legacy named equipment migrates to affix container', () => {
    const legacy = {
      inventory: [{
        uid: 1, refId: 'item_rusty_sword', tier: 2, quality: 'white', forgeLv: 4,
      }],
      nextUid: 2, forgeLevels: {}, forgeStones: 0, gunResearch: { level: 0 },
    };
    const s = new EquipmentForgeSystem(equipmentData, legacy);
    const e = s.save.inventory[0];
    expect(e.slot).toBe('weapon');
    expect(e.refId).toBeUndefined();
    expect(e.affixes.length).toBeGreaterThan(0); // 旧 effects 转为 affixes
    expect(s.save.forgeLevels.weapon).toBe(4);   // 强化迁移到部位
  });

  it('gun research: independent multiplier', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    expect(s.getResearchMultiplier()).toBe(1);
    expect(s.upgradeResearch(5).reason).toBe('poor_notes');
    expect(s.upgradeResearch(10).level).toBe(1);
    expect(s.getResearchMultiplier()).toBeCloseTo(1.05, 5);
  });
});
