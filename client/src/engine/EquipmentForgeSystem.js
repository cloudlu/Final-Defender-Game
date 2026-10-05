import gemData from '../data/gems.json';

/**
 * 装备词条池（v7.2 原版对齐：装备=部位×品阶×品质+随机词条容器，去具名化）。
 * 从宝石词条表派生 + 装备专属扩展（元素攻击/暴伤/秒杀类）。
 */
export const ROLL_POOL = [
  { id: 'atk', name: '攻击力', stat: 'baseAttack', type: 'add', base: 8, range: [4, 16], desc: '攻击力+{v}' },
  { id: 'crit', name: '暴击率', stat: 'critRate', type: 'add', base: 3, range: [1, 6], pct: true, desc: '暴击率+{v}%' },
  { id: 'critdmg', name: '暴击伤害', stat: 'critDamage', type: 'mul_pct', base: 10, range: [5, 20], pct: true, desc: '暴击伤害+{v}%' },
  { id: 'alldmg', name: '所有伤害', stat: 'damage', type: 'mul_pct', base: 5, range: [3, 10], pct: true, desc: '所有伤害+{v}%' },
  { id: 'gundmg', name: '枪械伤害', stat: 'gunDamage', type: 'special', base: 10, range: [5, 20], pct: true, desc: '枪械伤害+{v}%' },
  { id: 'fireatk', name: '火系攻击', stat: 'element_fire', type: 'special', base: 8, range: [4, 15], pct: true, desc: '火系伤害+{v}%' },
  { id: 'iceatk', name: '冰系攻击', stat: 'element_ice', type: 'special', base: 8, range: [4, 15], pct: true, desc: '冰系伤害+{v}%' },
  { id: 'elecatk', name: '电系攻击', stat: 'element_electric', type: 'special', base: 8, range: [4, 15], pct: true, desc: '电系伤害+{v}%' },
  { id: 'windatk', name: '风系攻击', stat: 'element_wind', type: 'special', base: 8, range: [4, 15], pct: true, desc: '风系伤害+{v}%' },
  { id: 'phyatk', name: '物理系攻击', stat: 'element_physical', type: 'special', base: 8, range: [4, 15], pct: true, desc: '物理系伤害+{v}%（装甲车/空投/无人机）' },
  { id: 'energyatk', name: '能量系攻击', stat: 'element_energy', type: 'special', base: 8, range: [4, 15], pct: true, desc: '能量系伤害+{v}%' },
  { id: 'wallhp', name: '防线血量', stat: 'wallHp', type: 'add', base: 300, range: [150, 600], desc: '城墙血量+{v}' },
  { id: 'debuffdmg', name: '对负面怪物伤害', stat: 'debuffTargetDamage', type: 'special', base: 15, range: [8, 25], pct: true, desc: '对负面状态怪物伤害+{v}%' },
  { id: 'highhpdmg', name: '对高血怪物伤害', stat: 'highHpTargetDamage', type: 'special', base: 25, range: [12, 40], pct: true, desc: '对高血量怪物伤害+{v}%' },
];

/** 品质 7 档（可升品）：品质提供技能伤害加成 */
export const QUALITY_ORDER = ['white', 'green', 'blue', 'purple', 'orange', 'red', 'rainbow'];
export const QUALITY_NAMES = { white: '白', green: '绿', blue: '蓝', purple: '紫', orange: '橙', red: '红', rainbow: '彩' };
export const QUALITY_SKILL_BONUS = { white: 0, green: 0.03, blue: 0.06, purple: 0.09, orange: 0.12, red: 0.15, rainbow: 0.18 };
/** 旧 4 档存档映射 */
const LEGACY_MAP = { white: 'white', blue: 'blue', purple: 'purple', orange: 'orange' };

