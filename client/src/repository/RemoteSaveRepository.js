import { ISaveRepository } from './ISaveRepository.js';

const BASE_URL = '/api';

/**
 * RemoteSaveRepository: saves to server via HTTP.
 */
export class RemoteSaveRepository extends ISaveRepository {
  async load(slotId) {
    const res = await fetch(`${BASE_URL}/save/${slotId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load save: ${res.statusText}`);
    return res.json();
  }

  async save(slotId, data) {
    const res = await fetch(`${BASE_URL}/save/${slotId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to save: ${res.statusText}`);
    return res.json();
  }

  async delete(slotId) {
    const res = await fetch(`${BASE_URL}/save/${slotId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete save: ${res.statusText}`);
  }

  async listSlots() {
    const res = await fetch(`${BASE_URL}/saves`);
    if (!res.ok) throw new Error(`Failed to list saves: ${res.statusText}`);
    return res.json();
  }
}
