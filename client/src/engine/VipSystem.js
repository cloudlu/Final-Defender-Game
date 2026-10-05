/**
 * VipSystem: VIP 等级与特权（Meta 层，v7.10 原版对齐）。
 * - 累充门槛：6/30/60/120/200/300/600/1200/2000/4000/6000/12000/20000/28000/40000 元（共 15 档）
 * - 原版 VIP 是**功能性特权**（次数/栏位/扫荡/佣兵加速），不给数值加成——数值膨胀靠宝石/装备
 * - VIP12 开放「尊爵特权」
 * 纯逻辑；等级信息由服务端 /api/recharge/vip/info 提供，客户端缓存。
 */
export const VIP_LEVELS = [
  { level: 0, requiredYuan: 0, perks: [] },
  { level: 1, requiredYuan: 6, perks: ['fastBattle+1'] },
  { level: 2, requiredYuan: 30, perks: ['fastBattle+1', 'bossChallengeBuy'] },
  { level: 3, requiredYuan: 60, perks: ['goldBuyPlus'] },
  { level: 4, requiredYuan: 120, perks: ['goldBuyPlus', 'premiumShop'] },
  { level: 5, requiredYuan: 200, perks: ['mercSpeedUp'] },
  { level: 6, requiredYuan: 300, perks: ['mercSpeedUp', 'bossChest'] },
  { level: 7, requiredYuan: 600, perks: ['sweepUnlock'] },
  { level: 8, requiredYuan: 1200, perks: ['sweepUnlock', 'fastBattlePlus'] },
  { level: 9, requiredYuan: 2000, perks: [] },
  { level: 10, requiredYuan: 4000, perks: [] },
  { level: 11, requiredYuan: 6000, perks: [] },
  { level: 12, requiredYuan: 12000, perks: ['premiumPass'] }, // 尊爵特权
  { level: 13, requiredYuan: 20000, perks: [] },
  { level: 14, requiredYuan: 28000, perks: [] },
  { level: 15, requiredYuan: 40000, perks: [] },
];

/** 特权中文名（UI 显示） */
export const PERK_NAMES = {
  'fastBattle+1': '快速战斗次数+1',
  fastBattlePlus: '快速战斗次数大幅增加',
  bossChallengeBuy: '购买 BOSS 挑战次数',
  goldBuyPlus: '购买金币次数增加',
  premiumShop: '高级商品栏位解锁',
  mercSpeedUp: '佣兵培养加速',
  bossChest: '击败 BOSS 额外发现宝箱',
  sweepUnlock: '扫荡功能解锁',
  premiumPass: '尊爵特权',
};

export class VipSystem {
  constructor(cachedInfo = null) {
    // { vipLevel, vipExp } — vipExp = 累计充值元；无网/未充值时为 0 级
    this.info = cachedInfo || { vipLevel: 0, vipExp: 0 };
  }

  setInfo(info) {
    if (info && typeof info.vipLevel === 'number') this.info = info;
  }

  get level() { return this.info.vipLevel || 0; }

  /** 当前等级的特权列表 */
  get perks() {
    const lv = VIP_LEVELS.find(l => l.level === this.level);
    return lv?.perks || [];
  }

  /** 距下一级还需多少元；满级返回 null */
  get nextLevelYuan() {
    const next = VIP_LEVELS.find(l => l.level === this.level + 1);
    return next ? next.requiredYuan : null;
  }

  /** 特权中文名列表（UI） */
  getPerkNames() {
    return this.perks.map(p => PERK_NAMES[p] || p);
  }
}
