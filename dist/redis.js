"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
// src/redis.ts
const ioredis_1 = __importDefault(require("ioredis"));
exports.redisConnection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    // REQUIRED for BullMQ (blocking commands)
    maxRetriesPerRequest: null,
});
