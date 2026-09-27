import { describe, it, expect } from 'vitest';
import { EquipmentForgeSystem } from './EquipmentForgeSystem.js';
import equipmentData from '../data/equipment.json';

const freshSave = () => ({ inventory: [], nextUid: 1 });

describe('EquipmentForgeSystem', () => {
  it('addEquipment creates inventory entries with incremental uid', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.addEquipment('item_rusty_sword');
    const b = s.addEquipment('item_rusty_sword');
    expect(a.uid).toBe(1);
    expect(b.uid).toBe(2);
    expect(a.forgeLv).toBe(0);
  });

  it('forge cost scales exponentially and feed requirement grows', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const e = s.addEquipment('item_rusty_sword');
    expect(s.getForgeCost(e.uid)).toEqual({ gold: 200, feedCount: 1, feedRefId: 'item_rusty_sword' });
    e.forgeLv = 5;
    expect(s.getForgeCost(e.uid).gold).toBe(Math.round(200 * Math.pow(1.3, 5)));
    expect(s.getForgeCost(e.uid).feedCount).toBe(3);
  });

  it('forge requires feed copies of the same item', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const main = s.addEquipment('item_rusty_sword');
    // 无 feed → 失败
    expect(s.forge(main.uid, 99999).reason).toBe('poor_feed');
    // 加 1 件同名 feed → 成功且 feed 被消耗
    s.addEquipment('item_rusty_sword');
    const r = s.forge(main.uid, 99999);
    expect(r.success).toBe(true);
    expect(main.forgeLv).toBe(1);
    expect(s.save.inventory.length).toBe(1);
  });

  it('forge validates gold and max level', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const main = s.addEquipment('item_rusty_sword');
    s.addEquipment('item_rusty_sword');
    expect(s.forge(main.uid, 100).reason).toBe('poor_gold');
    main.forgeLv = 10;
    expect(s.forge(main.uid, 99999).reason).toBe('maxed');
  });

  it('scrap returns refund scaled by forge level', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const e = s.addEquipment('item_flame_blade'); // blue → 150
    expect(s.getScrapValue(e.uid)).toBe(150);
    e.forgeLv = 4;
    expect(s.getScrapValue(e.uid)).toBe(Math.round(150 * (1 + 2)));
    const gold = s.scrap(e.uid);
    expect(gold).toBe(450);
    expect(s.save.inventory.length).toBe(0);
  });

  it('equipped modifiers scale with forge level via pipeline format', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const e = s.addEquipment('item_power_ring'); // damage mul_pct 0.08
    e.forgeLv = 5; // ×1.5
    const mods = s.getEquippedModifiers({ accessory: e.uid });
    expect(mods.length).toBe(1);
    expect(mods[0].source).toBe('equipment');
    expect(mods[0].value).toBeCloseTo(0.12, 5);
  });

  it('combine: 3 same-slot same-rarity items → 1 item of next rarity', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    // 3 件白色武器
    const a = s.addEquipment('item_rusty_sword');
    const b = s.addEquipment('item_rusty_sword');
    const c = s.addEquipment('item_rusty_sword');
    const before = s.save.inventory.length;
    const r = s.combine([a.uid, b.uid, c.uid]);
    expect(r.success).toBe(true);
    expect(r.rarity).toBe('blue');
    expect(s.save.inventory.length).toBe(before - 2); // -3 +1
    const newEntry = s.save.inventory.find(i => i.uid === r.item.uid);
    expect(s._baseConfig(newEntry.refId).rarity).toBe('blue');
  });

  it('combine rejects mismatched slot/rarity and equipped items', () => {
    const s = new EquipmentForgeSystem(equipmentData, freshSave());
    const a = s.addEquipment('item_rusty_sword'); // weapon white
    const b = s.addEquipment('item_iron_shield'); // armor white
    const c = s.addEquipment('item_power_ring');  // accessory white
    expect(s.combine([a.uid, b.uid, c.uid]).reason).toBe('mismatch');
    // 已穿戴拒绝
    const d = s.addEquipment('item_rusty_sword');
    const e = s.addEquipment('item_rusty_sword');
    s.setEquippedMap({ weapon: d.uid });
    expect(s.combine([d.uid, e.uid, a.uid]).reason).toBe('equipped');
  });
});
