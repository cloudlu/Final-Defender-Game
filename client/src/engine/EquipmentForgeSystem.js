const RARITY_REFUND = { white: 50, blue: 150, purple: 500, orange: 1500 };
const MAX_FORGE_LEVEL = 10;

/**
 * EquipmentForgeSystem: 装备培养（Meta 层）。
 * 仓库（inventory）持有装备实体（含独立强化等级）；
 * 强化 = 金币 + 同名 feed 件；分解 = 返还金币；属性经 Modifier 管线生效。
 * 纯逻辑。
 */
export class EquipmentForgeSystem {
  constructor(equipmentConfigs, save = null) {
    this.equipmentConfigs = equipmentConfigs;
    this.save = save || {
      inventory: [], // [{ uid, refId, forgeLv }]
      nextUid: 1,
    };
  }

  _baseConfig(refId) {
    return this.equipmentConfigs.find(e => e.id === refId) || null;
  }

  /** 加入仓库（新实体，forgeLv=0）。返回实体 */
  addEquipment(refId) {
    const base = this._baseConfig(refId);
    if (!base) return null;
    const entry = { uid: this.save.nextUid++, refId, forgeLv: 0 };
    this.save.inventory.push(entry);
    return entry;
  }

  /** 强化需求：金币 + 同名 feed 件数 */
  getForgeCost(uid) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return null;
    if (entry.forgeLv >= MAX_FORGE_LEVEL) return { maxed: true };
    const lv = entry.forgeLv;
    return {
      gold: Math.round(200 * Math.pow(1.3, lv)),
      feedCount: Math.ceil((lv + 1) / 2),
      feedRefId: entry.refId,
    };
  }

  /** 同名可作 feed 的件数（不含自身） */
  countFeedCopies(refId, excludeUid) {
    return this.save.inventory.filter(i => i.refId === refId && i.uid !== excludeUid).length;
  }

  /**
   * 强化。返回 { success, forgeLv } 或 { success: false, reason: 'missing|maxed|poor_gold|poor_feed' }
   * feed 被消耗（从仓库移除）。
   */
  forge(uid, gold) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return { success: false, reason: 'missing' };
    const cost = this.getForgeCost(uid);
    if (cost.maxed) return { success: false, reason: 'maxed' };
    if (gold < cost.gold) return { success: false, reason: 'poor_gold', cost };
    const feedAvail = this.countFeedCopies(entry.refId, uid);
    if (feedAvail < cost.feedCount) return { success: false, reason: 'poor_feed', cost };

    // 消耗 feed（移除同名件）
    let toRemove = cost.feedCount;
    this.save.inventory = this.save.inventory.filter(i => {
      if (toRemove > 0 && i.refId === entry.refId && i.uid !== uid) { toRemove--; return false; }
      return true;
    });
    entry.forgeLv++;
    return { success: true, forgeLv: entry.forgeLv, cost };
  }

  /** 分解返还金币 */
  getScrapValue(uid) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return 0;
    return Math.round((RARITY_REFUND[this._baseConfig(entry.refId)?.rarity] || 50) * (1 + entry.forgeLv * 0.5));
  }

  /** 未入库件的分解价（按稀有度基础价，forgeLv=0）——结算页"分解"用 */
  getScrapValueForNew(refId) {
    const base = this._baseConfig(refId);
    return RARITY_REFUND[base?.rarity] || 50;
  }

  scrap(uid) {
    const value = this.getScrapValue(uid);
    if (!this.save.inventory.some(i => i.uid === uid)) return 0;
    this.save.inventory = this.save.inventory.filter(i => i.uid !== uid);
    return value;
  }

  /**
   * 低阶合成高阶：3 件同 slot 同 rarity 装备 → 1 件高一档稀有度的随机装备（原版合成）。
   * 返回 { success, item } 或 { success: false, reason }
   */
  combine(uids) {
    if (!Array.isArray(uids) || uids.length !== 3) return { success: false, reason: 'need_three' };
    const entries = uids.map(uid => this.save.inventory.find(i => i.uid === uid));
    if (entries.some(e => !e)) return { success: false, reason: 'missing' };
    // 已穿戴的不能当材料
    const equippedUids = new Set(Object.values(this._equippedMap || {}));
    if (entries.some(e => equippedUids.has(e.uid))) return { success: false, reason: 'equipped' };
    const bases = entries.map(e => this._baseConfig(e.refId));
    const slot = bases[0].slot, rarity = bases[0].rarity;
    if (!bases.every(b => b.slot === slot && b.rarity === rarity)) {
      return { success: false, reason: 'mismatch' };
    }
    const ORDER = ['white', 'blue', 'purple', 'orange'];
    const idx = ORDER.indexOf(rarity);
    if (idx < 0 || idx >= ORDER.length - 1) return { success: false, reason: 'max_rarity' };
    const nextRarity = ORDER[idx + 1];
    // 消耗三件
    const uidSet = new Set(uids);
    this.save.inventory = this.save.inventory.filter(i => !uidSet.has(i.uid));
    // 随机出一件高一档
    const pool = this.equipmentConfigs.filter(e => e.slot === slot && e.rarity === nextRarity);
    const picked = pool[Math.floor(Math.random() * pool.length)] || this.equipmentConfigs[0];
    const entry = this.addEquipment(picked.id);
    return { success: true, item: entry, rarity: nextRarity };
  }

  /** 注入穿戴表（合成时排除已穿戴件） */
  setEquippedMap(map) {
    this._equippedMap = map || {};
  }

  /**
   * 全部"已装备槽位"实体的 modifiers（含强化加成）。
   * equippedMap: { slot: uid }，由外部穿戴逻辑提供。
   * 强化每级 = 基础 effects 数值 ×(1 + 0.1×forgeLv)。
   */
  getEquippedModifiers(equippedMap = {}) {
    const mods = [];
    for (const uid of Object.values(equippedMap)) {
      const entry = this.save.inventory.find(i => i.uid === uid);
      if (!entry) continue;
      const base = this._baseConfig(entry.refId);
      if (!base) continue;
      const scale = 1 + 0.1 * entry.forgeLv;
      for (const eff of base.effects) {
        mods.push({
          id: `forge_${entry.uid}_${eff.stat}`,
          source: 'equipment',
          stat: eff.stat,
          type: eff.type,
          value: Math.round(eff.value * scale * 10000) / 10000,
        });
      }
    }
    return mods;
  }
}
