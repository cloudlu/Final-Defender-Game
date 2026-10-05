import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const SAVES_DIR = path.join(__dirname, '..', 'data', 'saves');

/**
 * AuthService: 注册/登录（单机部署简化版）。
 * - 密码 sha256(salt + password) 哈希存储（非 HTTPS 环境下的合理基线；上 HTTPS 可再升级 bcrypt）
 * - 每用户独立存档槽：saves/<userId>.json（与旧 saves/1.json 兼容：playerId=1 即旧档）
 * - 预置账号：亮亮 / test（首次启动种子）
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
    // 种子账号：liangliang/test（登录名用 ASCII 规避 Windows 控制台编码坑；游戏内显示名可中文）
    if (!this._users.users['liangliang']) {
      await this.register('liangliang', 'test').catch(() => {});
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
    return { success: true, userId: id, username: name };
  }

  async login(username, password) {
    const db = await this._loadUsers();
    const u = db.users[String(username || '').trim()];
    if (!u) return { success: false, error: '用户不存在' };
    if (u.passwordHash !== AuthService._hash(u.salt, String(password))) {
      return { success: false, error: '密码错误' };
    }
    return { success: true, userId: u.id, username: String(username).trim() };
  }

  /** 用户名 → 存档槽 id（存档接口用） */
  async slotFor(username) {
    const db = await this._loadUsers();
    const u = db.users[String(username || '').trim()];
    return u ? u.id : null;
  }
}
