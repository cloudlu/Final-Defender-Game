import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const SAVES_DIR = path.join(__dirname, '..', 'data', 'saves');

// ===== v9.13 Token 签发/校验（HMAC-SHA256 + 过期时间，无明文凭据参与签名密钥）=====
const TOKEN_SECRET = crypto.randomBytes(32).toString('hex'); // 进程级密钥：重启后所有 token 失效（需重登，安全权衡可接受）
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;                   // 7 天过期

function _signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function _verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expect) return null; // 签名不符
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null; // 过期
    return payload;
  } catch { return null; }
}

/**
 * AuthService: 注册/登录（单机部署简化版）。
 * - 密码 sha256(salt + password) 哈希存储（非 HTTPS 环境下的合理基线；上 HTTPS 可再升级 bcrypt）
 * - 每用户独立存档槽：saves/<userId>.json（与旧 saves/1.json 兼容：playerId=1 即旧档）
 * - 预置账号：亮亮 / test（首次启动种子）
 * - v9.13 登录签发 token（HMAC+7 天过期），客户端持久化；/api/auth/me 校验
 */
export class AuthService {
  constructor() {
    this._users = null; // 懒加载缓存
  }

  async _loadUsers() {
    if (this._users) return this._users;
    try {
      const raw = await fs.readFile(USERS_FILE, 'utf-8');
      this._users = JSON.parse(raw);
    } catch {
      this._users = { nextId: 1, users: {} };
    }
    // 种子账号：亮亮/test（服务端 UTF-8 JSON 原生支持中文；此前 ASCII 回避实为测试脚本编码误报）
    if (!this._users.users['亮亮']) {
      await this.register('亮亮', 'test').catch(() => {});
    }
    return this._users;
  }

  async _saveUsers() {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.writeFile(USERS_FILE, JSON.stringify(this._users, null, 2), 'utf-8');
  }

  static _hash(salt, password) {
    return crypto.createHash('sha256').update(`${salt}::${password}`).digest('hex');
  }

  async register(username, password) {
    const db = await this._loadUsers();
    const name = String(username || '').trim();
    if (!name || !password) return { success: false, error: '用户名和密码不能为空' };
    if (name.length > 20) return { success: false, error: '用户名过长（≤20 字符）' };
    if (String(password).length < 4) return { success: false, error: '密码至少 4 位' };
    if (db.users[name]) return { success: false, error: '用户名已存在' };
    const salt = crypto.randomBytes(8).toString('hex');
    const id = `u${db.nextId++}`;
    db.users[name] = {
      id,
      salt,
      passwordHash: AuthService._hash(salt, String(password)),
      createdAt: new Date().toISOString(),
    };
    await this._saveUsers();
    // 初始化空存档槽（避免与其他玩家存档冲突）
    await fs.mkdir(SAVES_DIR, { recursive: true });
    const token = _signToken({ userId: id, username: name, exp: Date.now() + TOKEN_TTL_MS });
    return { success: true, userId: id, username: name, token };
  }

  async login(username, password) {
    const db = await this._loadUsers();
    const u = db.users[String(username || '').trim()];
    if (!u) return { success: false, error: '用户不存在' };
    if (u.passwordHash !== AuthService._hash(u.salt, String(password))) {
      return { success: false, error: '密码错误' };
    }
    const usernameTrim = String(username).trim();
    const token = _signToken({ userId: u.id, username: usernameTrim, exp: Date.now() + TOKEN_TTL_MS });
    return { success: true, userId: u.id, username: usernameTrim, token };
  }

  /** v9.13 token 校验：有效返回 payload（userId/username），无效/过期返回 null */
  static verifyToken(token) {
    return _verifyToken(token);
  }

  /** 用户名 → 存档槽 id（存档接口用） */
  async slotFor(username) {
    const db = await this._loadUsers();
    const u = db.users[String(username || '').trim()];
    return u ? u.id : null;
  }

  /** 修改密码（已登录：验旧密码设新密码） */
  async changePassword(username, oldPassword, newPassword) {
    const db = await this._loadUsers();
    const u = db.users[String(username || '').trim()];
    if (!u) return { success: false, error: '用户不存在' };
    if (u.passwordHash !== AuthService._hash(u.salt, String(oldPassword))) {
      return { success: false, error: '旧密码错误' };
    }
    if (String(newPassword).length < 4) return { success: false, error: '新密码至少 4 位' };
    const salt = crypto.randomBytes(8).toString('hex');
    u.salt = salt;
    u.passwordHash = AuthService._hash(salt, String(newPassword));
    u.passwordChangedAt = new Date().toISOString();
    await this._saveUsers();
    return { success: true };
  }

  /** 删除账号（验密码二次确认；同时删除该用户全部存档，不可恢复） */
  async deleteAccount(username, password) {
    const db = await this._loadUsers();
    const name = String(username || '').trim();
    const u = db.users[name];
    if (!u) return { success: false, error: '用户不存在' };
    if (u.passwordHash !== AuthService._hash(u.salt, String(password))) {
      return { success: false, error: '密码错误（删除账号需密码确认）' };
    }
    const id = u.id;
    delete db.users[name];
    await this._saveUsers();
    // 删除该用户全部存档
    let saveDeleted = false;
    try {
      await fs.unlink(path.join(SAVES_DIR, `${id}.json`));
      saveDeleted = true;
    } catch { /* 无档视为已删 */ }
    return { success: true, saveDeleted };
  }
}
