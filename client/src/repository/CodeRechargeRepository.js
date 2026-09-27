import { IRechargeRepository } from './IRechargeRepository.js';

const BASE_URL = '/api';

/**
 * CodeRechargeRepository: redeems codes via server API.
 */
export class CodeRechargeRepository extends IRechargeRepository {
  async redeem(code, playerId) {
    const res = await fetch(`${BASE_URL}/recharge/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, playerId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Redeem failed');
    }
    return res.json();
  }

  async getHistory(playerId) {
    const res = await fetch(`${BASE_URL}/recharge/history?playerId=${playerId}`);
    if (!res.ok) throw new Error('Failed to get history');
    return res.json();
  }

  async getVipInfo(playerId) {
    const res = await fetch(`${BASE_URL}/vip/info?playerId=${playerId}`);
    if (!res.ok) throw new Error('Failed to get VIP info');
    return res.json();
  }
}
