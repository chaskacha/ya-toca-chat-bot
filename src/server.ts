import 'dotenv/config';
import { backgroundQueue } from './job';
import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { getProfile, updateProfile, Profile, Demographics, getAllWaIds, deleteProfile } from './store';

const app = express();

/** Capture raw body so we can verify X-Hub-Signature-256 */
app.use(
    express.json({
        limit: '5mb',
        verify: (req: any, _res, buf) => {
            req.rawBody = buf;
        },
    })
);

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'YA_TOCA_WHATSAPP_VERIFY';
const WABA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const APP_SECRET = process.env.APP_SECRET || '';
const API_VER = process.env.GRAPH_API_VERSION || 'v21.0';
const PORT = Number(process.env.PORT || 3000);
const DRY_RUN = !WABA_TOKEN || !PHONE_ID;

// NEW: base URL of your Next.js web app (where /api/profile and /api/messages live)
const WEB_APP_BASE_URL = (process.env.WEB_APP_BASE_URL || '').replace(/\/+$/, '');

/* ---------------- DEV OUTBOX (see what we would send) -------------------- */
const OUTBOX = new Map<string, string[]>();
function devPush(to: string, body: string) {
    const arr = OUTBOX.get(to) || [];
    arr.push(body);
    OUTBOX.set(to, arr);
}

/* ---------------- Helpers ------------------------------------------------- */
const digitsOf = (txt = '') => (txt.match(/\d+/)?.[0] ?? '').trim(); // pulls 1 from " 1) "
const normalize = (s = '') =>
    s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\w+ ]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
const isMenuKeyword = (t: string) => ['menu', 'menú', '0'].includes(t.trim().toLowerCase());
const isHash = (t: string) => t.trim() === '#';

/** Deduplicate WhatsApp message deliveries (keep 5 min) */
const seen = new Set<string>();
function firstTime(id: string | undefined) {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    setTimeout(() => seen.delete(id), 5 * 60 * 1000);
    return true;
}

/** Resolve public base URL (env or ngrok) for convenience */
async function resolvePublicBaseUrl(): Promise<string | null> {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    try {
        // Prefer docker sidecar name
        const { data } = await axios.get('http://ngrok:4040/api/tunnels', { timeout: 1500 });
        const https = (data?.tunnels || []).find((t: any) => String(t.public_url || '').startsWith('https://'));
        if (https) return https.public_url;
    } catch { }
    try {
        // Fallback to local dev
        const { data } = await axios.get('http://localhost:4040/api/tunnels', { timeout: 1500 });
        const https = (data?.tunnels || []).find((t: any) => String(t.public_url || '').startsWith('https://'));
        if (https) return https.public_url;
    } catch { }
    return null;
}

/** Optional: verify Meta signature when APP_SECRET is present */
function verifyMetaSig(req: any): boolean {
    if (!APP_SECRET) return true; // disabled
    try {
        const signature = req.get('x-hub-signature-256') || '';
        if (!signature.startsWith('sha256=')) return false;
        const provided = signature.slice(7);
        const body = req.rawBody as Buffer;
        const expected = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
        console.log('signature error');
        return false;
    }
}

