/**
 * 充值兑换码种子生成（v7.10 原版 VIP 档位对齐）。
 * 用法：node scripts/genCodes.js
 * vipExp 语义 = 累计充值元（VIP1=6 / VIP2=30 / ... / VIP6=300 / VIP12=12000）
 * 注意：重复执行会覆盖旧码文件。
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 与 CodeService 的 CODES_DIR（src/data/codes）保持一致
const CODES_DIR = path.join(__dirname, '..', 'src', 'data', 'codes');

// 原版 VIP 档位（累计充值元）+ 每档附送钻石
const TIERS = [
  { name: 'VIP1', vipExp: 6, diamond: 60 },
  { name: 'VIP2', vipExp: 30, diamond: 300 },
  { name: 'VIP3', vipExp: 60, diamond: 600 },
  { name: 'VIP4', vipExp: 120, diamond: 1200 },
  { name: 'VIP5', vipExp: 200, diamond: 2000 },
  { name: 'VIP6', vipExp: 300, diamond: 3000 },
  { name: 'VIP8', vipExp: 1200, diamond: 6000 },
  { name: 'VIP12', vipExp: 12000, diamond: 12000 },
  { name: 'DIA500', vipExp: 0, diamond: 500 },
  { name: 'DIA100', vipExp: 0, diamond: 100 },
  { name: 'DIA6480', vipExp: 0, diamond: 6480 },
];

const EXPIRES = '2027-12-31T23:59:59Z';

function rand4() {
  return crypto.randomBytes(2).toString('hex').toUpperCase();
}

async function main() {
  await fs.mkdir(CODES_DIR, { recursive: true });
  const codes = [];
  for (const tier of TIERS) {
    for (let i = 0; i < 5; i++) {
      const code = `${tier.name}-${rand4()}${i}`;
      codes.push(code);
      await fs.writeFile(
        path.join(CODES_DIR, `${code}.json`),
        JSON.stringify({
          code,
          type: tier.vipExp > 0 ? 'vip' : 'diamond',
          amount: tier.diamond,
          vipExp: tier.vipExp,
          used: false,
          usedBy: null,
          usedAt: null,
          expiresAt: EXPIRES,
          maxUses: 1,
        }, null, 2)
      );
    }
  }
  console.log(`Generated ${codes.length} codes:`);
  for (const c of codes) console.log('  ' + c);
}

main();
