import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIP_DIR = path.join(__dirname, '..', 'data', 'vip');

/** VIP 等级表：vipExp 1:1 对应累计充值金额（分→元由兑换码层换算） */
export const VIP_LEVELS = [
  { level: 0, requiredExp: 0, goldBonus: 0 },
  { level: 1, requiredExp: 600, goldBonus: 0.1 },
  { level: 2, requiredExp: 3000, goldBonus: 0.2 },
  { level: 3, requiredExp: 9800, goldBonus: 0.3 },
  { level: 4, requiredExp: 19800, goldBonus: 0.4 },
  { level: 5, requiredExp: 32800, goldBonus: 0.5 },
  { level: 6, requiredExp: 64800, goldBonus: 0.6 },
];

export class VipService {
  async _readPlayer(playerId) {
    try {
      const raw = await fs.readFile(path.join(VIP_DIR, `${playerId}.json`), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { playerId, vipExp: 0 };
    }
  }

  async _writePlayer(data) {
    await fs.mkdir(VIP_DIR, { recursive: true });
    await fs.writeFile(path.join(VIP_DIR, `${data.playerId}.json`), JSON.stringify(data, null, 2), 'utf-8');
  }

  getLevelForExp(exp) {
    for (let i = VIP_LEVELS.length - 1; i >= 0; i--) {
      if (exp >= VIP_LEVELS[i].requiredExp) return VIP_LEVELS[i];
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
      vipExp: data.vipExp,
      goldBonus: level.goldBonus,
      nextLevelExp: next ? next.requiredExp : null,
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
