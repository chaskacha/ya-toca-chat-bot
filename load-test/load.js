import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
    stages: [
        { duration: '1m', target: 200 },
        { duration: '2m', target: 200 },
        { duration: '30s', target: 0 },
    ],
};

function makeMessage(userId, text) {
    return {
        object: "whatsapp_business_account",
        entry: [
            {
                changes: [
                    {
                        value: {
                            messages: [
                                {
                                    id: `wamid.${Math.random()}`,
                                    from: userId,
                                    type: "text",
                                    text: { body: text }
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    };
}

export default function () {
    const waId = `99900${__VU}${__ITER}`;

    http.post(
        "https://yatoca-chat-bot-qo8fd.ondigitalocean.app/webhook",
        JSON.stringify(makeMessage(waId, "Hola")),
        { headers: { "Content-Type": "application/json" } }
    );

    sleep(0.3);

    http.post(
        "https://yatoca-chat-bot-qo8fd.ondigitalocean.app/webhook",
        JSON.stringify(makeMessage(waId, "1")),
        { headers: { "Content-Type": "application/json" } }
    );

    sleep(0.3);

    http.post(
        "https://yatoca-chat-bot-qo8fd.ondigitalocean.app/webhook",
        JSON.stringify(makeMessage(waId, "2")),
        { headers: { "Content-Type": "application/json" } }
    );
}
