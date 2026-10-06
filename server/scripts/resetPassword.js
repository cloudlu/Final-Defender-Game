/**
 * 重置用户密码（管理员命令行工具）。
 * 用法：node scripts/resetPassword.js <用户名> <新密码>
 * 场景：玩家忘记密码且系统无邮箱/手机验证手段时的运营兜底。
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'src', 'data', 'users.json');

const [username, newPassword] = process.argv.slice(2);
if (!username || !newPassword) {
  console.log('用法: node scripts/resetPassword.js <用户名> <新密码>');
  console.log('示例: node scripts/resetPassword.js 亮亮 newpass123');
  process.exit(1);
}
if (String(newPassword).length < 4) {
  console.log('✗ 新密码至少 4 位');
  process.exit(1);
}

const db = JSON.parse(await fs.readFile(USERS_FILE, 'utf-8'));
const u = db.users[username];
if (!u) {
  console.log('✗ 用户不存在:', username);
  console.log('现有用户:', Object.keys(db.users).join(', '));
  process.exit(1);
}
const salt = crypto.randomBytes(8).toString('hex');
u.salt = salt;
u.passwordHash = crypto.createHash('sha256').update(`${salt}::${newPassword}`).digest('hex');
u.passwordChangedAt = new Date().toISOString();
await fs.writeFile(USERS_FILE, JSON.stringify(db, null, 2), 'utf-8');
console.log(`✓ 已重置 "${username}" 的密码 → ${newPassword}`);