const SLOTS = ['weapon', 'helmet', 'coat', 'bracers', 'pants', 'shoes'];
const MAX_FORGE_LEVEL = 10;
/** 品质 → 附加属性条数上限（原版：品质越高条数越多） */
const ROLL_SLOTS = { white: 0, green: 1, blue: 1, purple: 2, orange: 2, red: 3, rainbow: 4 };
/** 旧具名装备分解折算金币 */
const RARITY_REFUND = { white: 50, green: 100, blue: 150, purple: 500, orange: 1500 };

export class EquipmentForgeSystem {
  constructor(equipmentConfigs = [], save = null) {
    this.equipmentConfigs = equipmentConfigs; // 兼容旧签名保留（不再消费具名表）
    this.save = save || {
      inventory: [],   // [{ uid, slot, tier, quality, affixes: [{poolId,name,stat,type,value,pct,locked}] }]
      nextUid: 1,
      forgeLevels: {}, // { slot: lv } 部位强化（替换继承）
      forgeStones: 0,
      gunResearch: { level: 0 },
    };
    this.save.forgeLevels = this.save.forgeLevels || {};
    this.save.forgeStones = this.save.forgeStones || 0;
    this.save.gunNotes = this.save.gunNotes || 0; // 枪械图纸（研发消耗）
    this.save.gunResearch = this.save.gunResearch || { level: 0 };
    this.save.equipped = this.save.equipped || {};
    this._migrateLegacy();
  }

  _migrateLegacy() {
    // 词条中文名映射（修复 v7.2 前已固化的英文 name 存档）
    const STAT_CN = { damage: '伤害', attackSpeed: '攻速', critRate: '暴击率', critDamage: '暴击伤害', goldBonus: '金币', range: '射程', wallHp: '防线血量', baseAttack: '攻击力' };
    for (const entry of this.save.inventory) {
      // 兜底：已迁移容器若 name 仍是英文 stat → 转中文
      for (const a of entry.affixes || []) {
        if (a.name && Object.values(STAT_CN).includes(a.name)) continue; // 已是中文
        a.name = STAT_CN[a.stat] || STAT_CN[a.poolId] || a.name;
      }
      // v8.12 数据归一：v7.2 前旧小数制 pct 词条（|value|<1 的 mul_pct，如 0.25=-25% 攻速）
      // ×100 转百分比整数制并取整——杜绝显示端 14.399999999999999 尾数
      for (const a of entry.affixes || []) {
        if (a.pct && Math.abs(a.value) < 1) {
          a.value = Math.round(a.value * 100);
        }
        // 任何带尾数的 pct 值统一 2 位取整（洗练/补 roll 遗留）
        if (a.pct) a.value = Math.round(a.value * 100) / 100;
      }
      // 旧具名件（有 refId）→ 转属性容器
      if (entry.refId) {
        const base = this.equipmentConfigs.find(e => e.id === entry.refId);
        entry.slot = base?.slot || entry.slot || 'weapon';
        const STAT_CN = { damage: '伤害', attackSpeed: '攻速', critRate: '暴击率', critDamage: '暴击伤害', goldBonus: '金币', range: '射程', wallHp: '防线血量' };
        entry.affixes = (base?.effects || []).map(eff => ({
          poolId: eff.stat,
          name: STAT_CN[eff.stat] || eff.stat, // 迁移时转中文名
          stat: eff.stat, type: eff.type,
          // mul_pct 存百分比整数（显示/洗练统一），add 存原值
          value: eff.type === 'mul_pct' ? Math.round(eff.value * 100) : eff.value,
          pct: eff.type === 'mul_pct', locked: false,
        }));
        delete entry.refId;
      }
      if (entry.forgeLv !== undefined) {
        const slotLvKey = entry.slot || 'weapon';
        this.save.forgeLevels[slotLvKey] = Math.max(this.save.forgeLevels[slotLvKey] || 0, entry.forgeLv);
        delete entry.forgeLv;
      }
      if (entry.quality && entry.quality in LEGACY_MAP && !QUALITY_ORDER.includes(entry.quality)) {
        entry.quality = LEGACY_MAP[entry.quality];
      }
      if (!entry.quality) entry.quality = 'white';
      if (entry.tier === undefined) entry.tier = 1;
      entry.affixes = entry.affixes || [];
    }
  }

