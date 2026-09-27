/**
 * 充值兑换码种子生成（临时充值形态：输入特殊代码 → 对应档位）。
 * 用法：node scripts/genCodes.js
 * 生成 server/data/codes/*.json：
 *   VIPx-{rand}  → vipExp = 对应档位金额 ×100（VIP1=600 ... VIP6=64800）
 *   DIA{N}-{rand} → type=diamond, amount=N
 * 注意：vipExp 语义 = 累计充值元 ×100（服务端 VIP_LEVELS 600/3000/9800/19800/32800/64800）
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 与 CodeService 的 CODES_DIR（src/../data/codes = src/data/codes）保持一致
const CODES_DIR = path.join(__dirname, '..', 'src', 'data', 'codes');

const TIERS = [
  { name: 'VIP1', vipExp: 600, diamond: 60 },
  { name: 'VIP2', vipExp: 3000, diamond: 300 },
  { name: 'VIP3', vipExp: 9800, diamond: 980 },
  { name: 'VIP4', vipExp: 19800, diamond: 1980 },
  { name: 'VIP5', vipExp: 32800, diamond: 3280 },
  { name: 'VIP6', vipExp: 64800, diamond: 6480 },
  { name: 'DIA500', vipExp: 0, diamond: 500 },
  { name: 'DIA100', vipExp: 0, diamond: 100 },
];

const EXPIRES = '2027-12-31T23:59:59Z';

function rand4() {
  return crypto.randomBytes(2).toString('hex').toUpperCase();
}

async function main() {
  await fs.mkdir(CODES_DIR, { recursive: true });
  const codes = [];
  for (const tier of TIERS) {
    // 每档位生成 5 个码
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
