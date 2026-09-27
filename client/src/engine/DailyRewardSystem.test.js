import { describe, it, expect } from 'vitest';
import { DailyRewardSystem } from './DailyRewardSystem.js';

/** 固定"今天"的工具 */
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0); // 正午避免时区边缘

describe('DailyRewardSystem', () => {
  it('first claim gives day 1 reward', () => {
    let now = at(2026, 9, 20);
    const s = new DailyRewardSystem({}, { lastClaimDate: null, streakDay: 0 }, () => now);
    expect(s.canClaim()).toBe(true);
    const balances = {};
    const r = s.claim(balances);
    expect(r.success).toBe(true);
    expect(r.reward).toMatchObject({ day: 1, type: 'gold', amount: 500 });
    expect(balances.gold).toBe(500);
  });

  it('cannot claim twice on the same day', () => {
    const now = at(2026, 9, 20);
    const s = new DailyRewardSystem({}, { lastClaimDate: '2026-09-20', streakDay: 1 }, () => now);
    expect(s.canClaim()).toBe(false);
    expect(s.claim({}).success).toBe(false);
  });

  it('next day advances streak; day 7 wraps to day 1 of next cycle', () => {
    let now = at(2026, 9, 20);
    const save = { lastClaimDate: null, streakDay: 0 };
    const s = new DailyRewardSystem({}, save, () => now);
    const balances = {};
    let lastReward;
    for (let i = 0; i < 8; i++) {
      const r = s.claim(balances);
      lastReward = r.reward;
      now = new Date(now.getTime() + 24 * 3600 * 1000 + 60000); // 次日
    }
    expect(lastReward.day).toBe(1); // 8 抽后回到循环第 1 天
  });

  it('streak breaks after 48h and resets to day 1', () => {
    let now = at(2026, 9, 20);
    const save = { lastClaimDate: '2026-09-19', streakDay: 4 };
    const s = new DailyRewardSystem({}, save, () => now);
    expect(s.nextDay()).toBe(5); // 24h 内接续
    now = at(2026, 9, 25); // 6 天后
    expect(s.nextDay()).toBe(1); // 断签重置
  });

  it('calendar marks claimed / isNext correctly', () => {
    const now = at(2026, 9, 20);
    const s = new DailyRewardSystem({}, { lastClaimDate: '2026-09-19', streakDay: 2 }, () => now);
    const cal = s.getCalendar();
    expect(cal.find(d => d.day === 1).claimed).toBe(true);
    expect(cal.find(d => d.day === 2).claimed).toBe(true);
    expect(cal.find(d => d.day === 3).isNext).toBe(true);
    expect(cal.find(d => d.day === 3).claimed).toBe(false);
  });

  it('diamond rewards flow to diamond balance', () => {
    let now = at(2026, 9, 20);
    const s = new DailyRewardSystem({}, { lastClaimDate: null, streakDay: 0 }, () => now);
    const balances = {};
    s.claim(balances); // day1 gold
    now = new Date(now.getTime() + 24 * 3600 * 1000 + 60000);
    const r = s.claim(balances); // day2 diamond
    expect(r.reward.type).toBe('diamond');
    expect(balances.diamond).toBe(50);
  });
});
