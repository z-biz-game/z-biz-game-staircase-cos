// Save file. One key, plain JSON, versioned so an old shape is recognised rather than
// mistaken for a new one.
//
// This is the only core module allowed to look at `window`, and it does so through exactly
// one guarded function: `localStorageBackend()` THROWS when localStorage is not usable
// instead of returning null and quietly pretending the run was saved. The caller (js/main.js)
// catches that once and says out loud which backend it fell back to.

export const KEY = 'staircase.save.v1';

export function memoryBackend(initial = null) {
  let data = initial === null || initial === undefined ? null : String(initial);
  return {
    name: 'memory',
    getItem: (k) => (k === KEY ? data : null),
    setItem: (k, v) => { if (k === KEY) data = String(v); },
    removeItem: (k) => { if (k === KEY) data = null; },
  };
}

export function localStorageBackend() {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('localStorageBackend: no window.localStorage here (node, file://, or a blocked page)');
  }
  const ls = window.localStorage;
  const probe = `${KEY}.probe`;
  ls.setItem(probe, '1');
  ls.removeItem(probe);
  return {
    name: 'local',
    getItem: (k) => ls.getItem(k),
    setItem: (k, v) => ls.setItem(k, v),
    removeItem: (k) => ls.removeItem(k),
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

export function createStore(backend) {
  if (!backend
    || typeof backend.getItem !== 'function'
    || typeof backend.setItem !== 'function'
    || typeof backend.removeItem !== 'function') {
    throw new Error('createStore: needs a backend with getItem/setItem/removeItem');
  }

  function read() {
    const raw = backend.getItem(KEY);
    if (!raw) return blank();
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return blank();
      const base = blank();
      return {
        v: 1,
        records: p.records && typeof p.records === 'object' ? p.records : base.records,
        daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
        unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
        stats: { ...base.stats, ...(p.stats || {}) },
      };
    } catch (err) {
      // A corrupt save is not worth keeping; start over rather than crash the shell.
      return blank();
    }
  }

  function write(s) {
    backend.setItem(KEY, JSON.stringify(s));
    return s;
  }

  return {
    backend: backend.name || 'custom',
    get records() { return read().records; },
    get stats() { return read().stats; },
    get daily() { return read().daily; },
    get unlocked() { return read().unlocked; },
    raw() { return backend.getItem(KEY); },
    record(id) { return read().records[id] || null; },

    // Unlocking is monotone: re-solving an early level must never hide a later one.
    unlock(n) {
      const s = read();
      if (n > s.unlocked) s.unlocked = n;
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
