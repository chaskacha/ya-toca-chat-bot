// dashboard.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import express from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const app = express();
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

const queue = new Queue('ya-toca-bg', { connection });

createBullBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || 'supersecret';

app.use('/admin/queues', (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="BullMQ Dashboard"');
    return res.status(401).send('Auth required');
  }

  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [user, pass] = decoded.split(':');

  if (user !== DASH_USER || pass !== DASH_PASS) {
    return res.status(403).send('Forbidden');
  }

  next();
});

app.use('/admin/queues', serverAdapter.getRouter());

// 🔴 IMPORTANT: use process.env.PORT for DigitalOcean
const PORT = Number(process.env.PORT || 3005);

app.listen(PORT, () => {
  console.log(`BullMQ Dashboard on :${PORT}/admin/queues`);
});
