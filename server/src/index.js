import express from 'express';
import cors from 'cors';
import { saveRoutes } from './routes/save.js';
import { rechargeRoutes } from './routes/recharge.js';

const app = express();
const PORT = process.env.PORT || 30001;

app.use(cors());
app.use(express.json());

app.use('/api/save', saveRoutes);
app.use('/api/recharge', rechargeRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
