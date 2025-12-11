import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
    scenarios: {
        cabildo_flow: {
            executor: 'per-vu-iterations',
            vus: 200,          // 200 simultaneous users
            iterations: 1,     // each user does the flow once
            maxDuration: '10m'
        },
    },
};

const WEBHOOK_URL = 'https://yatoca-chat-bot-qo8fd.ondigitalocean.app/webhook';

function makeTextMessage(waId, body, seq) {
    return {
        object: "whatsapp_business_account",
        entry: [
            {
                changes: [
                    {
                        value: {
                            messages: [
                                {
                                    id: `wamid.${waId}.${__ITER}.${seq}`,
                                    from: waId,
                                    type: "text",
                                    text: { body }
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    };
}

function makeAudioMessage(waId, mediaId, seq) {
    return {
        object: "whatsapp_business_account",
        entry: [
            {
                changes: [
                    {
                        value: {
                            messages: [
                                {
                                    id: `wamid.${waId}.${__ITER}.${seq}`,
                                    from: waId,
                                    type: "audio",
                                    audio: { id: mediaId }
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    };
}

function sendText(waId, seq, text, pause = 0.3) {
    const payload = makeTextMessage(waId, text, seq);
    http.post(WEBHOOK_URL, JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
    });
    sleep(pause);
}

function sendAudio(waId, seq, mediaId, pause = 0.3) {
    const payload = makeAudioMessage(waId, mediaId, seq);
    http.post(WEBHOOK_URL, JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
    });
    sleep(pause);
}

export default function () {
    // each VU is a unique phone / waId
    const waId = `999${String(__VU).padStart(4, '0')}`;
    let seq = 0; // per-user message sequence so msg.id is always unique

    // 1) First contact: "Hola" → menu
    sendText(waId, ++seq, 'Hola');

    // 2) Choose option 1 (Cabildo)
    sendText(waId, ++seq, '1');

    // 3) Answer: Cabildo name
    sendText(waId, ++seq, `Cabildo k6 VU${__VU}`);

    // 4) Demographics (8 questions) – we answer with numbers
    // gender
    sendText(waId, ++seq, '1');
    // age
    sendText(waId, ++seq, '2');
    // population
    sendText(waId, ++seq, '3');
    // ethnicity
    sendText(waId, ++seq, '4');
    // occupation
    sendText(waId, ++seq, '5');
    // education
    sendText(waId, ++seq, '4');
    // originRegion (e.g. 14 = Lima Metropolitana)
    sendText(waId, ++seq, '14');
    // cabildoRegion (same)
    sendText(waId, ++seq, '14');

    // After demos, bot shows station menu.
    // ------------- Station 1 flow ----------------
    // Choose station 1
    sendText(waId, ++seq, '1');

    // 3 text + 3 audio messages before "#"
    for (let i = 0; i < 3; i++) {
        // text
        sendText(
            waId,
            ++seq,
            `Estacion 1 texto ${i + 1} de usuario ${waId}`,
            0.2
        );

        // audio – fake mediaId, only for load
        sendAudio(
            waId,
            ++seq,
            `fake-media-s1-${waId}-${i + 1}`,
            0.2
        );
    }

    // finish station 1
    sendText(waId, ++seq, '#', 0.5);

    // after_station: choose "seguir"
    sendText(waId, ++seq, '1');

    // ------------- Station 2 flow ----------------
    // choose station 2
    sendText(waId, ++seq, '2');

    for (let i = 0; i < 3; i++) {
        sendText(
            waId,
            ++seq,
            `Estacion 2 texto ${i + 1} de usuario ${waId}`,
            0.2
        );

        sendAudio(
            waId,
            ++seq,
            `fake-media-s2-${waId}-${i + 1}`,
            0.2
        );
    }

    sendText(waId, ++seq, '#', 0.5);

    // after_station: choose "seguir"
    sendText(waId, ++seq, '1');

    // ------------- Station 3 flow ----------------
    // choose station 3
    sendText(waId, ++seq, '3');

    for (let i = 0; i < 3; i++) {
        sendText(
            waId,
            ++seq,
            `Estacion 3 texto ${i + 1} de usuario ${waId}`,
            0.2
        );

        sendAudio(
            waId,
            ++seq,
            `fake-media-s3-${waId}-${i + 1}`,
            0.2
        );
    }

    sendText(waId, ++seq, '#', 0.5);

    // Now all stations done → bot asks for final "YA TOCA..." phrase
    sendText(waId, ++seq, 'cambiar las cosas');

    // Then bot asks for consent
    sendText(waId, ++seq, '1');
}
