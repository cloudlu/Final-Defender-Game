/**
 * AuthClient: 注册/登录 API 封装。登录成功后 localStorage 记住会话（username+slot）。
 */
const BASE_URL = '/api/auth';

export class AuthClient {
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

  /** 当前会话（未登录 null） */
  static getSession() {
    try {
      const raw = localStorage.getItem('lastline_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  static setSession(username, slot) {
    localStorage.setItem('lastline_session', JSON.stringify({ username, slot }));
  }

  static clearSession() {
    localStorage.removeItem('lastline_session');
  }
}
