// jobs.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || "redis://redis:6379");
export const backgroundQueue = new Queue('ya-toca-bg', {
  connection: connection,
});

