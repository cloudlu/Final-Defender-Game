import express from 'express';
import { CodeService } from '../services/CodeService.js';
import { VipService } from '../services/VipService.js';

const router = express.Router();
const codeService = new CodeService();
const vipService = new VipService();

router.post('/redeem', async (req, res) => {
  const { code, playerId } = req.body;
  if (!code || !playerId) return res.status(400).json({ error: 'Missing code or playerId' });
  try {
    const result = await codeService.redeem(code, playerId);
    // 有 vipExp 的码 → 累加到玩家 VIP 档案并返回新等级
    let vipInfo = null;
    if (result.vipExp > 0) {
      vipInfo = await vipService.addVipExp(playerId, result.vipExp);
    }
    res.json({ ...result, vipInfo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  const { playerId } = req.query;
  if (!playerId) return res.status(400).json({ error: 'Missing playerId' });
  const history = await codeService.getHistory(playerId);
  res.json(history);
});

router.get('/vip/info', async (req, res) => {
  const { playerId } = req.query;
  if (!playerId) return res.status(400).json({ error: 'Missing playerId' });
  const info = await vipService.getVipInfo(playerId);
  res.json(info);
});

export { router as rechargeRoutes };
