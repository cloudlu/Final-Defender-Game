import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODES_DIR = path.join(__dirname, '..', 'data', 'codes');

export class CodeService {
  async redeem(code, playerId) {
    const filePath = path.join(CODES_DIR, `${code}.json`);
    let codeData;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      codeData = JSON.parse(raw);
    } catch {
      throw new Error('Invalid code');
    }

    if (codeData.used && codeData.maxUses <= 1) {
      throw new Error('Code already used');
    }
    if (codeData.expiresAt && new Date(codeData.expiresAt) < new Date()) {
      throw new Error('Code expired');
    }

    codeData.used = true;
    codeData.usedBy = playerId;
    codeData.usedAt = new Date().toISOString();
    await fs.mkdir(CODES_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(codeData, null, 2), 'utf-8');

    return {
      success: true,
      type: codeData.type,
      amount: codeData.amount,
      vipExp: codeData.vipExp || 0,
    };
  }

  async getHistory(playerId) {
    try {
      const files = await fs.readdir(CODES_DIR);
      const history = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const raw = await fs.readFile(path.join(CODES_DIR, f), 'utf-8');
        const data = JSON.parse(raw);
        if (data.usedBy === playerId) {
          history.push({ code: data.code, type: data.type, amount: data.amount, usedAt: data.usedAt });
        }
      }
      return history;
    } catch {
      return [];
    }
  }
}
