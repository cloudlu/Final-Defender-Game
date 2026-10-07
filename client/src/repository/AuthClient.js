/**
 * AuthClient: 注册/登录 API 封装。
 * v9.13 会话 = 服务端签发的 HMAC token（7 天过期）+ localStorage 持久化：
 *  - 刷新/重开自动凭 token 恢复会话（/me 校验），无需重输密码
 *  - token 过期/无效 → 回登录页；用户主动退出才清除
 * 进度数据仍纯远端，localStorage 只存登录态（不属于进度）。
 */
const BASE_URL = '/api/auth';
const SESSION_KEY = 'lastline_session';

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

  /** 当前会话 { username, slot, token }（localStorage 持久化） */
  static getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  static setSession(username, slot, token) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username, slot, token }));
  }

  static clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  /** 启动恢复：凭持久化 token 调 /me 校验。有效 → 更新会话返回 {username, slot}；无效/过期/断网 → null（回登录页） */
  static async restore() {
    const s = AuthClient.getSession();
    if (!s?.token) return null;
    try {
      const res = await fetch(`${BASE_URL}/me`, { headers: { Authorization: `Bearer ${s.token}` } });
      if (!res.ok) { AuthClient.clearSession(); return null; }
      const r = await res.json();
      if (!r.success) { AuthClient.clearSession(); return null; }
      AuthClient.setSession(r.username, s.slot, s.token);
      return { username: r.username, slot: s.slot };
    } catch {
      return null; // 断网：视为未登录（回登录页，重试登录时会有明确报错）
    }
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
