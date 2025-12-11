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

app.use('/admin/queues', serverAdapter.getRouter());

// 🔴 IMPORTANT: use process.env.PORT for DigitalOcean
const PORT = Number(process.env.PORT || 3005);

app.listen(PORT, () => {
  console.log(`BullMQ Dashboard on :${PORT}/admin/queues`);
});
