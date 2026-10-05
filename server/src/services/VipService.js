import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIP_DIR = path.join(__dirname, '..', 'data', 'vip');

/**
 * VIP 等级表（v7.10 原版对齐）：
 * 累充门槛（元）：6/30/60/120/200/300/600/1200/2000/4000/6000/12000/20000/28000/40000 → VIP1-15
 * 原版 VIP 是功能性特权（快速战斗/BOSS 挑战购买/商品栏位/佣兵加速/BOSS 宝箱/扫荡/尊爵），非数值加成。
 * vipExp 语义 = 累计充值元。
 */
export const VIP_LEVELS = [
  { level: 0, requiredYuan: 0 },
  { level: 1, requiredYuan: 6 },
  { level: 2, requiredYuan: 30 },
  { level: 3, requiredYuan: 60 },
  { level: 4, requiredYuan: 120 },
  { level: 5, requiredYuan: 200 },
  { level: 6, requiredYuan: 300 },
  { level: 7, requiredYuan: 600 },
  { level: 8, requiredYuan: 1200 },
  { level: 9, requiredYuan: 2000 },
  { level: 10, requiredYuan: 4000 },
  { level: 11, requiredYuan: 6000 },
  { level: 12, requiredYuan: 12000 },
  { level: 13, requiredYuan: 20000 },
  { level: 14, requiredYuan: 28000 },
  { level: 15, requiredYuan: 40000 },
];

const PERKS = {
  1: ['fastBattle+1'],
  2: ['fastBattle+1', 'bossChallengeBuy'],
  3: ['goldBuyPlus'],
  4: ['goldBuyPlus', 'premiumShop'],
  5: ['mercSpeedUp'],
  6: ['mercSpeedUp', 'bossChest'],
  7: ['sweepUnlock'],
  8: ['sweepUnlock', 'fastBattlePlus'],
  12: ['premiumPass'],
};

export class VipService {
  async _readPlayer(playerId) {
    try {
      const raw = await fs.readFile(path.join(VIP_DIR, `${playerId}.json`), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { playerId, vipExp: 0 }; // vipExp = 累计充值元
    }
  }

  async _writePlayer(data) {
    await fs.mkdir(VIP_DIR, { recursive: true });
    await fs.writeFile(path.join(VIP_DIR, `${data.playerId}.json`), JSON.stringify(data, null, 2), 'utf-8');
  }

  getLevelForExp(exp) {
    for (let i = VIP_LEVELS.length - 1; i >= 0; i--) {
      if (exp >= VIP_LEVELS[i].requiredYuan) return VIP_LEVELS[i];
    }
    return VIP_LEVELS[0];
  }

  _nextLevelInfo(level) {
    return VIP_LEVELS.find(l => l.level === level + 1) || null;
  }

  async getVipInfo(playerId) {
    const data = await this._readPlayer(playerId);
    const level = this.getLevelForExp(data.vipExp);
    const next = this._nextLevelInfo(level.level);
    return {
      playerId,
      vipLevel: level.level,
      vipExp: data.vipExp, // 累计充值元
      perks: PERKS[level.level] || [],
      nextLevelYuan: next ? next.requiredYuan : null,
    };
  }

  /** 兑换码/充值后调用：累加 vipExp 并返回新等级信息 */
  async addVipExp(playerId, exp) {
    const data = await this._readPlayer(playerId);
    data.vipExp += exp;
    await this._writePlayer(data);
    return this.getVipInfo(playerId);
  }
}
