// store.ts
import IORedis from 'ioredis';

export type Demographics = {
  gender: string | null;
  age: string | null;
  population: string | null;
  ethnicity: string | null;
  occupation: string | null;
  education: string | null;
  originRegion: string | null;
  cabildoRegion: string | null;
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
  webCookie?: string | null;
};

const redisUrl = process.env.REDIS_URL;

// Fallback in local dev if you ever run without Redis
const inMemoryProfiles = new Map<string, Profile>();

let redis: IORedis | null = null;
if (redisUrl) {
  redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
} else {
  console.warn('WARNING: REDIS_URL not set, using in-memory store for profiles');
}

const PROFILE_KEY = (waId: string) => `yt:profile:${waId}`;
const PROFILE_INDEX_KEY = 'yt:profiles:index';

function defaultProfile(waId: string): Profile {
  return {
    waId,
    demographics: {
      gender: null,
      age: null,
      population: null,
      ethnicity: null,
      occupation: null,
      education: null,
      originRegion: null,
      cabildoRegion: null,
    },
    demographicsCompleted: false,
    cabildoCompleted: false,
    lastCabildoName: null,
    stationsDone: [],
    webCookie: null,
  };
}

// Small helper to ensure all fields exist after JSON.parse
function hydrateProfile(waId: string, raw: any): Profile {
  const base = defaultProfile(waId);
  return {
    ...base,
    ...raw,
    demographics: {
      ...base.demographics,
      ...(raw?.demographics ?? {}),
    },
    stationsDone: Array.isArray(raw?.stationsDone) ? raw.stationsDone : [],
  };
}

/** Get profile for a waId, creating a default one if missing */
export async function getProfile(waId: string): Promise<Profile> {
  if (!redis) {
    const existing = inMemoryProfiles.get(waId);
    if (existing) return existing;
    const fresh = defaultProfile(waId);
    inMemoryProfiles.set(waId, fresh);
    return fresh;
  }

  const key = PROFILE_KEY(waId);
  const json = await redis.get(key);

  if (!json) {
    const fresh = defaultProfile(waId);
    await redis.set(key, JSON.stringify(fresh));
    await redis.sadd(PROFILE_INDEX_KEY, waId);
    return fresh;
  }

  try {
    const parsed = JSON.parse(json);
    return hydrateProfile(waId, parsed);
  } catch {
    // if something got corrupted, reset to default
    const fresh = defaultProfile(waId);
    await redis.set(key, JSON.stringify(fresh));
    await redis.sadd(PROFILE_INDEX_KEY, waId);
    return fresh;
  }
}

/** Mutate and save profile (like you already do) */
export async function updateProfile(
  waId: string,
  mutator: (p: Profile) => void,
): Promise<void> {
  const p = await getProfile(waId);
  mutator(p);

  if (!redis) {
    inMemoryProfiles.set(waId, p);
    return;
  }

  await redis.set(PROFILE_KEY(waId), JSON.stringify(p));
  await redis.sadd(PROFILE_INDEX_KEY, waId);
}

/** List all waIds that have a profile (used by /_dev/profiles) */
export async function getAllWaIds(): Promise<string[]> {
  if (!redis) {
    return Array.from(inMemoryProfiles.keys());
  }
  const ids = await redis.smembers(PROFILE_INDEX_KEY);
  return ids;
}

/** Delete a profile (used by reset-full & "zurücksetzen") */
export async function deleteProfile(waId: string): Promise<void> {
  if (!redis) {
    inMemoryProfiles.delete(waId);
    return;
  }

  await redis.del(PROFILE_KEY(waId));
  await redis.srem(PROFILE_INDEX_KEY, waId);
}
