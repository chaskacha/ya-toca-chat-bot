// sync.ts
import axios from 'axios';
import FormData from 'form-data';
import { Profile } from './store';

const WABA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const API_VER = process.env.GRAPH_API_VERSION || 'v21.0';
const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || '').replace(/\/+$/, '');

const webProfileCookies = new Map<string, string>(); // waId -> "yt_profile=..."

// you already had rememberWebProfileCookie in server.ts – move it here
export async function rememberWebProfileCookie(waId: string, setCookieHeader?: string[]) {
  if (!setCookieHeader) return;
  const cookie = setCookieHeader.find((c) => c.startsWith('yt_profile='));
  if (!cookie) return;

  const pair = cookie.split(';')[0]; // "yt_profile=..."

  webProfileCookies.set(waId, pair);

  const { updateProfile } = await import('./store');
  await updateProfile(waId, (p) => {
    (p as any).webCookie = pair;
  });
}

// send profile to /api/profile (you already had this)
export async function syncProfileToWeb(waId: string, profile: Profile, cabildoName: string | null) {
  if (!WEB_APP_BASE_URL || !cabildoName) return;

  const d: any = profile.demographics || {};

  const payload = {
    cabildoName,
    phone: waId,
    demographics: {
      gender: d.gender || '',
      age: d.age || '',
      population: d.population || '',
      ethnicity: d.ethnicity || '',
      occupation: d.occupation || '',
      education: d.education || '',
      originRegion: d.originRegion || '',
      cabildoRegion: d.cabildoRegion || '',
    },
    consent: true,
  };

  const res = await axios.post(`${WEB_APP_BASE_URL}/api/profile`, payload, {
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });

  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  if (Array.isArray(setCookie)) await rememberWebProfileCookie(waId, setCookie);
}

// send message to /api/messages
export async function syncMessageToWeb(
  waId: string,
  type: 'station1' | 'station2' | 'station3' | 'final',
  text: string
) {
  if (!WEB_APP_BASE_URL) return;

  const { getProfile } = await import('./store');
  const p = await getProfile(waId);

  let cookie = (p as any).webCookie as string | undefined;
  if (!cookie) {
    const cached = webProfileCookies.get(waId);
    if (cached) cookie = cached;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;

  await axios.post(
    `${WEB_APP_BASE_URL}/api/messages`,
    { type, text },
    { headers, validateStatus: () => true }
  );
}

// download WA audio -> send to /api/transcribe -> text
export async function transcribeWhatsAppAudio(mediaId: string): Promise<string | null> {
  if (!WEB_APP_BASE_URL || !WABA_TOKEN) return null;

  try {
    // 1) get URL
    const metaRes = await axios.get(
      `https://graph.facebook.com/${API_VER}/${mediaId}`,
      { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }
    );
    const mediaUrl: string | undefined = metaRes.data?.url;
    if (!mediaUrl) return null;

    // 2) download bytes
    const audioRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${WABA_TOKEN}` },
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(audioRes.data);
    const contentType = audioRes.headers['content-type'] || 'audio/ogg';

    // 3) send to /api/transcribe
    const fd = new FormData();
    fd.append('file', buffer, {
      filename: `wa-audio-${mediaId}.ogg`,
      contentType,
    });
    fd.append('lang', 'es');

    console.log("Transcribing audio for", mediaId);

    const trRes = await axios.post(`${WEB_APP_BASE_URL}/api/transcribe`, fd, {
      headers: fd.getHeaders(),
      timeout: 60_000,
    });

    const text = (trRes.data as any)?.text?.trim?.() || '';
    return text || null;
  } catch (e: any) {
    console.error('transcribeWhatsAppAudio error:', e?.response?.data || e?.message);
    return null;
  }
}
