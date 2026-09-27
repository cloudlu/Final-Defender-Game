/**
 * VipClient: 服务端 VIP/兑换码 API 封装。
 * 服务端不可达时所有方法安全降级（返回 null / 本地回退），不阻塞游戏。
 */
const BASE_URL = '/api/recharge';

export class VipClient {
  constructor(playerId = 'player1') {
    this.playerId = playerId;
  }

  async getVipInfo() {
    try {
      const res = await fetch(`${BASE_URL}/vip/info?playerId=${this.playerId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // 离线/服务端未启动
    }
  }

  /**
   * 兑换充值码。
   * @returns {{ success, type, amount, vipExp, vipInfo? }|{ success:false, error }} 或 null（网络不可达）
   */
  async redeem(code) {
    try {
      const res = await fetch(`${BASE_URL}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, playerId: this.playerId }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || '兑换失败' };
      return data;
    } catch {
      return null;
    }
  }
}
