import { RemoteSaveRepository } from './RemoteSaveRepository.js';

/**
 * SyncedSaveRepository: v9.3 纯远端（localStorage 已按需求完全移除，断网即不可写）。
 * 保留类名以兼容现有调用方；load/save 直通远端，失败上抛由调用方决策。
 */
export class SyncedSaveRepository {
  constructor() {
    this.remote = new RemoteSaveRepository();
    this.lastRemoteError = null;
  }

  async load(slotId) {
    try {
      return await this.remote.load(slotId);
    } catch (e) {
      this.lastRemoteError = e?.message || 'remote load failed';
      return null;
    }
  }

  async save(slotId, data) {
    try {
      await this.remote.save(slotId, data);
      this.lastRemoteError = null;
    } catch (e) {
      this.lastRemoteError = e?.message || 'remote save failed';
      // 静默（离线时进度不落盘，与"断网不可玩"一致）；调用方不阻塞
    }
    return { success: !this.lastRemoteError };
  }

  async delete(slotId) {
    await this.remote.delete(slotId);
  }

  async listSlots() {
    return this.remote.listSlots();
  }
}
