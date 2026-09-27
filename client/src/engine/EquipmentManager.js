/**
 * EquipmentManager: handles equipment drops, inventory, and stat application.
 * Pure game logic - no Phaser dependency.
 */
export class EquipmentManager {
  constructor(equipmentData, baseDropChance = 0.08) {
    this.allItems = equipmentData;
    this.baseDropChance = baseDropChance;
    this.inventory = []; // equipped items: { item, slot }
    this.maxSlots = 3; // weapon, armor, accessory
  }

  /**
   * Roll ONCE per kill for an equipment drop.
   * Total drop chance is capped; the specific item is picked by weighted rarity.
   * @param {import('./SeededRNG.js').SeededRNG} rng
   * @param {number} luckBonus - extra drop chance (from skills)
   * @returns {object|null} dropped item or null
   */
  rollDrop(rng, luckBonus = 0) {
    if (this.allItems.length === 0) return null;
    const totalChance = Math.min(this.baseDropChance + luckBonus, 0.5);
    if (rng.next() >= totalChance) return null;
    // Weighted pick: rarer items are less likely (dropRate acts as weight)
    const totalWeight = this.allItems.reduce((sum, item) => sum + item.dropRate, 0);
    let roll = rng.next() * totalWeight;
    for (const item of this.allItems) {
      roll -= item.dropRate;
      if (roll <= 0) return { ...item };
    }
    return { ...this.allItems[this.allItems.length - 1] };
  }

  /**
   * Equip an item. Replaces existing item in same slot.
   * @param {object} item
   * @returns {{ equipped: boolean, replaced: object|null }}
   */
  equip(item) {
    const existingIdx = this.inventory.findIndex(i => i.item.slot === item.slot);
    let replaced = null;
    if (existingIdx >= 0) {
      replaced = this.inventory[existingIdx].item;
      this.inventory.splice(existingIdx, 1);
    }
    this.inventory.push({ item, slot: item.slot });
    return { equipped: true, replaced };
  }

  /**
   * Unequip an item by slot.
   * @param {string} slot
   * @returns {object|null} removed item
   */
  unequip(slot) {
    const idx = this.inventory.findIndex(i => i.slot === slot);
    if (idx >= 0) {
      const removed = this.inventory[idx].item;
      this.inventory.splice(idx, 1);
      return removed;
    }
    return null;
  }

  /**
   * Get all modifiers from equipped items.
   * @returns {Array} modifiers
   */
  getAllModifiers() {
    const mods = [];
    for (const { item } of this.inventory) {
      for (const effect of item.effects) {
        mods.push({
          id: `item_${item.id}_${effect.stat}`,
          source: 'equipment',
          stat: effect.stat,
          type: effect.type,
          value: effect.value,
        });
      }
    }
    return mods;
  }

  /** Get current inventory. */
  getInventory() {
    return this.inventory.map(i => ({ ...i }));
  }

  /** Check if a slot is occupied. */
  isSlotOccupied(slot) {
    return this.inventory.some(i => i.slot === slot);
  }
}
