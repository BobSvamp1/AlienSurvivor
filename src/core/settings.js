// Player settings, saved in the browser between sessions.

const KEY = 'alien-survivor-settings-v2';
const RECORDS_KEY = 'alien-survivor-records-v2';

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  fov: 80,
  masterVolume: 0.8,
  musicVolume: 0.5,
  quality: 'high', // low | medium | high
  damageNumbers: true,
  invertY: false,
  screenShake: true,
  cls: 'marine', // chosen class
};

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be blocked, the game still works */
  }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(safeRead(KEY) || {}) };
}

export function saveSettings(s) {
  safeWrite(KEY, s);
}

export function loadRecords() {
  return safeRead(RECORDS_KEY) || {};
}

export function saveRecord(mapId, difficulty, wave) {
  const r = loadRecords();
  const k = `${mapId}:${difficulty}`;
  if (!r[k] || wave > r[k]) {
    r[k] = wave;
    safeWrite(RECORDS_KEY, r);
    return true;
  }
  return false;
}

const STARS_KEY = 'alien-survivor-stars';
export function saveStars(mapId, difficulty, stars) {
  const r = safeRead(STARS_KEY) || {};
  const k = `${mapId}:${difficulty}`;
  if (!r[k] || stars > r[k]) { r[k] = stars; safeWrite(STARS_KEY, r); return true; }
  return false;
}
export function bestStars(mapId, difficulty = null) {
  const r = safeRead(STARS_KEY) || {};
  if (difficulty) return r[`${mapId}:${difficulty}`] || 0;
  let best = 0;
  for (const k of Object.keys(r)) if (k.startsWith(mapId + ':')) best = Math.max(best, r[k]);
  return best;
}

export function bestWave(mapId) {
  const r = loadRecords();
  let best = 0;
  for (const k of Object.keys(r)) if (k.startsWith(mapId + ':')) best = Math.max(best, r[k]);
  return best;
}
