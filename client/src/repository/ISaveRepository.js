/**
 * ISaveRepository: interface for save data persistence.
 * Implementations: LocalSaveRepository (localStorage), RemoteSaveRepository (HTTP).
 */
export class ISaveRepository {
  async load(slotId) { throw new Error('Not implemented'); }
  async save(slotId, data) { throw new Error('Not implemented'); }
  async delete(slotId) { throw new Error('Not implemented'); }
  async listSlots() { throw new Error('Not implemented'); }
}