  getSlotLevel(slot) {
    return this.save.forgeLevels[slot] || 0;
  }

  getRollSlots(quality) {
    return ROLL_SLOTS[quality] ?? 0;
  }

  /** 基础攻击力（原版"底盘"）：品阶×10 + 品质×5 */
  getBaseAttack(entry) {
    return (entry.tier || 1) * 10 + QUALITY_ORDER.indexOf(entry.quality) * 5;
  }

  /**
   * 生成装备（原版式属性容器）：部位+品阶+品质+roll 附加属性。
   * 掉落/合成/抽卡共用此入口。
   */
  generate({ slot, tier = 1, quality = 'white', rngLike = null }) {
    const uid = `e${this.save.nextUid++}`;
    const entry = { uid, slot, tier, quality, affixes: [] };
    const maxSlots = this.getRollSlots(quality);
    const rand = () => (rngLike?.next?.() ?? Math.random());
    for (let i = 0; i < maxSlots; i++) {
      const pick = ROLL_POOL[Math.floor(rand() * ROLL_POOL.length)];
      const [lo, hi] = pick.range;
      const bias = quality === 'white' ? 0 : QUALITY_ORDER.indexOf(quality) / (QUALITY_ORDER.length - 1);
      const value = Math.round((lo + (hi - lo) * (0.4 * rand() + 0.6 * bias)) * 100) / 100;
      entry.affixes.push({ poolId: pick.id, name: pick.name, stat: pick.stat, type: pick.type, value, pct: !!pick.pct, locked: false });
    }
    this.save.inventory.push(entry);
    return entry;
  }

  /** 兼容旧调用：按 refId 入仓 → 转为生成（slot 从旧表查） */
  addEquipment(refId, tier = 1) {
    const base = this.equipmentConfigs.find(e => e.id === refId);
    return this.generate({ slot: base?.slot || 'weapon', tier, quality: 'white' });
  }

  /** 装备显示名：品质+部位（原版无具名） */
  displayName(entry) {
    return `${QUALITY_NAMES[entry.quality] || '?'}·${{ weapon: '武器', helmet: '头盔', coat: '衣服', bracers: '护臂', pants: '腰饰', shoes: '鞋子' }[entry.slot] || entry.slot}`;
  }

  /** 词条摘要（UI 用） */
  affixSummary(entry) {
    return (entry.affixes || []).map(a => `${a.name}+${a.pct ? a.value + '%' : a.value}`).join(' ');
  }

  // ===== 部位强化（B3 继承，不变） =====

  getForgeCost(slot) {
    const lv = this.getSlotLevel(slot);
    if (lv >= MAX_FORGE_LEVEL) return { maxed: true };
    return { gold: Math.round(200 * Math.pow(1.3, lv)), slot };
  }

  /** 部位强化：金币（feed 机制随具名表退役，纯金币） */
  forgeSlot(slot, gold) {
    const cost = this.getForgeCost(slot);
    if (cost.maxed) return { success: false, reason: 'maxed' };
    if (gold < cost.gold) return { success: false, reason: 'poor_gold', cost };
    this.save.forgeLevels[slot] = this.getSlotLevel(slot) + 1;
    return { success: true, level: this.save.forgeLevels[slot], cost };
  }

  // ===== 升品（锻造石）+ 自动补 roll =====

