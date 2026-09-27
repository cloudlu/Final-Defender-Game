import mercData from '../data/mercenaries.json';

/**
 * MercenarySystem: 佣兵系统（原版对齐，替代宠物）。
 * - 获得：酒馆招募（钻石抽，碎片合成；重复=碎片）
 * - 被动加成：只要拥有（解锁）就永久加主角攻击力——不需要上阵（原版核心特性）
 * - 出战：2 个上阵位；伤害 = 主角攻击 × 继承比例（按品质） × 技能系数
 * - 佣兵不吃主角的宝石/技能强化等加成（原版特性：只继承面板攻击力）
 * 纯逻辑。
 */
export class MercenarySystem {
  constructor(configs = mercData.mercenaries, save = null, config = mercData) {
    this.configs = configs;
    this.config = config;
    this.save = save || { owned: {}, deployed: [null, null] };
    this.save.deployed = this.save.deployed || [null, null];
  }

  _cfg(id) {
    return this.configs.find(m => m.id === id) || null;
  }

  /** 主角面板攻击力（由 GameState 注入：枪械基础+全局强化等已结算值） */
  setPlayerAttack(atk) {
    this._playerAtk = atk;
  }

  // ===== 招募/碎片 =====

  /** 招募一次：随机佣兵；新=直接获得（Lv1），重复=+碎片 */
  recruit(rngLike) {
    const pool = this.configs;
    const picked = pool[Math.floor((rngLike?.next?.() ?? Math.random()) * pool.length)];
    return this.acquire(picked.id);
  }

  acquire(id) {
    const cfg = this._cfg(id);
    if (!cfg) return null;
    if (!this.save.owned[id]) {
      this.save.owned[id] = {
        quality: cfg.baseQuality,
        level: 1,
        shards: 0,
      };
      return { isNew: true, name: cfg.name };
    }
    this.save.owned[id].shards += this.config.recruit.shardsPerDup;
    return { isNew: false, shards: this.save.owned[id].shards, name: cfg.name };
  }

  /** 碎片合成（集齐 10 片可白嫖未拥有的佣兵） */
  compose(id) {
    if (this.save.owned[id]) return { success: false, reason: 'owned' };
    const need = this.config.recruit.shardsToCompose;
    // 碎片存在 shardBank（重复获得时即使未拥有也存进 bank）
    const bank = this.save.shardBank || (this.save.shardBank = {});
    if ((bank[id] || 0) < need) return { success: false, reason: 'poor_shards', need };
    bank[id] -= need;
    return { success: !!this.acquire(id) };
  }

  // ===== 品质/等级 =====

  /** 升品：契约碎片提品质（提高继承比例与攻击加成） */
  getUpgradeQualityCost(id) {
    const st = this.save.owned[id];
    if (!st) return null;
    const order = this.config.qualityOrder;
    const idx = order.indexOf(st.quality);
    if (idx < 0 || idx >= order.length - 1) return null;
    return (idx + 1) * 20; // 20/40/60...契约碎片
  }

  upgradeQuality(id) {
    const cost = this.getUpgradeQualityCost(id);
    if (!cost) return { success: false, reason: 'maxed' };
    const st = this.save.owned[id];
    if ((st.contractShards || 0) < cost) return { success: false, reason: 'poor', cost };
    st.contractShards -= cost;
    const order = this.config.qualityOrder;
    st.quality = order[order.indexOf(st.quality) + 1];
    return { success: true, quality: st.quality };
  }

  /** 升级费用：金币（阶梯式），等级不可重置 */
  getLevelUpCost(id) {
    const st = this.save.owned[id];
    if (!st) return null;
    if (st.level >= 100) return null;
    return 200 + st.level * 50;
  }

  levelUp(id, gold) {
    const cost = this.getLevelUpCost(id);
    if (!cost) return { success: false, reason: 'maxed' };
    if (gold < cost) return { success: false, reason: 'poor', cost };
    this.save.owned[id].level++;
    return { success: true, level: this.save.owned[id].level, cost };
  }

  // ===== 被动攻击加成（拥有即生效，无需上阵——原版核心） =====

  /** 所有已拥有佣兵的被动攻击力总和 */
  getTotalPassiveAttack() {
    let total = 0;
    for (const [id, st] of Object.entries(this.save.owned)) {
      const qAtk = this.config.atkBonusByQuality[st.quality] || 0;
      // 等级加成：按阶梯（30 级 90 / 50 级 200 / 100 级 650，线性插值简化）
      const lvAtk = Math.floor((st.level - 1) * 6.5);
      total += qAtk + lvAtk;
    }
    return total;
  }

  // ===== 上阵/出战 =====

  deploy(slot, id) {
    if (slot !== 0 && slot !== 1) return false;
    if (id !== null && !this.save.owned[id]) return false;
    // 不能重复上阵同一佣兵
    if (id && this.save.deployed.includes(id)) return false;
    this.save.deployed[slot] = id;
    return true;
  }

  getDeployed() {
    return this.save.deployed
      .filter(Boolean)
      .map(id => ({ id, cfg: this._cfg(id), state: this.save.owned[id] }));
  }

  /**
   * 出战佣兵的战斗参数（伤害按品质继承主角攻击）。
   * playerAttack: 主角已结算攻击力。
   * 佣兵不吃技能强化卡/装备加成——只吃继承的面板攻击（原版特性）。
   */
  getCombatStats(playerAttack) {
    return this.getDeployed().map(({ id, cfg, state }) => {
      const inherit = this.config.inheritRatio[state.quality] ?? 0.5;
      const damage = Math.round(playerAttack * inherit * cfg.skill.coef * 100) / 100;
      return {
        id, name: cfg.name, icon: cfg.icon,
        damage,
        interval: cfg.skill.interval,
        aoe: cfg.skill.aoe || 0,
        count: cfg.skill.count || 1,
        effect: cfg.skill.effect || null,
        skillName: cfg.skill.name,
      };
    });
  }
}
