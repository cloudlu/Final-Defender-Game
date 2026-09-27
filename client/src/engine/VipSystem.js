/**
 * VipSystem: VIP 等级与特权（Meta 层）。
 * vipExp 1:1 对应累计充值（×100 语义，与服务端 VIP_LEVELS 一致）。
 * 特权（当前）：金币加成 goldBonus → Modifier 管线（source: vip，受封顶 §13.4）。
 * 纯逻辑；等级信息由服务端 /api/recharge/vip/info 提供，客户端缓存。
 */
export const VIP_LEVELS = [
  { level: 0, requiredExp: 0, goldBonus: 0 },
  { level: 1, requiredExp: 600, goldBonus: 0.1 },
  { level: 2, requiredExp: 3000, goldBonus: 0.2 },
  { level: 3, requiredExp: 9800, goldBonus: 0.3 },
  { level: 4, requiredExp: 19800, goldBonus: 0.4 },
  { level: 5, requiredExp: 32800, goldBonus: 0.5 },
  { level: 6, requiredExp: 64800, goldBonus: 0.6 },
];

export class VipSystem {
  constructor(cachedInfo = null) {
    // { vipLevel, vipExp, goldBonus } — 来自服务端；无网/未充值时为 0 级
    this.info = cachedInfo || { vipLevel: 0, vipExp: 0, goldBonus: 0 };
  }

  setInfo(info) {
    if (info && typeof info.vipLevel === 'number') this.info = info;
  }

  get level() { return this.info.vipLevel || 0; }
  get goldBonus() { return this.info.goldBonus || 0; }

  /** 距下一级还需多少 vipExp；满级返回 null */
  get nextLevelExp() {
    const next = VIP_LEVELS.find(l => l.level === this.level + 1);
    return next ? next.requiredExp : null;
  }

  /** 管线 modifiers */
  getAllModifiers() {
    if (this.goldBonus <= 0) return [];
    return [{
      id: 'vip_gold_bonus',
      source: 'vip',
      stat: 'goldBonus',
      type: 'mul_pct',
      value: this.goldBonus,
    }];
  }
}
