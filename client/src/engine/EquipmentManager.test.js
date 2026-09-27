import { describe, it, expect, beforeEach } from 'vitest';
import { EquipmentManager } from './EquipmentManager.js';
import { SeededRNG } from './SeededRNG.js';

const testItems = [
  { id: 'item_sword', name: '剑', rarity: 'white', description: '伤害+5', slot: 'weapon', effects: [{ stat: 'damage', type: 'add', value: 5 }], dropRate: 0.5 },
  { id: 'item_shield', name: '盾', rarity: 'white', description: '射程+1', slot: 'armor', effects: [{ stat: 'range', 'type': 'add', 'value': 1 }], dropRate: 0.3 },
  { id: 'item_ring', name: '戒指', rarity: 'blue', description: '伤害+8%', slot: 'accessory', effects: [{ stat: 'damage', type: 'mul_pct', value: 0.08 }], dropRate: 0.2 },
];

describe('EquipmentManager', () => {
  let mgr, rng;
  beforeEach(() => {
    mgr = new EquipmentManager(testItems);
    rng = new SeededRNG(42);
  });

  it('rollDrop returns item based on drop rate', () => {
    let dropped = 0;
    for (let i = 0; i < 100; i++) {
      const item = mgr.rollDrop(new SeededRNG(i));
      if (item) dropped++;
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it('rollDrop total drop chance never exceeds 50% per kill', () => {
    const lucky = new EquipmentManager(testItems, 0.99); // extreme luck bonus
    let dropped = 0;
    for (let i = 0; i < 1000; i++) {
      if (lucky.rollDrop(new SeededRNG(i + 1000))) dropped++;
    }
    expect(dropped).toBeLessThan(600); // well under 100%, cap ≈ 50%
  });

  it('equip adds item to inventory', () => {
    const result = mgr.equip(testItems[0]);
    expect(result.equipped).toBe(true);
    expect(mgr.getInventory().length).toBe(1);
  });

  it('equip replaces item in same slot', () => {
    mgr.equip(testItems[0]);
    const result = mgr.equip({ ...testItems[0], id: 'item_sword2' });
    expect(result.replaced).not.toBeNull();
    expect(result.replaced.id).toBe('item_sword');
    expect(mgr.getInventory().length).toBe(1);
  });

  it('unequip removes item', () => {
    mgr.equip(testItems[0]);
    const removed = mgr.unequip('weapon');
    expect(removed).not.toBeNull();
    expect(mgr.getInventory().length).toBe(0);
  });

  it('getAllModifiers returns correct modifiers', () => {
    mgr.equip(testItems[0]);
    mgr.equip(testItems[2]);
    const mods = mgr.getAllModifiers();
    expect(mods.length).toBe(2);
    expect(mods[0].source).toBe('equipment');
    expect(mods[1].source).toBe('equipment');
  });

  it('isSlotOccupied returns correct state', () => {
    expect(mgr.isSlotOccupied('weapon')).toBe(false);
    mgr.equip(testItems[0]);
    expect(mgr.isSlotOccupied('weapon')).toBe(true);
  });
});
