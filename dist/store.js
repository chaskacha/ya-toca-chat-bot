"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = getProfile;
exports.updateProfile = updateProfile;
exports.deleteProfile = deleteProfile;
exports.getAllWaIds = getAllWaIds;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(process.cwd(), 'data');
const FILE = path_1.default.join(DATA_DIR, 'profiles.json');
const TMP = path_1.default.join(DATA_DIR, 'profiles.json.tmp');
let mem = null;
async function ensureFile() {
    try {
        await fs_1.promises.mkdir(DATA_DIR, { recursive: true });
    }
    catch { }
    try {
        await fs_1.promises.access(FILE);
    }
    catch {
        await fs_1.promises.writeFile(FILE, JSON.stringify({}, null, 2), 'utf-8');
    }
}
async function load() {
    if (mem)
        return mem;
    await ensureFile();
    const raw = await fs_1.promises.readFile(FILE, 'utf-8').catch(() => '{}');
    mem = JSON.parse(raw || '{}');
    return mem;
}
async function save(store) {
    mem = store;
    // atomic write to reduce risk of partial files
    const payload = JSON.stringify(store, null, 2);
    await fs_1.promises.writeFile(TMP, payload, 'utf-8');
    await fs_1.promises.rename(TMP, FILE);
}
async function getProfile(waId) {
    const store = await load();
    if (!store[waId]) {
        store[waId] = {
            waId,
            demographics: {
                gender: null,
                age: null,
                population: null,
                ethnicity: null,
                occupation: null,
                education: null,
                originRegion: null,
                cabildoRegion: null
            },
            demographicsCompleted: false,
            cabildoCompleted: false,
            lastCabildoName: null,
            stationsDone: [],
            webCookie: null
        };
        await save(store);
    }
    return store[waId];
}
async function updateProfile(waId, updater) {
    const store = await load();
    const current = store[waId] ?? (await getProfile(waId));
    const maybe = updater(current);
    store[waId] = maybe || current;
    await save(store);
}
async function deleteProfile(waId) {
    const store = await load(); // load current profiles.json into memory
    if (store[waId]) {
        delete store[waId]; // remove this user
        await save(store); // persist to disk (and update mem)
    }
}
async function getAllWaIds() {
    const store = await load();
    return Object.keys(store);
}
