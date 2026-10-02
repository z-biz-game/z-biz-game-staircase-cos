// Save file. Two keys, plain JSON, versioned so an old shape is recognised rather than
// mistaken for a new one: `KEY` holds the progress, `SETTINGS_KEY` holds the switches
// (sound, and nothing else the player can flip from the HUD).
//
// This is the only core module allowed to look at the environment, and it does so through
// exactly one guarded function: `localStorageBackend()` THROWS when localStorage is not
// usable instead of returning null and quietly pretending the run was saved. The caller
// (js/main.js) catches that once and says out loud which backend it fell back to.
//
// Decoding happens in two stages on purpose. Stage one parses the envelope; stage two
// audits every record inside it. A record that cannot survive the audit is dropped alone,
// so one junk row in a hand-edited file costs that row and not the whole save.

export const KEY = 'staircase.save.v1';
export const SETTINGS_KEY = 'staircase.settings.v1';

// p(28) = 3718 positions, so no shipped lot is solvable anywhere near these ceilings; a
// number past them is not a score, it is a typo or a forged record.
export const MAX_OPS = 4096;
const MAX_PLAYS = 9999;
const MAX_LEVEL = 999;

export const DEFAULT_SETTINGS = { sound: true };

export function memoryBackend(initial = null) {
  const data = new Map();
  if (initial !== null && initial !== undefined) data.set(KEY, String(initial));
  return {
    name: 'memory',
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

export function localStorageBackend() {
  if (typeof localStorage === 'undefined'
    || typeof localStorage.getItem !== 'function'
    || typeof localStorage.setItem !== 'function') {
    throw new Error('localStorageBackend: no localStorage here (node, or a page that blocked it)');
  }
  const probe = `${KEY}.probe`;
  try {
    localStorage.setItem(probe, '1');   // Safari's private mode keeps the object and refuses writes
    localStorage.removeItem(probe);
  } catch (err) {
    throw new Error(`localStorageBackend: localStorage is present but unwritable (${err && err.name})`);
  }
  return {
    name: 'local',
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, String(v)),
    removeItem: (k) => localStorage.removeItem(k),
  };
}

function blank() {
  return {
    v: 1,
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, deals: 0, ops: 0, hints: 0 },
  };
}

// An integer inside a range, or null. `null` from here means "this value is not a fact",
// which is why callers must decide between dropping and defaulting rather than clamping a
// forged number into place.
function intIn(raw, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < lo || i > hi) return null;
  return i;
}

// Stage two for one record. `solved: true` with a `best` that isn't a plausible op count is
// worse than no record at all — the HUD would claim a level was cleared by an impossible run.
function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.solved !== true) return null;
  const best = intIn(raw.best, 1, MAX_OPS);
  if (best === null) return null;
  return {
    solved: true,
    best,
    plays: intIn(raw.plays, 1, MAX_PLAYS) || 1,
    deals: intIn(raw.deals, 0, MAX_OPS) || 0,
    perfect: raw.perfect === true,
  };
}

function cleanDaily(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [date, hit] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!hit || typeof hit !== 'object' || typeof hit.id !== 'string') continue;
    const at = intIn(hit.at, 0, Number.MAX_SAFE_INTEGER);
    out[date] = { id: hit.id, at: at === null ? 0 : at };
  }
  return out;
}

function cleanStats(raw) {
  const base = blank().stats;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  for (const [k, v] of Object.entries(base)) {
    const n = intIn(raw[k], 0, Number.MAX_SAFE_INTEGER);
    if (n !== null) base[k] = n;
  }
  return base;
}

// Same two-stage rule for the switches: only known keys, only real booleans.
function cleanSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  return out;
}

export function createStore(backend) {
  if (!backend
    || typeof backend.getItem !== 'function'
    || typeof backend.setItem !== 'function'
    || typeof backend.removeItem !== 'function') {
    throw new Error('createStore: needs a backend with getItem/setItem/removeItem');
  }

  function parse(key) {
    const raw = backend.getItem(key);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
    } catch (err) {
      // A corrupt envelope is not worth keeping; the caller starts over instead of crashing.
      return null;
    }
  }

  // `dropped` counts the records this pass threw away, so the shell can say "存档里丢了 N 条"
  // rather than silently showing a shorter list than the player earned.
  function read() {
    const p = parse(KEY);
    if (!p) return { ...blank(), dropped: 0 };
    const base = blank();
    const records = {};
    let dropped = 0;
    const rawRecords = p.records && typeof p.records === 'object' && !Array.isArray(p.records) ? p.records : {};
    for (const [id, raw] of Object.entries(rawRecords)) {
      if (typeof id !== 'string' || !id) { dropped += 1; continue; }
      const clean = cleanRecord(raw);
      if (!clean) { dropped += 1; continue; }
      records[id] = clean;
    }
    const unlocked = intIn(p.unlocked, 1, MAX_LEVEL);
    return {
      v: 1,
      records,
      daily: cleanDaily(p.daily),
      unlocked: unlocked === null ? base.unlocked : unlocked,
      stats: cleanStats(p.stats),
      dropped,
    };
  }

  function write(s) {
    const { dropped, ...persisted } = s;
    backend.setItem(KEY, JSON.stringify(persisted));
    return s;
  }

  return {
    backend: backend.name || 'custom',
    get records() { return read().records; },
    get stats() { return read().stats; },
    get daily() { return read().daily; },
    get unlocked() { return read().unlocked; },
    get dropped() { return read().dropped; },
    raw() { return backend.getItem(KEY); },
    record(id) { return read().records[id] || null; },

    settings() { return cleanSettings(parse(SETTINGS_KEY)); },

    setSetting(name, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, name)) {
        throw new Error(`setSetting: ${name} is not a setting this store knows`);
      }
      const next = { ...cleanSettings(parse(SETTINGS_KEY)), [name]: value };
      backend.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    },

    // Unlocking is monotone: re-solving an early level must never hide a later one.
    unlock(n) {
      const s = read();
      const want = intIn(n, 1, MAX_LEVEL);
      if (want !== null && want > s.unlocked) s.unlocked = want;
      write(s);
      return s.unlocked;
    },

    markDaily(dateKey, id) {
      const s = read();
      s.daily[dateKey] = { id, at: Date.now() };
      write(s);
      return s.daily[dateKey];
    },

    dailyDone(dateKey) { return read().daily[dateKey] || null; },

    // `par` is a measurement, so `perfect` is a fact about this lot rather than a feeling:
    // you matched the search. `best` only ever goes down.
    solve(id, { moves, par, deals, hints }) {
      const s = read();
      const prev = s.records[id];
      const cur = {
        solved: true,
        best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
        plays: (prev && prev.plays ? prev.plays : 0) + 1,
        perfect: moves <= par || !!(prev && prev.perfect),
        deals: !prev || !prev.deals || deals < prev.deals ? deals : prev.deals,
      };
      s.records[id] = cur;
      s.stats.solves += 1;
      s.stats.ops += moves;
      s.stats.deals += deals || 0;
      s.stats.hints += hints || 0;
      if (moves <= par && !hints) s.stats.perfect += 1;
      write(s);
      return cur;
    },

    reset() {
      backend.removeItem(KEY);
    },
  };
}
