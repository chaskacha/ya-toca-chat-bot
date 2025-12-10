"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@bull-board/api");
const bullMQAdapter_1 = require("@bull-board/api/bullMQAdapter");
const express_1 = require("@bull-board/express");
const express_2 = __importDefault(require("express"));
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const app = (0, express_2.default)();
const serverAdapter = new express_1.ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
const connection = new ioredis_1.default(process.env.REDIS_URL || "redis://localhost:6379");
const queue = new bullmq_1.Queue('ya-toca-bg', { connection });
(0, api_1.createBullBoard)({
    queues: [new bullMQAdapter_1.BullMQAdapter(queue)],
    serverAdapter
});
app.use('/admin/queues', serverAdapter.getRouter());
app.listen(3005, () => console.log("BullMQ Dashboard on http://localhost:3005/admin/queues"));
