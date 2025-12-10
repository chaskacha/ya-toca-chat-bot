"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberWebProfileCookie = rememberWebProfileCookie;
exports.syncProfileToWeb = syncProfileToWeb;
exports.syncMessageToWeb = syncMessageToWeb;
exports.transcribeWhatsAppAudio = transcribeWhatsAppAudio;
// sync.ts
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const WABA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const API_VER = process.env.GRAPH_API_VERSION || 'v21.0';
const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || '').replace(/\/+$/, '');
const webProfileCookies = new Map(); // waId -> "yt_profile=..."
// you already had rememberWebProfileCookie in server.ts – move it here
async function rememberWebProfileCookie(waId, setCookieHeader) {
    if (!setCookieHeader)
        return;
    const cookie = setCookieHeader.find((c) => c.startsWith('yt_profile='));
    if (!cookie)
        return;
    const pair = cookie.split(';')[0]; // "yt_profile=..."
    webProfileCookies.set(waId, pair);
    const { updateProfile } = await Promise.resolve().then(() => __importStar(require('./store')));
    await updateProfile(waId, (p) => {
        p.webCookie = pair;
    });
}
// send profile to /api/profile (you already had this)
async function syncProfileToWeb(waId, profile, cabildoName) {
    if (!WEB_APP_BASE_URL || !cabildoName)
        return;
    const d = profile.demographics || {};
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
    const res = await axios_1.default.post(`${WEB_APP_BASE_URL}/api/profile`, payload, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
    });
    const setCookie = res.headers['set-cookie'];
    if (Array.isArray(setCookie))
        await rememberWebProfileCookie(waId, setCookie);
}
// send message to /api/messages
async function syncMessageToWeb(waId, type, text) {
    if (!WEB_APP_BASE_URL)
        return;
    const { getProfile } = await Promise.resolve().then(() => __importStar(require('./store')));
    const p = await getProfile(waId);
    let cookie = p.webCookie;
    if (!cookie) {
        const cached = webProfileCookies.get(waId);
        if (cached)
            cookie = cached;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (cookie)
        headers['Cookie'] = cookie;
    await axios_1.default.post(`${WEB_APP_BASE_URL}/api/messages`, { type, text }, { headers, validateStatus: () => true });
}
// download WA audio -> send to /api/transcribe -> text
async function transcribeWhatsAppAudio(mediaId) {
    if (!WEB_APP_BASE_URL || !WABA_TOKEN)
        return null;
    try {
        // 1) get URL
        const metaRes = await axios_1.default.get(`https://graph.facebook.com/${API_VER}/${mediaId}`, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } });
        const mediaUrl = metaRes.data?.url;
        if (!mediaUrl)
            return null;
        // 2) download bytes
        const audioRes = await axios_1.default.get(mediaUrl, {
            headers: { Authorization: `Bearer ${WABA_TOKEN}` },
            responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(audioRes.data);
        const contentType = audioRes.headers['content-type'] || 'audio/ogg';
        // 3) send to /api/transcribe
        const fd = new form_data_1.default();
        fd.append('file', buffer, {
            filename: `wa-audio-${mediaId}.ogg`,
            contentType,
        });
        fd.append('lang', 'es');
        console.log("Transcribing audio for", mediaId);
        const trRes = await axios_1.default.post(`${WEB_APP_BASE_URL}/api/transcribe`, fd, {
            headers: fd.getHeaders(),
            timeout: 60000,
        });
        const text = trRes.data?.text?.trim?.() || '';
        return text || null;
    }
    catch (e) {
        console.error('transcribeWhatsAppAudio error:', e?.response?.data || e?.message);
        return null;
    }
}
