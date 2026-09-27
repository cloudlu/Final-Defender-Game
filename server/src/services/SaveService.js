import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVES_DIR = path.join(__dirname, '..', 'data', 'saves');

async function ensureDir() {
  await fs.mkdir(SAVES_DIR, { recursive: true });
}

export class SaveService {
  async load(slotId) {
    const filePath = path.join(SAVES_DIR, `${slotId}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async save(slotId, data) {
    await ensureDir();
    const filePath = path.join(SAVES_DIR, `${slotId}.json`);
    const saveData = { ...data, slotId, timestamp: new Date().toISOString() };
    await fs.writeFile(filePath, JSON.stringify(saveData, null, 2), 'utf-8');
    return saveData;
  }

  async delete(slotId) {
    const filePath = path.join(SAVES_DIR, `${slotId}.json`);
    try { await fs.unlink(filePath); } catch { /* ignore */ }
  }

  async listSlots() {
    await ensureDir();
    try {
      const files = await fs.readdir(SAVES_DIR);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => parseInt(f.replace('.json', '')))
        .filter(n => !isNaN(n));
    } catch {
      return [];
    }
  }
}
