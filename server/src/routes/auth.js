import express from 'express';
import { AuthService } from '../services/AuthService.js';

const router = express.Router();
const authService = new AuthService();

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await authService.register(username, password);
  if (!r.success) return res.status(400).json(r);
  res.json(r);
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await authService.login(username, password);
  if (!r.success) return res.status(401).json(r);
  res.json(r);
});

/** 用户名 → 存档槽（登录后客户端用它读写自己的存档） */
router.get('/slot', async (req, res) => {
  const { username } = req.query;
  const slot = await authService.slotFor(username);
  if (!slot) return res.status(404).json({ error: 'user not found' });
  res.json({ slot });
});

/** 修改密码（需旧密码验证） */
router.post('/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body || {};
  const r = await authService.changePassword(username, oldPassword, newPassword);
  if (!r.success) return res.status(400).json(r);
  res.json(r);
});

/** 删除账号（需密码二次确认，连同存档一并删除，不可恢复） */
router.post('/delete-account', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await authService.deleteAccount(username, password);
  if (!r.success) return res.status(400).json(r);
  res.json(r);
});

export { router as authRoutes };
