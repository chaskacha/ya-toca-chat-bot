// src/redis.ts
import IORedis from 'ioredis';

export const redisConnection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  {
    // REQUIRED for BullMQ (blocking commands)
    maxRetriesPerRequest: null,
  }
);
