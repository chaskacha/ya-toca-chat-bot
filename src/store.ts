import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');
const TMP  = path.join(DATA_DIR, 'profiles.json.tmp');

export type Demographics = {
  gender: string | null;
  age: string | null;
  population: string | null;
  ethnicity: string | null;
  occupation: string | null;
  education: string | null;
};

export type Profile = {
  waId: string;
  demographics: Demographics;
  demographicsCompleted: boolean;
  cabildoCompleted: boolean;
  consent?: 'yes' | 'no';
  finalWord?: string;
  lastCabildoName?: string | null;
  stationsDone?: number[]; // 1..3
};

type Store = Record<string, Profile>;
let mem: Store | null = null;

async function ensureFile() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
  try { await fs.access(FILE); } catch {
    await fs.writeFile(FILE, JSON.stringify({}, null, 2), 'utf-8');
  }
}

async function load(): Promise<Store> {
  if (mem) return mem;
  await ensureFile();
  const raw = await fs.readFile(FILE, 'utf-8').catch(() => '{}');
  mem = JSON.parse(raw || '{}') as Store;
  return mem!;
}

async function save(store: Store) {
  mem = store;
  // atomic write to reduce risk of partial files
  const payload = JSON.stringify(store, null, 2);
  await fs.writeFile(TMP, payload, 'utf-8');
  await fs.rename(TMP, FILE);
}

export async function getProfile(waId: string): Promise<Profile> {
  const store = await load();
  if (!store[waId]) {
    store[waId] = {
      waId,
      demographics: { gender: null, age: null, population: null, ethnicity: null, occupation: null, education: null },
      demographicsCompleted: false,
      cabildoCompleted: false,
      lastCabildoName: null,
      stationsDone: []
    };
    await save(store);
  }
  return store[waId];
}

export async function updateProfile(waId: string, updater: (p: Profile) => void | Profile) {
  const store = await load();
  const current = store[waId] ?? (await getProfile(waId));
  const maybe = updater(current);
  store[waId] = (maybe as Profile) || current;
  await save(store);
}

export async function getAllWaIds(): Promise<string[]> {
  const store = await load();
  return Object.keys(store);
}
