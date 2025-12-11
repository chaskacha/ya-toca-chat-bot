// jobs.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

export let backgroundQueue: Queue | { add: (...args: any[]) => Promise<void> };

if (redisUrl) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  backgroundQueue = new Queue('ya-toca-bg', {
    connection,
    defaultJobOptions: {
      // keep at most 1000 completed jobs, or 5 minutes
      removeOnComplete: {
        age: 60 * 5,      // seconds
        count: 1000,
      },
      // keep failed jobs a bit longer for debugging
      removeOnFail: {
        age: 60 * 60,     // 1 hour
        count: 1000,
      },
    },
  });
  console.log('Queue client v1 ready');
} else {
  console.warn('WARNING: REDIS_URL not set, backgroundQueue is disabled');
  backgroundQueue = {
    add: async (name: string, data: any) => {
      console.log('[NO-REDIS] would enqueue:', name, data);
    },
  };
}