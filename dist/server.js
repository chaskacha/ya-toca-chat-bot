"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const store_1 = require("./store");
const app = (0, express_1.default)();
/** Capture raw body so we can verify X-Hub-Signature-256 */
app.use(express_1.default.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'YA_TOCA_WHATSAPP_VERIFY';
const WABA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const APP_SECRET = process.env.APP_SECRET || '';
const API_VER = process.env.GRAPH_API_VERSION || 'v21.0';
const PORT = Number(process.env.PORT || 3000);
const DRY_RUN = !WABA_TOKEN || !PHONE_ID;
/* ---------------- DEV OUTBOX (see what we would send) -------------------- */
const OUTBOX = new Map();
function devPush(to, body) {
    const arr = OUTBOX.get(to) || [];
    arr.push(body);
    OUTBOX.set(to, arr);
}
/* ---------------- Helpers ------------------------------------------------- */
const digitsOf = (txt = '') => (txt.match(/\d+/)?.[0] ?? '').trim(); // pulls 1 from " 1) "
const normalize = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\w+ ]+/g, '').replace(/\s+/g, ' ').trim();
const isMenuKeyword = (t) => ['menu', 'menú', '0'].includes(t.trim().toLowerCase());
const isHash = (t) => t.trim() === '#';
/** Deduplicate WhatsApp message deliveries (keep 5 min) */
const seen = new Set();
function firstTime(id) {
    if (!id)
        return true;
    if (seen.has(id))
        return false;
    seen.add(id);
    setTimeout(() => seen.delete(id), 5 * 60 * 1000);
    return true;
}
/** Resolve public base URL (env or ngrok) for convenience */
async function resolvePublicBaseUrl() {
    if (process.env.PUBLIC_BASE_URL)
        return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    try {
        // Prefer docker sidecar name
        const { data } = await axios_1.default.get('http://ngrok:4040/api/tunnels', { timeout: 1500 });
        const https = (data?.tunnels || []).find((t) => String(t.public_url || '').startsWith('https://'));
        if (https)
            return https.public_url;
    }
    catch { }
    try {
        // Fallback to local dev
        const { data } = await axios_1.default.get('http://localhost:4040/api/tunnels', { timeout: 1500 });
        const https = (data?.tunnels || []).find((t) => String(t.public_url || '').startsWith('https://'));
        if (https)
            return https.public_url;
    }
    catch { }
    return null;
}
/** Optional: verify Meta signature when APP_SECRET is present */
function verifyMetaSig(req) {
    if (!APP_SECRET)
        return true; // disabled
    try {
        const signature = req.get('x-hub-signature-256') || '';
        if (!signature.startsWith('sha256='))
            return false;
        const provided = signature.slice(7);
        const body = req.rawBody;
        const expected = crypto_1.default.createHmac('sha256', APP_SECRET).update(body).digest('hex');
        return crypto_1.default.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    }
    catch {
        console.log('signature error');
        return false;
    }
}
async function sendText(to, lines) {
    for (const body of lines) {
        devPush(to, body);
        if (DRY_RUN) {
            console.log('[DRY-RUN] ->', to, body.replace(/\n/g, ' ↵ '));
            continue;
        }
        try {
            await axios_1.default.post(`https://graph.facebook.com/${API_VER}/${PHONE_ID}/messages`, { messaging_product: 'whatsapp', to, type: 'text', text: { body } }, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } });
        }
        catch (err) {
            console.error('Send error:', err?.response?.data || err?.message);
        }
    }
}
// ---------------- Static copy ------------------------------------------------
const WELCOME_BOTH = [
    `¡Hola! Bienvenido/a a Ya Toca
    \n
    Este es un espacio para decir lo que pensamos, lo que sentimos y lo que queremos para nuestro país.
    \n
    ¡Gracias por escribirme!
    \n
    ¿Qué te gustaría hacer hoy?
    \n
    1. Estoy participando de un Cabildo y quiero dejar mis respuestas
    \n
    2. Quiero dejar un mensaje sobre lo que pienso, siento o quiero para mi futuro o el del país (puede ser escrito, audio, sticker… lo que quieras)
    \n
    Si quieres hacernos una pregunta, puedes escribirnos a conectamos@yatoca.pe`
];
const WELCOME_ONLY_2 = [
    `¡Hola! Bienvenido/a a Ya Toca
    \n
Ya completaste el Cabildo 👏. Puedes dejar un mensaje libre cuando quieras.
    \n
2. Quiero dejar un mensaje sobre lo que pienso, siento o quiero para mi futuro o el del país (puede ser escrito, audio, sticker… lo que quieras)
    \n
Si quieres hacernos una pregunta, puedes escribirnos a conectamos@yatoca.pe `
];
const ASK_CABILDO = [
    `¡Genial, comencemos! ¿Cómo se llama el Cabildo en el que estás participando? Pon el nombre que tu grupo haya elegido.`
];
const DEMOS = [
    {
        key: 'gender', q: `¿Con qué género te identificas?\n1. Masculino\n2. Femenino\n3. Otro\n4. Prefiero no contestar`,
        options: ['Masculino', 'Femenino', 'Otro', 'Prefiero no contestar']
    },
    {
        key: 'age', q: `¿Cuántos años tienes?\n1. Menos de 16\n2. 16-29\n3. 30-45\n4. 46 a +\n5. Prefiero no contestar`,
        options: ['Menos de 16', '16-29', '30-45', '46 a +', 'Prefiero no contestar']
    },
    {
        key: 'population', q: `¿Te sientes parte de alguna de estas poblaciones?\n
        \n1. Pueblo afroperuano\n
        \n2. Comunidad LGTBIQ+\n
        \n3. Pueblos indígenas u originarios\n
        \n4. Personas con discapacidad\n
        \n5. Ninguna de las anteriores\n
        \n6. Prefiero no contestar`,
        options: ['Pueblo afroperuano', 'Comunidad LGTBIQ+', 'Pueblos indígenas u originarios', 'Personas con discapacidad', 'Ninguna de las anteriores', 'Prefiero no contestar']
    },
    {
        key: 'ethnicity', q: `¿Con qué grupo étnico te identificas?\n1. Quechua\n2. Aimara\n3. Indígena de la Amazonía\n4. Afroperuano\n5. Blanco\n6. Mestizo\n7. Asiático o nikkei\n8. Otro\n9. Prefiero no contestar`,
        options: ['Quechua', 'Aimara', 'Indígena de la Amazonía', 'Afroperuano', 'Blanco', 'Mestizo', 'Asiático o nikkei', 'Otro', 'Prefiero no contestar']
    },
    {
        key: 'occupation', q: `¿Cuál es tu ocupación?\n1. Estudiante\n2. Trabajador dependiente\n3. Trabajador independiente\n4. Emprendedor\n5. Servidor público\n6. Representante comunitario\n7. Sin ocupación fija\n8. Otro\n9. Prefiero no contestar`,
        options: ['Estudiante', 'Trabajador dependiente', 'Trabajador independiente', 'Emprendedor', 'Servidor público', 'Representante comunitario', 'Sin ocupación fija', 'Otro', 'Prefiero no contestar']
    },
    {
        key: 'education', q: `¿Cuál es tu nivel de instrucción?\n1. Sin instrucción\n2. Primaria\n3. Secundaria\n4. Superior técnica o universitaria\n5. Postgrado\n6. Otro\n7. Prefiero no contestar`,
        options: ['Sin instrucción', 'Primaria', 'Secundaria', 'Superior técnica o universitaria', 'Postgrado', 'Otro', 'Prefiero no contestar']
    }
];
const stationPrompts = {
    1: 'Cuéntanos cómo te sentiste después de la conversación. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\n¿Qué te choca o te frustra de vivir en este país?\n¿Y qué te da esperanza o te hace sentir que sí se puede?\nPara terminar, marca #.',
    2: 'Cuéntanos cómo te sentiste después de la dinámica. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\n¿Crees que el lugar y las condiciones en las que nacimos marcan lo que podemos lograr?\n¿Cómo podemos convivir y construir con gente que piensa distinto?\nPara terminar, marca #.',
    3: 'Cuéntanos cómo te sentiste después de la dinámica. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\nSi fueras presidente/a, ¿qué harías para no decepcionar a tu generación?\n¿Cuáles serían tus prioridades?\nPara terminar, marca #.'
};
const afterStation = [
    '¿Qué quieres hacer ahora?',
    '1.- Quiero seguir con la otra estación',
    '2.- Quiero salir'
];
const finalEarlyExit = [
    'Gracias por tu buena vibra y por hablar con sinceridad. Tu voz ahora se une a la de miles de jóvenes en todo el Perú.'
];
// New: end-of-cabildo sequence
const endCabildoWord = [
    '¡Lo logramos! Llegamos al final. 🙌',
    'Gracias por tu buena vibra y por hablar con sinceridad. Tu voz ahora se une a la de miles de jóvenes en todo el Perú.',
    'YA TOCA… (completa la frase con una palabra).'
];
const consentAsk = [
    'Para finalizar, queremos que sepas que no compartiremos tu información personal ni tus respuestas de manera individual, pero sí queremos analizar las voces de todos los participantes para saber qué toca para los jóvenes en el Perú. ¿Autorizas que Ya Toca utilice tus respuestas de manera anónima?',
    '1. Sí, acepto',
    '2. No acepto'
];
const endCabildoThanks = [
    '¡Gracias! Eso es todo. Encuéntranos en nuestras diferentes redes como yatoca.pe, síguenos y entérate de todo lo que se viene!'
];
const ventIntro = [
    '¡Este es tu espacio para soltar lo que piensas, sueñas o quieres cambiar! Escríbelo, grábalo, manda un sticker… como quieras. Aquí no hay reglas, solo tu voz. Para terminar, marca #.'
];
const ventThanks = [
    'Gracias por compartir. Tu voz ahora se une a la de miles de jóvenes que creen que sí podemos construir algo distinto.'
];
function stationMenu(remaining) {
    const lines = ['¡Gracias por tus respuestas! Ahora sí, empecemos el Cabildo.', '¿En qué número de estación te encuentras?'];
    if (remaining.includes(1))
        lines.push('1. Estación 1: La catarsis');
    if (remaining.includes(2))
        lines.push('2. Estación 2: Desde nuestras circunstancias y diferencias');
    if (remaining.includes(3))
        lines.push('3. Estación 3: Yo Presidente');
    return lines;
}
function welcomeFor(p) {
    return p.cabildoCompleted ? WELCOME_ONLY_2 : WELCOME_BOTH;
}
const sessions = new Map();
const INACTIVITY_MS = 15 * 60 * 1000;
function newSession(waId) {
    const s = {
        waId,
        state: 'start',
        cabildoName: null,
        stationsDone: [],
        currentStation: null,
        messageBuffer: [],
        lastSeen: Date.now(),
    };
    sessions.set(waId, s);
    armTimer(s);
    return s;
}
function getSession(waId) {
    let s = sessions.get(waId);
    if (!s)
        s = newSession(waId);
    s.lastSeen = Date.now();
    armTimer(s);
    return s;
}
function armTimer(s) {
    if (s.timer)
        clearTimeout(s.timer);
    s.timer = setTimeout(async () => {
        await sendText(s.waId, ['Cerramos la conversación por inactividad. Si deseas continuar, escribe cualquier mensaje.']);
        sessions.delete(s.waId);
    }, INACTIVITY_MS);
}
function remainingStationsUnion(s, p) {
    const done = new Set([...(p.stationsDone ?? []), ...s.stationsDone]);
    return [1, 2, 3].filter(n => !done.has(n));
}
/* ---------------- Option matching for demographics ------------------------ */
function pickFromOptions(input, options) {
    const num = Number(digitsOf(input));
    if (!Number.isNaN(num) && num >= 1 && num <= options.length)
        return options[num - 1];
    const normInput = normalize(input);
    const norms = options.map(o => normalize(o));
    const alt = ['prefiero no responder', 'prefiero no contestar', 'no respondo', 'no contestar'];
    if (alt.includes(normInput))
        return options.find(o => normalize(o) === normalize('Prefiero no contestar')) || options[options.length - 1];
    const idx = norms.indexOf(normInput);
    return idx >= 0 ? options[idx] : null;
}
/* ---------------- Webhook verification ----------------------------------- */
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN)
        return res.status(200).send(challenge);
    return res.sendStatus(403);
});
/* ---------------- Webhook receiver --------------------------------------- */
app.post('/webhook', async (req, res) => {
    // Optional signature check
    // if (!verifyMetaSig(req)) return res.sendStatus(403);
    // Always ACK fast; process async
    res.sendStatus(200);
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg)
        return;
    const from = msg.from; // customer's wa-id (E.164 phone)
    const mid = msg.id; // message id
    // 1) Mark as read (optional)
    if (!DRY_RUN) {
        console.log(`Marking ${from} as read`);
        await axios_1.default.post(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: mid }, { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }).catch(() => { });
    }
    // Deduplicate deliveries
    if (!firstTime(msg.id))
        return;
    const type = msg.type;
    const text = type === 'text' ? (msg.text?.body || '') :
        type === 'button' ? (msg.button?.text || '') :
            type === 'interactive' ? (msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || '') :
                '[contenido]';
    const s = getSession(from);
    const profile = await (0, store_1.getProfile)(from);
    // hydrate session from profile
    if (!s.cabildoName && profile.lastCabildoName)
        s.cabildoName = profile.lastCabildoName;
    if (s.stationsDone.length === 0 && (profile.stationsDone?.length || 0) > 0)
        s.stationsDone = [...profile.stationsDone];
    // inactivity guard
    if (Date.now() - s.lastSeen > INACTIVITY_MS) {
        await sendText(from, ['Cerramos la conversación por inactividad. Si deseas continuar, escribe cualquier mensaje.']);
        sessions.delete(from);
        return;
    }
    // global back-to-menu
    if (isMenuKeyword(text)) {
        s.state = 'menu';
        await sendText(from, welcomeFor(profile));
        return;
    }
    switch (s.state) {
        case 'start':
            s.state = 'menu';
            await sendText(from, welcomeFor(profile));
            break;
        case 'menu': {
            const d = digitsOf(text);
            if (profile.cabildoCompleted) {
                if (d === '2') {
                    s.state = 'vent_input';
                    await sendText(from, ventIntro);
                }
                else if (d === '1') {
                    await sendText(from, ['Ya completaste el Cabildo. Elige la opción 2 para dejar un mensaje libre.']);
                }
                else {
                    await sendText(from, ['Elige la opción 2 para dejar un mensaje libre.']);
                }
                break;
            }
            if (d === '1') {
                if (profile.demographicsCompleted && (profile.lastCabildoName || s.cabildoName)) {
                    s.state = 'station_menu';
                    await sendText(from, stationMenu(remainingStationsUnion(s, profile)));
                }
                else {
                    s.state = 'ask_cabildo_name';
                    await sendText(from, ASK_CABILDO);
                }
            }
            else if (d === '2') {
                s.state = 'vent_input';
                await sendText(from, ventIntro);
            }
            else {
                await sendText(from, ['Por favor elige: 1 (Cabildo) o 2 (Mensaje libre).']);
            }
            break;
        }
        case 'ask_cabildo_name': {
            s.cabildoName = text.trim();
            await (0, store_1.updateProfile)(from, p => { p.lastCabildoName = s.cabildoName; });
            if (profile.demographicsCompleted) {
                s.state = 'station_menu';
                await sendText(from, stationMenu(remainingStationsUnion(s, profile)));
            }
            else {
                s.state = 'demographics_0';
                await sendText(from, [DEMOS[0].q]);
            }
            break;
        }
        case 'demographics_0':
        case 'demographics_1':
        case 'demographics_2':
        case 'demographics_3':
        case 'demographics_4':
        case 'demographics_5': {
            const idx = Number(s.state.split('_')[1]);
            const demo = DEMOS[idx];
            const picked = pickFromOptions(text, demo.options);
            if (!picked) {
                await sendText(from, ['No te entendí. Por favor elige una opción válida (número o texto).', demo.q]);
                break;
            }
            await (0, store_1.updateProfile)(from, p => { p.demographics[demo.key] = picked; });
            const next = idx + 1;
            if (next < DEMOS.length) {
                s.state = `demographics_${next}`;
                await sendText(from, [DEMOS[next].q]);
            }
            else {
                await (0, store_1.updateProfile)(from, p => { p.demographicsCompleted = true; });
                s.state = 'station_menu';
                await sendText(from, stationMenu(remainingStationsUnion(s, profile)));
            }
            break;
        }
        case 'station_menu': {
            const d = Number(digitsOf(text));
            const remain = remainingStationsUnion(s, profile);
            if ([1, 2, 3].includes(d) && remain.includes(d)) {
                s.currentStation = d;
                s.state = 'station_input';
                s.messageBuffer = [];
                await sendText(from, [stationPrompts[s.currentStation]]);
            }
            else {
                await sendText(from, stationMenu(remain).concat(['(Responde con 1, 2 o 3)']));
            }
            break;
        }
        case 'station_input': {
            if (isHash(text)) {
                if (s.currentStation && !s.stationsDone.includes(s.currentStation)) {
                    s.stationsDone.push(s.currentStation);
                    await (0, store_1.updateProfile)(from, p => {
                        const set = new Set([...(p.stationsDone ?? []), s.currentStation]);
                        p.stationsDone = Array.from(set).sort();
                    });
                }
                s.currentStation = null;
                s.messageBuffer = [];
                s.state = 'after_station';
                await sendText(from, afterStation);
            }
            else {
                s.messageBuffer.push({ at: new Date().toISOString(), type, text });
                await sendText(from, ['Gracias. Cuando termines, marca #.']);
            }
            break;
        }
        case 'after_station': {
            const d = digitsOf(text);
            if (d === '1') {
                const remain = remainingStationsUnion(s, profile);
                if (remain.length === 0) {
                    s.state = 'post_all_stations_phrase';
                    await sendText(from, endCabildoWord);
                }
                else {
                    s.state = 'station_menu';
                    await sendText(from, stationMenu(remain));
                }
            }
            else if (d === '2') {
                await sendText(from, finalEarlyExit);
                sessions.delete(from);
            }
            else {
                await sendText(from, ['Elige 1 (seguir) o 2 (salir).']);
            }
            break;
        }
        case 'post_all_stations_phrase': {
            const word = text.trim();
            await (0, store_1.updateProfile)(from, p => { p.finalWord = word; });
            s.state = 'consent';
            await sendText(from, consentAsk);
            break;
        }
        case 'consent': {
            const d = digitsOf(text);
            if (d === '1' || d === '2') {
                await (0, store_1.updateProfile)(from, p => {
                    p.cabildoCompleted = true;
                    p.consent = d === '1' ? 'yes' : 'no';
                });
                await sendText(from, endCabildoThanks);
                sessions.delete(from);
            }
            else {
                await sendText(from, ['Por favor elige 1 (Sí, acepto) o 2 (No acepto).']);
            }
            break;
        }
        case 'vent_input': {
            if (isHash(text)) {
                await sendText(from, ventThanks);
                sessions.delete(from);
            }
            else {
                await sendText(from, ['Gracias. Cuando termines, marca #.']);
            }
            break;
        }
    }
});
/* ---------------- Dev helpers -------------------------------------------- */
app.get('/_dev/outbox', (_req, res) => {
    res.json({ waids: Array.from(OUTBOX.keys()) });
});
app.get('/_dev/outbox/:waId', (req, res) => {
    const out = OUTBOX.get(req.params.waId) || [];
    res.json({ to: req.params.waId, count: out.length, messages: out });
});
app.get('/_dev/state/:waId', (req, res) => {
    res.json(sessions.get(req.params.waId) || null);
});
app.get('/_dev/profile/:waId', async (req, res) => {
    res.json(await (0, store_1.getProfile)(req.params.waId));
});
app.get('/_dev/profiles', async (_req, res) => {
    res.json({ waids: await (0, store_1.getAllWaIds)() });
});
app.post('/_dev/reset/:waId', (req, res) => {
    sessions.delete(req.params.waId);
    OUTBOX.delete(req.params.waId);
    res.json({ ok: true });
});
/** Show the public webhook URL (env or ngrok discovery) */
app.get('/_dev/url', async (_req, res) => {
    const url = await resolvePublicBaseUrl();
    res.json({ baseUrl: url, webhook: url ? `${url}/webhook` : null });
});
/* ---------------- Health -------------------------------------------------- */
app.get('/', (_req, res) => res.send('Ya Toca bot up'));
/* ---------------- Start --------------------------------------------------- */
app.listen(PORT, async () => {
    const url = await resolvePublicBaseUrl();
    console.log(`Ya Toca bot listening on :${PORT} ${DRY_RUN ? '(DRY-RUN mode)' : ''}`);
    if (url) {
        console.log(`Webhook URL: ${url}/webhook`);
    }
    else {
        console.log('Set PUBLIC_BASE_URL or run ngrok (port 4040) to print the webhook URL.');
    }
});
