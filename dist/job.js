"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backgroundQueue = void 0;
// jobs.ts
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const connection = new ioredis_1.default(process.env.REDIS_URL || "redis://redis:6379");
exports.backgroundQueue = new bullmq_1.Queue('ya-toca-bg', {
    connection: connection,
});
