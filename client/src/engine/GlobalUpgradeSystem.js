/**
 * GlobalUpgradeSystem: 局外金币强化（Meta 层）。
 * 金币带出关卡 → 升级全局属性 → 下局永久生效。
 * 纯逻辑无 Phaser 依赖。升级成本 cost(lv) = round(baseCost × costScale^(lv-1))。
 */
export class GlobalUpgradeSystem {
  constructor(configs, save = null) {
    this.configs = configs; // [{ id, name, icon, stat, type, perLevel, maxLevel, baseCost, costScale, description }]
    // save: { levels: { [upgradeId]: level } }
    this.save = save || { levels: {} };
  }

  getLevel(id) {
    return this.save.levels[id] || 0;
  }

  /** 下一级成本；已满级返回 null */
  getNextCost(id) {
    const cfg = this.configs.find(c => c.id === id);
    if (!cfg) return null;
    const lv = this.getLevel(id);
    if (lv >= cfg.maxLevel) return null;
    return Math.round(cfg.baseCost * Math.pow(cfg.costScale, lv));
  }

  /**
   * 尝试升级。gold 为当前余额（数值）；成功时调用方需自行扣减余额。
   * 返回 { success, level, cost } 或 { success: false, reason }
   */
  upgrade(id, gold) {
    const cfg = this.configs.find(c => c.id === id);
    if (!cfg) return { success: false, reason: 'unknown' };
    const lv = this.getLevel(id);
    if (lv >= cfg.maxLevel) return { success: false, reason: 'maxed' };
    const cost = this.getNextCost(id);
    if (gold < cost) return { success: false, reason: 'poor', cost };
    this.save.levels[id] = lv + 1;
    return { success: true, level: lv + 1, cost };
  }

  /** 便捷方法：校验+扣款一步完成（余额存于 balances.gold，扣减后由调用方持久化） */
  upgradeAndPay(id, balances) {
    const r = this.upgrade(id, balances.gold || 0);
    if (r.success) balances.gold -= r.cost;
    return r;
  }

  /**
   * 全部强化产出的 modifiers（source: 'global'），进 Modifier 管线。
   * wallHp/xpBonus 是特殊 stat（不进战斗管线，由 GameState 单独消费）。
   */
  getAllModifiers() {
    const mods = [];
    for (const cfg of this.configs) {
      const lv = this.getLevel(cfg.id);
      if (lv <= 0) continue;
      if (cfg.stat === 'wallHp') continue; // 非管线 stat
      mods.push({
        id: `global_${cfg.id}`,
        source: 'global',
        stat: cfg.stat,
        type: cfg.type,
        value: cfg.perLevel * lv,
      });
    }
    return mods;
  }

  /** 墙血加成（add 类型，直接加到 wallHpMax） */
  getWallHpBonus() {
    const cfg = this.configs.find(c => c.stat === 'wallHp');
    if (!cfg) return 0;
    return cfg.perLevel * this.getLevel(cfg.id);
  }

  /** 经验加成倍率（1 + bonus） */
  getXpMultiplier() {
    const cfg = this.configs.find(c => c.stat === 'xpBonus');
    if (!cfg) return 1;
    return 1 + cfg.perLevel * this.getLevel(cfg.id);
  }

  /** 金币加成倍率由 getAllModifiers 的 goldBonus stat 走管线 */
}
