import { ISaveRepository } from './ISaveRepository.js';

const STORAGE_KEY = 'lastline_saves';

function getStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function setStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * LocalSaveRepository: saves to localStorage.
 */
export class LocalSaveRepository extends ISaveRepository {
  async load(slotId) {
    const saves = getStorage();
    return saves[slotId] || null;
  }

  async save(slotId, data) {
    const saves = getStorage();
    saves[slotId] = { ...data, slotId, timestamp: new Date().toISOString() };
    setStorage(saves);
  }

  async delete(slotId) {
    const saves = getStorage();
    delete saves[slotId];
    setStorage(saves);
  }

  async listSlots() {
    const saves = getStorage();
    return Object.keys(saves).map(Number);
  }
}
