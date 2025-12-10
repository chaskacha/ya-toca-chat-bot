// worker.ts
import 'dotenv/config'; 
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { syncMessageToWeb, syncProfileToWeb, transcribeWhatsAppAudio } from './sync';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

type JobData =
  | { kind: 'sync-profile'; waId: string; cabildoName: string | null }
  | {
      kind: 'sync-message';
      waId: string;
      type: 'station1' | 'station2' | 'station3' | 'final';
      msgType: 'text' | 'audio';
      text?: string;
      mediaId?: string;
    };

new Worker(
  'ya-toca-bg',
  async job => {
    const data = job.data as JobData;

    if (data.kind === 'sync-profile') {
      const { getProfile } = await import('./store');
      const p = await getProfile(data.waId);
      await syncProfileToWeb(data.waId, p, data.cabildoName);
      return;
    }

    if (data.kind === 'sync-message') {
      let finalText = data.text || "";
  
      if (data.msgType === 'audio' && data.mediaId) {
          finalText = await transcribeWhatsAppAudio(data.mediaId) || '';
      }
  
      if (!finalText.trim()) {
          console.log("No text extracted, skipping...");
          return;
      }
  
      await syncMessageToWeb(data.waId, data.type, finalText);
  }
  
  },
  { connection }
);

console.log('Background worker v7 ready');
