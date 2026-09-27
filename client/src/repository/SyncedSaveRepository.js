import { LocalSaveRepository } from './LocalSaveRepository.js';
import { RemoteSaveRepository } from './RemoteSaveRepository.js';

/**
 * SyncedSaveRepository: 本地即时写 + 远端异步同步（双写）。
 * - save: 先写本地（同步、必成功），再异步 PUT 远端（失败静默，下次覆盖）
 * - load: 远端优先（更新者胜），无远端数据则回落本地
 * 兼容 ISaveRepository 接口。
 */
export class SyncedSaveRepository {
  constructor() {
    this.local = new LocalSaveRepository();
    this.remote = new RemoteSaveRepository();
    this.lastRemoteError = null;
  }

  async load(slotId) {
    try {
      const remote = await this.remote.load(slotId);
      if (remote) {
        // 远端有数据 → 回写本地保持一致
        await this.local.save(slotId, remote);
        return remote;
      }
    } catch (e) {
      this.lastRemoteError = e?.message || 'remote load failed';
    }
    return this.local.load(slotId);
  }

  async save(slotId, data) {
    await this.local.save(slotId, data); // 本地必达
    try {
      await this.remote.save(slotId, data);
      this.lastRemoteError = null;
    } catch (e) {
      this.lastRemoteError = e?.message || 'remote save failed';
    }
    return { success: true, synced: !this.lastRemoteError };
  }

  async delete(slotId) {
    await this.local.delete(slotId);
    try { await this.remote.delete(slotId); } catch { /* 本地已删即可 */ }
  }

  async listSlots() {
    try {
      const remote = await this.remote.listSlots();
      if (remote) return remote;
    } catch { /* fallthrough */ }
    return this.local.listSlots();
  }
}
