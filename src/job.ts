// jobs.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

export let backgroundQueue: Queue | { add: (...args: any[]) => Promise<void> };

if (redisUrl) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  backgroundQueue = new Queue('ya-toca-bg', { connection });
} else {
  console.warn('WARNING: REDIS_URL not set, backgroundQueue is disabled');
  backgroundQueue = {
    add: async (name: string, data: any) => {
      console.log('[NO-REDIS] would enqueue:', name, data);
    },
  };
}