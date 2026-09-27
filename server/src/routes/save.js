import express from 'express';
import { SaveService } from '../services/SaveService.js';

const router = express.Router();
const saveService = new SaveService();

router.get('/:slotId', async (req, res) => {
  const slotId = parseInt(req.params.slotId);
  if (isNaN(slotId)) return res.status(400).json({ error: 'Invalid slot ID' });
  const data = await saveService.load(slotId);
  if (!data) return res.status(404).json({ error: 'Save not found' });
  res.json(data);
});

router.put('/:slotId', async (req, res) => {
  const slotId = parseInt(req.params.slotId);
  if (isNaN(slotId)) return res.status(400).json({ error: 'Invalid slot ID' });
  const result = await saveService.save(slotId, req.body);
  res.json(result);
});

router.delete('/:slotId', async (req, res) => {
  const slotId = parseInt(req.params.slotId);
  if (isNaN(slotId)) return res.status(400).json({ error: 'Invalid slot ID' });
  await saveService.delete(slotId);
  res.json({ success: true });
});

router.get('/', async (req, res) => {
  const slots = await saveService.listSlots();
  res.json(slots);
});

export { router as saveRoutes };
