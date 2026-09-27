/**
 * IRechargeRepository: interface for recharge/payment operations.
 * Implementations: CodeRechargeRepository (redeem codes), PaymentRechargeRepository (future).
 */
export class IRechargeRepository {
  async redeem(code, playerId) { throw new Error('Not implemented'); }
  async getHistory(playerId) { throw new Error('Not implemented'); }
  async getVipInfo(playerId) { throw new Error('Not implemented'); }
}
