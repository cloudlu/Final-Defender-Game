import gachaConfig from '../data/gachaPool.json';
import mercData from '../data/mercenaries.json';

const RARITY_ORDER = { white: 0, blue: 1, purple: 2, orange: 3 };

/**
 * GachaSystem: 概率抽取（Meta 层）。
 * 双货币池（金币/钻石）+ 稀有度权重 + 硬保底（pity）+ 重复转金币返还。
 * 抽卡结果：装备 → 仓库；佣兵 → 酒馆（重复=碎片）。
 */
export class GachaSystem {
  constructor(equipmentConfigs, save = null, config = gachaConfig, forgeSystem = null, mercenarySystem = null, gemSystem = null) {
    this.config = config;
    this.equipmentConfigs = equipmentConfigs;
    this.forgeSystem = forgeSystem;
    this.mercenarySystem = mercenarySystem;
    this.gemSystem = gemSystem;
    this.save = save || {
      ownedRefIds: [],
      pity: { gold: 0, diamond: 0 },
      totalPulls: 0,
    };
    // 存档缺省骨架（旧档无 pity/ownedRefIds 等字段时兜底）
    this.save.ownedRefIds = this.save.ownedRefIds || [];
    this.save.pity = this.save.pity || { gold: 0, diamond: 0 };
    this.save.totalPulls = this.save.totalPulls || 0;
  }

  getPool(poolId) {
    return this.config.pools[poolId] || null;
  }

  /** 概率公示：各稀有度占比（0-1） */
  getPublishedRates(poolId) {
    const w = this.getPool(poolId).weights;
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    const rates = {};
    for (const [rarity, weight] of Object.entries(w)) rates[rarity] = weight / total;
    return rates;
  }

  /** 单抽成本；count=10 时享 tenDiscount */
  getCost(poolId, count = 1) {
    const pool = this.getPool(poolId);
    const base = pool.cost * count;
    return count >= 10 ? Math.round(base * pool.tenDiscount) : base;
  }

  /**
   * 抽取。支付由调用方完成（这里只校验）。
   * @returns {{ results: Array<{item, isNew, refund}>, pityReset: boolean }} 或 null（余额不足）
   */
  pull(poolId, count, balances, rng) {
    const pool = this.getPool(poolId);
    if (!pool) return null;
    const cost = this.getCost(poolId, count);
    const balance = balances[pool.currency] || 0;
    if (balance < cost) return null;
    // 扣费（v8.27 修复：只校验不扣费=钻石抽卡白嫖；引擎侧一体完成，调用方无需重复实现）
    balances[pool.currency] = balance - cost;

    const results = [];
    let pity = this.save.pity[poolId] || 0;
    let pityTriggered = false;

    for (let i = 0; i < count; i++) {
      pity++;
      let rarity = this._rollRarity(pool.weights, rng);
      // 硬保底：第 threshold 抽未出 minRarity 以上 → 强制
      if (pity >= this.config.pity.threshold && RARITY_ORDER[rarity] < RARITY_ORDER[this.config.pity.minRarity]) {
        rarity = this.config.pity.minRarity;
        pityTriggered = true;
      }
      if (RARITY_ORDER[rarity] >= RARITY_ORDER[this.config.pity.minRarity]) pity = 0;

      const item = this._pickItemOfRarity(rarity, rng);
      // 30% 特殊掉落：佣兵 20% / 宝石 10%（稀有度映射保底品质；走 GemSystem 统一生成，
      // 尊重词条 minQuality 门槛——旧逻辑直捣全词条池会产生"至尊词条白品质 +0"废宝石）
      const specialRoll = rng.next();
      if (specialRoll < 0.1 && this.gemSystem) {
        const qMap = { white: 0, blue: 2, purple: 3, orange: 4 };
        const keepRng = { next: () => rng.next() };
        const gem = this.gemSystem.generate(keepRng, null, qMap[rarity] ?? 0);
        const affix = this.gemSystem.getAffix(gem.affixId);
        results.push({
          item: { id: `gem_${gem.uid}`, refId: gem.uid, rarity, gemUid: gem.uid, gemAffix: affix?.name || gem.affixId, gemQuality: gem.quality },
          isNew: true, refund: 0,
        });
        continue;
      } else if (specialRoll < 0.3 && this.mercenarySystem) {
        const mercPool = mercData.mercenaries;
        const mercCfg = mercPool[Math.floor(rng.next() * mercPool.length)]; // rng 契约只需 next()
        const acq = this.mercenarySystem.acquire(mercCfg.id);
        results.push({
          item: { id: `merc_${mercCfg.id}`, refId: mercCfg.id, rarity, mercId: mercCfg.id, mercIcon: mercCfg.icon, mercName: mercCfg.name },
          isNew: !!acq.isNew, refund: 0, mercShards: acq.isNew ? 0 : 2,
        });
        continue;
      }
      const isNew = !this.save.ownedRefIds.includes(item.refId);
      let refund = 0;
      if (isNew) {
        this.save.ownedRefIds.push(item.refId);
        // 新装备写入培养仓库（若接入）
        this.forgeSystem?.addEquipment(item.refId);
      } else {
        // 重复 → 金币返还
        refund = this.config.dupeRefund[rarity] || 50;
        balances.gold = (balances.gold || 0) + refund;
      }
      results.push({ item, isNew, refund });
    }

    this.save.pity[poolId] = pity;
    this.save.totalPulls += count;
    return { results, pityTriggered };
  }

  _rollRarity(weights, rng) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (const [rarity, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return rarity;
    }
    return 'white';
  }

  _pickItemOfRarity(rarity, rng) {
    const pool = this.config.items.filter(i => i.rarity === rarity);
    const total = pool.reduce((a, b) => a + b.weight, 0);
    let roll = rng.next() * total;
    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return pool[pool.length - 1];
  }

  /** refId → equipment.json 完整配置 */
  resolveEquipment(refId) {
    return this.equipmentConfigs.find(e => e.id === refId) || null;
  }
}
