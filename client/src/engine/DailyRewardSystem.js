/**
 * DailyRewardSystem: 每日签到（Meta 层）。
 * 7 日循环奖励表（balance.json dailyRewards.cycle 驱动）；
 * 按本地自然日领取，每天 1 次；超 streakBreakHours 断签重置 Day1。
 * 纯逻辑。日期由注入的 nowFn 提供（可测）。
 */
export class DailyRewardSystem {
  constructor(balanceConfig, save = null, nowFn = () => new Date()) {
    this.cycle = balanceConfig?.dailyRewards?.cycle || [
      { day: 1, type: 'gold', amount: 500 },
      { day: 2, type: 'diamond', amount: 50 },
      { day: 3, type: 'gold', amount: 1500 },
      { day: 4, type: 'diamond', amount: 100 },
      { day: 5, type: 'gold', amount: 5000 },
      { day: 6, type: 'diamond', amount: 200 },
      { day: 7, type: 'diamond', amount: 300 },
    ];
    this.breakHours = balanceConfig?.dailyRewards?.streakBreakHours ?? 48;
    this.save = save || { lastClaimDate: null, streakDay: 0 };
    this._nowFn = nowFn;
  }

  _todayStr(now) {
    const d = now || this._nowFn();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  _hoursSince(dateStr, now) {
    if (!dateStr) return Infinity;
    const prev = new Date(`${dateStr}T00:00:00`);
    return (now.getTime() - prev.getTime()) / 3600000;
  }

  /** 今天是否可领 */
  canClaim() {
    const now = this._nowFn();
    return this.save.lastClaimDate !== this._todayStr(now);
  }

  /** 下一签是第几天（1-7） */
  nextDay() {
    const now = this._nowFn();
    if (!this.save.lastClaimDate) return 1;
    const broken = this._hoursSince(this.save.lastClaimDate, now) >= this.breakHours;
    if (broken) return 1;
    const prev = this.save.streakDay || 0;
    return this.canClaim() ? (prev % this.cycle.length) + 1 : prev || 1;
  }

  /** 当前奖励表（含已领标记） */
  getCalendar() {
    const nextDay = this.nextDay();
    const canClaim = this.canClaim();
    return this.cycle.map(entry => ({
      ...entry,
      claimed: canClaim ? entry.day < nextDay : entry.day <= nextDay,
      isNext: entry.day === nextDay,
    }));
  }

  /**
   * 领取今日奖励。
   * @returns {{ success, reward: {type, amount, day} , balances }} 或 { success: false }
   * 余额由调用方传入（全局档），奖励直接累加。
   */
  claim(balances) {
    if (!this.canClaim()) return { success: false, reason: 'already_claimed' };
    const now = this._nowFn();
    const day = this.nextDay();
    const reward = this.cycle.find(r => r.day === day) || this.cycle[0];

    if (reward.type === 'gold') balances.gold = (balances.gold || 0) + reward.amount;
    else if (reward.type === 'diamond') balances.diamond = (balances.diamond || 0) + reward.amount;

    // 连签推进（同池循环）
    this.save.streakDay = day;
    this.save.lastClaimDate = this._todayStr(now);
    return { success: true, reward, balances };
  }
}