async function sendText(to: string, lines: string[]) {
    const body = lines.join('\n'); // or '\n\n' if you want extra spacing

    devPush(to, body);

    if (DRY_RUN) {
        console.log('[DRY-RUN] ->', to, body.replace(/\n/g, ' ↵ '));
        return;
    }

    try {
        await axios.post(
            `https://graph.facebook.com/${API_VER}/${PHONE_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body },
            },
            { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }
        );
    } catch (err: any) {
        console.error('Send error:', err?.response?.data || err?.message);
    }
}

function firstPendingDemoIndex(profile: Profile): number | null {
    const order: (keyof Demographics)[] = [
        'gender',
        'age',
        'population',
        'ethnicity',
        'occupation',
        'education',
        'originRegion',
        'cabildoRegion',
    ];

    const d = profile.demographics as any;
    for (let i = 0; i < order.length; i++) {
        const key = order[i];
        if (!d[key]) return i;
    }
    return null; // all answered
}

/* ---------------- Static copy / constants -------------------------------- */

// 3) list of regions for Perú
const REGIONES_PERU = [
    'Amazonas',
    'Áncash',
    'Apurímac',
    'Arequipa',
    'Ayacucho',
    'Cajamarca',
    'Callao',
    'Cusco',
    'Huancavelica',
    'Huánuco',
    'Ica',
    'Junín',
    'La Libertad',
    'Lambayeque',
    'Lima Metropolitana',
    'Lima Provincias',
    'Loreto',
    'Madre de Dios',
    'Moquegua',
    'Pasco',
    'Piura',
    'Puno',
    'San Martín',
    'Tacna',
    'Tumbes',
    'Ucayali',
    'Otro / extranjero',
] as const;

// 1 + 2) Welcome messages (no free message option)
const WELCOME_BOTH = [
    `¡Hola! Bienvenido/a a Ya Toca\nEste es un espacio para decir lo que pensamos, lo que sentimos y lo que queremos para nuestro país.\n
¡Gracias por escribirme!\n
¿Qué te gustaría hacer hoy?\n
1. Estoy participando de un Cabildo y quiero dejar mis respuestas\n
Si quieres hacernos una pregunta, puedes escribirnos a conectamos@yatoca.pe`
];

// When cabildo already completed
const WELCOME_ONLY_2 = [
    `Ya completaste el Cabildo. Gracias por compartir. Tu voz ahora se une a la de miles de jóvenes que creen que sí podemos construir algo distinto.`
];

const ASK_CABILDO = [
    `¡Genial, comencemos! ¿Cómo se llama el Cabildo en el que estás participando? Pon el nombre que tu grupo haya elegido.`
];

// 3) DEMOS: add originRegion + cabildoRegion
const DEMOS = [
    {
        key: 'gender',
        q: `¿Con qué género te identificas?\n1. Masculino\n2. Femenino\n3. Otro\n4. Prefiero no contestar`,
        options: ['Masculino', 'Femenino', 'Otro', 'Prefiero no contestar'],
    },
    {
        key: 'age',
        q: `¿Cuántos años tienes?\n1. Menos de 16\n2. 16-29\n3. 30-45\n4. 46 a +\n5. Prefiero no contestar`,
        options: ['Menos de 16', '16-29', '30-45', '46 a +', 'Prefiero no contestar'],
    },
    {
        key: 'population',
        q: `¿Te sientes parte de alguna de estas poblaciones?\n1. Pueblo afroperuano\n2. Comunidad LGTBIQ+\n3. Pueblos indígenas u originarios\n4. Personas con discapacidad\n5. Ninguna de las anteriores\n6. Prefiero no contestar`,
        options: [
            'Pueblo afroperuano',
            'Comunidad LGTBIQ+',
            'Pueblos indígenas u originarios',
            'Personas con discapacidad',
            'Ninguna de las anteriores',
            'Prefiero no contestar',
        ],
    },
    {
        key: 'ethnicity',
        q: `¿Con qué grupo étnico te identificas?\n1. Quechua\n2. Aimara\n3. Indígena de la Amazonía\n4. Afroperuano\n5. Blanco\n6. Mestizo\n7. Asiático o nikkei\n8. Otro\n9. Prefiero no contestar`,
        options: [
            'Quechua',
            'Aimara',
            'Indígena de la Amazonía',
            'Afroperuano',
            'Blanco',
            'Mestizo',
            'Asiático o nikkei',
            'Otro',
            'Prefiero no contestar',
        ],
    },
    {
        key: 'occupation',
        q: `¿Cuál es tu ocupación?\n1. Estudiante\n2. Trabajador dependiente\n3. Trabajador independiente\n4. Emprendedor\n5. Servidor público\n6. Representante comunitario\n7. Sin ocupación fija\n8. Otro\n9. Prefiero no contestar`,
        options: [
            'Estudiante',
            'Trabajador dependiente',
            'Trabajador independiente',
            'Emprendedor',
            'Servidor público',
            'Representante comunitario',
            'Sin ocupación fija',
            'Otro',
            'Prefiero no contestar',
        ],
    },
    {
        key: 'education',
        q: `¿Cuál es tu nivel de instrucción?\n1. Sin instrucción\n2. Primaria\n3. Secundaria\n4. Superior técnica o universitaria\n5. Postgrado\n6. Otro\n7. Prefiero no contestar`,
        options: [
            'Sin instrucción',
            'Primaria',
            'Secundaria',
            'Superior técnica o universitaria',
            'Postgrado',
            'Otro',
            'Prefiero no contestar',
        ],
    },
    {
        key: 'originRegion',
        q: `¿De qué región eres?\n${REGIONES_PERU.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
        options: [...REGIONES_PERU],
    },
    {
        key: 'cabildoRegion',
        q: `¿En qué región estás haciendo este cabildo?\n${REGIONES_PERU.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
        options: [...REGIONES_PERU],
    },
] as const;

const stationPrompts: Record<1 | 2 | 3, string> = {
    1: 'Cuéntanos cómo te sentiste después de la conversación. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\n¿Qué te choca o te frustra de vivir en este país?\n¿Y qué te da esperanza o te hace sentir que sí se puede?\nPara terminar, marca #.',
    2: 'Cuéntanos cómo te sentiste después de la dinámica. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\n¿Crees que el lugar y las condiciones en las que nacimos marcan lo que podemos lograr?\n¿Cómo podemos convivir y construir con gente que piensa distinto?\nPara terminar, marca #.',
    3: 'Cuéntanos cómo te sentiste después de la dinámica. Puedes hacerlo como quieras: texto, audio, sticker, lo que mejor te salga. Habla como si se lo contaras a un/a amigo/a. Aquí van unas preguntas para inspirarte:\nSi fueras presidente/a, ¿qué harías para no decepcionar a tu generación?\n¿Cuáles serían tus prioridades?\nPara terminar, marca #.',
};

const afterStation = ['¿Qué quieres hacer ahora?', '1.- Quiero seguir con la otra estación', '2.- Quiero salir'];

const finalEarlyExit = [
    'Gracias por tu buena vibra y por hablar con sinceridad. Tu voz ahora se une a la de miles de jóvenes en todo el Perú.',
];

// New: end-of-cabildo sequence
const endCabildoWord = [
    '¡Lo logramos! Llegamos al final. 🙌',
    'Gracias por tu buena vibra y por hablar con sinceridad. Tu voz ahora se une a la de miles de jóvenes en todo el Perú.\n',
    'Mensaje final',
    'YA TOCA... (completa la frase con una palabra).',
];

// 4) Consent text with single option
const consentAsk = [
    'He leído y acepto las condiciones de tratamiento de mis datos personales, conforme a la Ley N 29733.',
    '1. Sí, acepto',
];

const endCabildoThanks = [
    '¡Gracias! Eso es todo. Encuéntranos en nuestras diferentes redes como yatoca.pe, síguenos y entérate de todo lo que se viene!',
];

// There is NO free-message ("vent") mode anymore, but we keep these
// just in case you want to re-enable in the future.
// For now they are unused.
const ventIntro = [
    '¡Este es tu espacio para soltar lo que piensas, sueñas o quieres cambiar! Escríbelo, grábalo, manda un sticker… como quieras. Aquí no hay reglas, solo tu voz. Para terminar, marca #.',
];
const ventThanks = [
    'Gracias por compartir. Tu voz ahora se une a la de miles de jóvenes que creen que sí podemos construir algo distinto.',
];

function stationMenu(remaining: number[]): string[] {
    // If the user still has the 3 stations available, it's their first station.
    const isFirstStation = remaining.length === 3;

    const lines = [
        isFirstStation
            ? '¡Gracias por tus respuestas! Ahora sí, empecemos el Cabildo.'
            : '¡Perfecto, seguimos!',
        '¿En qué número de estación te encuentras?',
    ];

    if (remaining.includes(1)) lines.push('1. Estación 1: La catarsis');
    if (remaining.includes(2)) lines.push('2. Estación 2: Desde nuestras circunstancias y diferencias');
    if (remaining.includes(3)) lines.push('3. Estación 3: Yo Presidente');

    return lines;
}

function welcomeFor(p: Profile): string[] {
    return p.cabildoCompleted ? WELCOME_ONLY_2 : WELCOME_BOTH;
}

/* ---------------- Session types/store + inactivity timer ------------------ */
type State =
    | 'start'
    | 'menu'
    | 'ask_cabildo_name'
    | 'demographics_0'
    | 'demographics_1'
    | 'demographics_2'
    | 'demographics_3'
    | 'demographics_4'
    | 'demographics_5'
    | 'demographics_6'
    | 'demographics_7'
    | 'station_menu'
    | 'station_input'
    | 'after_station'
    | 'post_all_stations_phrase'
    | 'consent'
    | 'vent_input';

type Session = {
    waId: string;
    state: State;
    cabildoName: string | null;
    stationsDone: number[];
    currentStation: 1 | 2 | 3 | null;
    messageBuffer: { at: string; type: string; text: string }[];
    lastSeen: number;
    timer?: NodeJS.Timeout;
};

const sessions = new Map<string, Session>();
const INACTIVITY_MS = 15 * 60 * 1000;

function newSession(waId: string): Session {
    const s: Session = {
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
function getSession(waId: string): Session {
    let s = sessions.get(waId);
    if (!s) s = newSession(waId);
    s.lastSeen = Date.now();
    armTimer(s);
    return s;
}
function endSession(s: Session) {
    if (s.timer) {
        clearTimeout(s.timer);
        s.timer = undefined;
    }
    sessions.delete(s.waId);
    OUTBOX.delete(s.waId);
    webProfileCookies.delete(s.waId);
}
function armTimer(s: Session) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(async () => {
        // Ensure this is still the active session for this waId
        const current = sessions.get(s.waId);
        if (!current || current !== s) {
            return; // old timer from a previous session, ignore
        }

        await sendText(s.waId, [
            'Cerramos la conversación por inactividad. Si deseas continuar, escribe cualquier mensaje.'
        ]);
        endSession(s);
    }, INACTIVITY_MS);
}
function remainingStationsUnion(s: Session, p: Profile) {
    const done = new Set<number>([...(p.stationsDone ?? []), ...s.stationsDone]);
    return [1, 2, 3].filter((n) => !done.has(n));
}

/* ---------------- Option matching for demographics ------------------------ */
function pickFromOptions(input: string, options: string[]): string | null {
    const num = Number(digitsOf(input));
    if (!Number.isNaN(num) && num >= 1 && num <= options.length) return options[num - 1];

    const normInput = normalize(input);
    const norms = options.map((o) => normalize(o));
    const alt = ['prefiero no responder', 'prefiero no contestar', 'no respondo', 'no contestar'];
    if (alt.includes(normInput))
        return (
            options.find((o) => normalize(o) === normalize('Prefiero no contestar')) || options[options.length - 1]
        );

    const idx = norms.indexOf(normInput);
    return idx >= 0 ? options[idx] : null;
}

/* ---------------- WEB APP SYNC HELPERS ----------------------------------- */

/**
 * We keep the `yt_profile=...` cookie returned by /api/profile
 * so we can send it back to /api/messages, allowing that route
 * to resolve `participantId` exactly as in the web app.
 */
const webProfileCookies = new Map<string, string>(); // waId -> "yt_profile=..."


/* ---------------- Webhook verification ----------------------------------- */
app.get('/webhook', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge as string);
    return res.sendStatus(403);
});

/* ---------------- Webhook receiver --------------------------------------- */
app.post('/webhook', async (req: any, res: Response) => {
    // Optional signature check
    // if (!verifyMetaSig(req)) return res.sendStatus(403);

    // Always ACK fast; process async
    res.sendStatus(200);

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from; // customer's wa-id (E.164 phone)
    const mid = msg.id; // message id

    // 1) Mark as read (optional)
    if (!DRY_RUN) {
        console.log(`Marking ${from} as read`);
        axios.post(
            `https://graph.facebook.com/v24.0/${PHONE_ID}/messages`,
            { messaging_product: 'whatsapp', status: 'read', message_id: mid },
            { headers: { Authorization: `Bearer ${WABA_TOKEN}` } }
        ).catch(() => { /* ignore */ });
    }

    // Deduplicate deliveries
    if (!firstTime(msg.id)) return;

    let type: string = msg.type;
    let text: string;

    if (type === 'audio') {
        text = '[audio]'; // temporary placeholder
    } else {
        // existing text / button / interactive logic
        text =
            type === 'text'
                ? msg.text?.body || ''
                : type === 'button'
                    ? msg.button?.text || ''
                    : type === 'interactive'
                        ? msg.interactive?.list_reply?.title ||
                        msg.interactive?.button_reply?.title ||
                        ''
                        : '[contenido]';
    }

    const s = getSession(from);
    const profile = await getProfile(from);
    if (profile.webCookie && !webProfileCookies.has(from)) {
        webProfileCookies.set(from, profile.webCookie);
    }

    if (text.trim() === 'zurücksetzen') {
        endSession(s);
        await deleteProfile(from);
        await sendText(from, [
            'Tu estado ha sido restablecido. Escribe cualquier mensaje para empezar de cero.'
        ]);
        return;
    }

    // hydrate session from profile
    if (!s.cabildoName && profile.lastCabildoName) s.cabildoName = profile.lastCabildoName;
    if (s.stationsDone.length === 0 && (profile.stationsDone?.length || 0) > 0)
        s.stationsDone = [...(profile.stationsDone as number[])];


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

            // If Cabildo is fully completed, 1 does nothing except remind them.
            if (profile.cabildoCompleted) {
                if (d === '1') {
                    await sendText(from, [
                        'Ya completaste el Cabildo. Gracias por compartir. Tu voz ahora se une a la de miles de jóvenes que creen que sí podemos construir algo distinto.'
                    ]);
                } else {
                    await sendText(from, [
                        'Ya completaste el Cabildo. Gracias por compartir. Tu voz ahora se une a la de miles de jóvenes que creen que sí podemos construir algo distinto.'
                    ]);
                }
                break;
            }

            // For now, we only have option 1 in the menu
            if (d !== '1') {
                await sendText(from, [
                    'Por favor elige la opción 1 para continuar con el Cabildo.'
                ]);
                break;
            }

            // ---- User chose "1. Estoy participando de un Cabildo..." ----
            const hasCabildoName = !!(profile.lastCabildoName || s.cabildoName);

            // 1) No cabildo name yet → ask it
            if (!hasCabildoName) {
                s.state = 'ask_cabildo_name';
                await sendText(from, ASK_CABILDO);
                break;
            }

            // 2) Cabildo name present, demographics not completed → go to first missing demo
            if (!profile.demographicsCompleted) {
                const idx = firstPendingDemoIndex(profile);
                if (idx !== null) {
                    s.state = `demographics_${idx}` as State;
                    await sendText(from, [DEMOS[idx].q]);
                    break;
                } else {
                    // safety: mark completed if everything is filled
                    await updateProfile(from, (p) => {
                        p.demographicsCompleted = true;
                    });
                    profile.demographicsCompleted = true;
                }
            }

            // 3) Demographics done: decide between stations / final word / consent
            const remain = remainingStationsUnion(s, profile);

            if (remain.length > 0) {
                // some stations still pending
                s.state = 'station_menu';
                await sendText(from, stationMenu(remain));
            } else if (!profile.finalWord) {
                // all stations done, but no final "YA TOCA..." yet
                s.state = 'post_all_stations_phrase';
                await sendText(from, endCabildoWord);
            } else {
                // all stations + final word, but consent not answered → go back to consent
                s.state = 'consent';
                await sendText(from, consentAsk);
            }
            break;
        }


        case 'ask_cabildo_name': {
            s.cabildoName = text.trim();
            await updateProfile(from, (p) => {
                p.lastCabildoName = s.cabildoName;
            });
            if (profile.demographicsCompleted) {
                s.state = 'station_menu';
                await sendText(from, stationMenu(remainingStationsUnion(s, profile)));
            } else {
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
        case 'demographics_5':
        case 'demographics_6':
        case 'demographics_7': {
            const idx = Number(s.state.split('_')[1]);
            const demo = DEMOS[idx];
            const picked = pickFromOptions(text, demo.options as unknown as string[]);
            if (!picked) {
                await sendText(from, ['Por favor elige una opción válida (número o texto).', demo.q]);
                break;
            }
            await updateProfile(from, (p) => {
                (p.demographics as any)[demo.key as keyof Demographics] = picked;
            });
            const next = idx + 1;
            if (next < DEMOS.length) {
                s.state = `demographics_${next}` as State;
                await sendText(from, [DEMOS[next].q]);
            } else {
                await updateProfile(from, (p) => {
                    p.demographicsCompleted = true;
                });

                // after last demo: enqueue profile sync and move to station menu
                const fresh = await getProfile(from);

                s.state = 'station_menu';
                await sendText(from, stationMenu(remainingStationsUnion(s, fresh)));

                await backgroundQueue.add('sync-profile', {
                    kind: 'sync-profile',
                    waId: from,
                    cabildoName: s.cabildoName,
                });
            }
            break;
        }

        case 'station_menu': {
            const d = Number(digitsOf(text));
            const remain = remainingStationsUnion(s, profile);
            if ([1, 2, 3].includes(d) && remain.includes(d)) {
                s.currentStation = d as 1 | 2 | 3;
                s.state = 'station_input';
                s.messageBuffer = [];
                await sendText(from, [stationPrompts[s.currentStation]]);
            } else {
                await sendText(from, [
                    'Por favor elige una opción válida (número o texto).',
                    ...stationMenu(remain),
                ]);
            }
            break;
        }

        case 'station_input': {
            if (isHash(text)) {
                if (s.currentStation && !s.stationsDone.includes(s.currentStation)) {
                    s.stationsDone.push(s.currentStation);
                    await updateProfile(from, (p) => {
                        const set = new Set<number>([...(p.stationsDone ?? []), s.currentStation!]);
                        p.stationsDone = Array.from(set).sort();

                        // keep local profile object in sync for remainingStationsUnion
                        profile.stationsDone = p.stationsDone;
                    });
                }

                s.currentStation = null;
                s.messageBuffer = [];

                // 🔴 NEW: check if there are any stations left
                const remain = remainingStationsUnion(s, profile);

                if (remain.length === 0) {
                    // ✅ All stations completed → go straight to final phrase
                    s.state = 'post_all_stations_phrase';
                    await sendText(from, endCabildoWord);
                } else {
                    // ⏭ Still stations left → ask what they want to do
                    s.state = 'after_station';
                    await sendText(from, afterStation);
                }
            } else {
                // Sync each text chunk to web app as a station message
                if (s.currentStation) {
                    const stationType =
                        s.currentStation === 1
                            ? 'station1'
                            : s.currentStation === 2
                                ? 'station2'
                                : 'station3';

                    // enqueue instead of calling API directly
                    await backgroundQueue.add('sync-message', {
                        kind: 'sync-message',
                        waId: from,
                        type: stationType,
                        msgType: msg.type === 'audio' ? 'audio' : 'text',
                        text: msg.type === 'audio' ? undefined : text,
                        mediaId: msg.type === 'audio' ? msg.audio?.id : undefined,
                    });
                }

                s.messageBuffer.push({ at: new Date().toISOString(), type, text });
                await sendText(from, ['Gracias. Cuando termines, marca #.']);
                break;
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
                } else {
                    s.state = 'station_menu';
                    await sendText(from, stationMenu(remain));
                }
            } else if (d === '2') {
                await sendText(from, finalEarlyExit);
                endSession(s); // 👈 instead of sessions.delete(from)
            } else {
                await sendText(from, ['Elige 1 (seguir) o 2 (salir).']);
            }
            break;
        }


        case 'post_all_stations_phrase': {
            const word = text.trim();
            await updateProfile(from, (p) => {
                p.finalWord = word;
            });

            console.log('Enqueued final phrase');

            // enqueue sync of final phrase
            await backgroundQueue.add('sync-message', {
                kind: 'sync-message',
                waId: from,
                type: 'final',
                msgType: 'text',
                text: word,
            });

            s.state = 'consent';
            await sendText(from, consentAsk);
            break;
        }

        case 'consent': {
            const d = digitsOf(text);
            if (d === '1') {
                await updateProfile(from, (p) => {
                    p.cabildoCompleted = true;
                    p.consent = 'yes'; // only option now
                });
                await sendText(from, endCabildoThanks);
                endSession(s); // 👈
            } else {
                await sendText(from, ['Por favor elige 1 (Sí, acepto).']);
            }
            break;
        }

        case 'vent_input': {
            if (isHash(text)) {
                await sendText(from, ventThanks);
                endSession(s); // 👈
            } else {
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
    res.json(await getProfile(req.params.waId));
});
app.get('/_dev/profiles', async (_req, res) => {
    res.json({ waids: await getAllWaIds() });
});
app.post('/_dev/reset/:waId', (req, res) => {
    sessions.delete(req.params.waId);
    OUTBOX.delete(req.params.waId);
    res.json({ ok: true });
});
app.post('/_dev/reset-full/:waId', async (req, res) => {
    sessions.delete(req.params.waId);
    OUTBOX.delete(req.params.waId);
    deleteProfile(req.params.waId);
    webProfileCookies.delete(req.params.waId);
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
    } else {
        console.log('Set PUBLIC_BASE_URL or run ngrok (port 4040) to print the webhook URL.');
    }
});
