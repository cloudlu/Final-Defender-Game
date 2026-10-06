/**
 * AuthClient: 注册/登录 API 封装。v9.3：无本地存储——会话在内存（断网/刷新即需重登，与"断网不可玩"一致）。
 */
const BASE_URL = '/api/auth';

export class AuthClient {
  /** 内存会话（页面刷新即清） */
  static session = null;

  async register(username, password) {
    try {
      const res = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      return await res.json();
    } catch {
      return { success: false, error: '无法连接服务器' };
    }
  }

  async login(username, password) {
    try {
      const res = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      return await res.json();
    } catch {
      return { success: false, error: '无法连接服务器' };
    }
  }

  /** 当前会话（未登录 null；仅内存，刷新即清） */
  static getSession() {
    return AuthClient.session;
  }

  static setSession(username, slot) {
    AuthClient.session = { username, slot };
  }

  static clearSession() {
    AuthClient.session = null;
  }

  /** 修改密码（需旧密码验证） */
  async changePassword(username, oldPassword, newPassword) {
    try {
      const res = await fetch(`${BASE_URL}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, oldPassword, newPassword }),
      });
      return await res.json();
    } catch {
      return { success: false, error: '无法连接服务器' };
    }
  }

  /** 删除账号（需密码二次确认，连同存档一并删除） */
  async deleteAccount(username, password) {
    try {
      const res = await fetch(`${BASE_URL}/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      return await res.json();
    } catch {
      return { success: false, error: '无法连接服务器' };
    }
  }
}