  getUpgradeQualityCost(uid) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return null;
    const idx = QUALITY_ORDER.indexOf(entry.quality);
    if (idx < 0 || idx >= QUALITY_ORDER.length - 1) return null;
    return (idx + 1) * 10;
  }

  upgradeQuality(uid) {
    const cost = this.getUpgradeQualityCost(uid);
    if (!cost) return { success: false, reason: 'maxed' };
    if ((this.save.forgeStones || 0) < cost) return { success: false, reason: 'poor_stones', cost };
    const entry = this.save.inventory.find(i => i.uid === uid);
    const prevSlots = this.getRollSlots(entry.quality);
    entry.quality = QUALITY_ORDER[QUALITY_ORDER.indexOf(entry.quality) + 1];
    this.save.forgeStones -= cost;
    // 升品补 roll 新解锁条
    const maxSlots = this.getRollSlots(entry.quality);
    const rand = () => Math.random();
    while ((entry.affixes || []).length < maxSlots) {
      const pick = ROLL_POOL[Math.floor(rand() * ROLL_POOL.length)];
      const [lo, hi] = pick.range;
      const bias = QUALITY_ORDER.indexOf(entry.quality) / (QUALITY_ORDER.length - 1);
      const value = Math.round((lo + (hi - lo) * (0.4 * rand() + 0.6 * bias)) * 100) / 100;
      entry.affixes.push({ poolId: pick.id, name: pick.name, stat: pick.stat, type: pick.type, value, pct: !!pick.pct, locked: false });
    }
    return { success: true, quality: entry.quality, newRolls: maxSlots - prevSlots };
  }

  // ===== 洗练（单条刷新，锁定条跳过）=====

  static REROLL_COST = 20;

  rerollSlot(uid, affixIdx, rngLike) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry || !entry.affixes?.[affixIdx]) return { success: false, reason: 'no_roll' };
    const cost = EquipmentForgeSystem.REROLL_COST;
    if ((this.save.forgeStones || 0) < cost) return { success: false, reason: 'poor_stones' };
    const affix = entry.affixes[affixIdx];
    if (affix.locked) return { success: false, reason: 'locked' };
    this.save.forgeStones -= cost;
    const pool = ROLL_POOL.find(pl => pl.id === affix.poolId) || ROLL_POOL[0];
    const [lo, hi] = pool.range;
    const qualityIdx = QUALITY_ORDER.indexOf(entry.quality);
    const bias = qualityIdx / (QUALITY_ORDER.length - 1);
    const rand = () => (rngLike?.next?.() ?? Math.random());
    affix.value = Math.round((lo + (hi - lo) * (0.4 * rand() + 0.6 * bias)) * 100) / 100;
    return { success: true, affix };
  }

  /** 锁定/解锁词条（洗练保护） */
  toggleLock(uid, affixIdx) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    const affix = entry?.affixes?.[affixIdx];
    if (!affix) return false;
    affix.locked = !affix.locked;
    return true;
  }

  // ===== 合成：3 同部位同品质 → 同部位高两档品质（词条全重新 roll）=====

  combine(uids) {
    if (!Array.isArray(uids) || uids.length !== 3) return { success: false, reason: 'need_three' };
    const entries = uids.map(uid => this.save.inventory.find(i => i.uid === uid));
    if (entries.some(e => !e)) return { success: false, reason: 'missing' };
    const equippedUids = new Set(Object.values(this.save.equipped || {}));
    if (entries.some(e => equippedUids.has(e.uid))) return { success: false, reason: 'equipped' };
    const slot = entries[0].slot;
    if (!entries.every(e => e.slot === slot)) return { success: false, reason: 'mismatch' };
    const qIdxs = entries.map(e => QUALITY_ORDER.indexOf(e.quality));
    const maxTier = Math.max(...entries.map(e => e.tier || 1));
    const outQ = Math.min(QUALITY_ORDER.length - 1, Math.max(...qIdxs) + 1); // 升一档
    if (Math.max(...qIdxs) >= QUALITY_ORDER.length - 1) return { success: false, reason: 'max_quality' };

    const uidSet = new Set(uids);
    this.save.inventory = this.save.inventory.filter(i => !uidSet.has(i.uid));
    const entry = this.generate({ slot, tier: maxTier, quality: QUALITY_ORDER[outQ] });
    return { success: true, item: entry, rarity: entry.quality };
  }

  // ===== 分解：金币 + 锻造石 =====

  getScrapValue(uid) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return 0;
    const qIdx = QUALITY_ORDER.indexOf(entry.quality);
    return (RARITY_REFUND[entry.quality] || 50) + (entry.tier || 1) * 20;
  }

  getScrapStones(uid) {
    const entry = this.save.inventory.find(i => i.uid === uid);
    if (!entry) return 0;
    return (QUALITY_ORDER.indexOf(entry.quality) + 1) * 5;
  }

  scrap(uid) {
    if (!this.save.inventory.some(i => i.uid === uid)) return { gold: 0, stones: 0 };
    const gold = this.getScrapValue(uid);
    const stones = this.getScrapStones(uid);
    this.save.inventory = this.save.inventory.filter(i => i.uid !== uid);
    return { gold, stones };
  }

  /** 兼容：未入库件分解价 */
  getScrapValueForNew(qualityOrRefId) {
    return RARITY_REFUND[qualityOrRefId] || 50;
  }

  // ===== 战斗 modifiers：基础攻击 + 部位强化 + 品质技能加成 + 附加词条 =====

  getEquippedModifiers(equippedMap = {}) {
    const mods = [];
    for (const [slot, uid] of Object.entries(equippedMap)) {
      const entry = this.save.inventory.find(i => i.uid === uid);
      if (!entry) continue;
      // 基础攻击力（底盘）
      mods.push({
        id: `baseatk_${entry.uid}`,
        source: 'equipment',
        stat: 'baseAttack',
        type: 'add',
        value: this.getBaseAttack(entry),
      });
      // 附加词条（非特殊类进管线）
      for (const a of entry.affixes || []) {
        if (['gunDamage', 'instantKill', 'teleport'].includes(a.stat)) continue; // 特殊词条由 specials 消费
        mods.push({
          id: `affix_${entry.uid}_${a.poolId}`,
          source: 'equipment',
          stat: a.stat,
          type: a.type,
          value: a.pct ? a.value / 100 : a.value,
        });
      }
      // 品质技能伤害加成
      const skillBonus = QUALITY_SKILL_BONUS[entry.quality] || 0;
      if (skillBonus > 0) {
        mods.push({ id: `quality_bonus_${entry.uid}`, source: 'quality', stat: 'damage', type: 'mul_pct', value: skillBonus });
      }
    }
    return mods;
  }

  /** 特殊词条集合（GameState 消费：秒杀/传送/枪械/各系） */
  getSpecials(equippedMap = {}) {
    const specials = { instantKill: 0, teleport: 0, gunDamage: 0 };
    for (const uid of Object.values(equippedMap)) {
      const entry = this.save.inventory.find(i => i.uid === uid);
      for (const a of entry?.affixes || []) {
        if (a.stat === 'instantKill') specials.instantKill = Math.max(specials.instantKill, a.value);
        if (a.stat === 'teleport') specials.teleport = Math.max(specials.teleport, a.value);
        if (a.stat === 'gunDamage') specials.gunDamage += a.value;
      }
    }
    return specials;
  }

  setEquippedMap(map) {
    this._equippedMap = map || {};
  }

  // ===== 枪械研发（不变）=====

  getResearchCost() {
    const lv = this.save.gunResearch?.level || 0;
    return 10 + lv * 5;
  }

  upgradeResearch(notes) {
    if (!this.save.gunResearch) this.save.gunResearch = { level: 0 };
    const cost = this.getResearchCost();
    if ((notes || 0) < cost) return { success: false, reason: 'poor_notes', cost };
    this.save.gunResearch.level++;
    return { success: true, level: this.save.gunResearch.level, cost };
  }

  getResearchMultiplier() {
    const lv = this.save.gunResearch?.level || 0;
    return 1 + lv * 0.05;
  }
}
