// The save file: two localStorage keys, guarded, and monotone where it matters.
//
// The rule this suite exists to enforce: touching storage without a backend THROWS. A store
// that quietly returned null would let a wiped save look like a solved one.

import { test, run, eq, ok, throws } from '../tools/harness.mjs';
import { KEY, SETTINGS_KEY, MAX_OPS, memoryBackend, localStorageBackend, createStore } from '../js/core/storage.js';

test('localStorageBackend refuses an environment with no localStorage', () => {
  // node has no localStorage at all — this is the guarded-exception path, and it must be loud.
  throws(() => localStorageBackend(), 'expected localStorageBackend() to throw without localStorage');
  globalThis.localStorage = fakeLS();
  try {
    const b = localStorageBackend();
    eq(b.name, 'local');
    b.setItem('x', '1');
    eq(b.getItem('x'), '1');
  } finally {
    delete globalThis.localStorage;
  }
  throws(() => localStorageBackend(), 'and it throws again once localStorage is gone');
});

test('localStorageBackend throws when the object is there but writes are refused', () => {
  // Safari private mode: getItem works, setItem raises QuotaExceededError. Saving must fail
  // loudly at open time, not silently at the end of a run.
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  try {
    throws(() => localStorageBackend(), 'a write-blocked localStorage must not be accepted');
  } finally {
    delete globalThis.localStorage;
  }
});

test('a store needs a real backend, not an object shaped like a hope', () => {
  throws(() => createStore(null));
  throws(() => createStore({}));
  throws(() => createStore({ getItem: () => null }));
  const s = createStore(memoryBackend());
  eq(s.backend, 'memory');
});

test('a fresh save is empty, unlocked at 1, and survives a reload', () => {
  const s = createStore(memoryBackend());
  eq([Object.keys(s.records).length, s.unlocked, s.stats.solves], [0, 1, 0]);
  eq(s.record('shoal-01'), null);
  s.solve('shoal-01', { moves: 2, par: 2, deals: 1, hints: 0 });
  const again = createStore(memoryBackend(s.raw()));
  eq(again.record('shoal-01').best, 2, 'the same bytes read back through a new store');
});

test('best only goes down, plays only go up', () => {
  const s = createStore(memoryBackend());
  s.solve('a', { moves: 9, par: 5, deals: 9 });
  eq([s.record('a').best, s.record('a').plays, s.record('a').perfect], [9, 1, false]);
  s.solve('a', { moves: 12, par: 5, deals: 12 });
  eq([s.record('a').best, s.record('a').plays, s.record('a').perfect], [9, 2, false], 'a worse run must not raise the record');
  s.solve('a', { moves: 5, par: 5, deals: 3 });
  eq([s.record('a').best, s.record('a').plays, s.record('a').perfect, s.record('a').deals], [5, 3, true, 3]);
  s.solve('a', { moves: 7, par: 5, deals: 7 });
  eq([s.record('a').best, s.record('a').perfect], [5, true], 'once perfect, always perfect');
});

test('unlock is monotone: re-solving level one cannot hide level nine', () => {
  const s = createStore(memoryBackend());
  eq(s.unlock(9), 9);
  eq(s.unlock(1), 9);
  eq(s.unlock(0), 9);
  eq(s.unlock(10), 10);
  eq(s.unlocked, 10);
});

test('the daily log remembers a date without confusing it with another', () => {
  const s = createStore(memoryBackend());
  eq(s.dailyDone('2026-09-27'), null);
  s.markDaily('2026-09-27', 'daily-2026-09-27');
  eq(s.dailyDone('2026-09-27').id, 'daily-2026-09-27');
  eq(s.dailyDone('2026-09-26'), null);
});

test('stats bill solves, operations and hints separately', () => {
  const s = createStore(memoryBackend());
  s.solve('a', { moves: 4, par: 5, deals: 2, hints: 1 });
  s.solve('b', { moves: 5, par: 5, deals: 5, hints: 0 });
  eq([s.stats.solves, s.stats.ops, s.stats.deals, s.stats.hints, s.stats.perfect], [2, 9, 7, 1, 1]);
});

test('a wipe really removes the key, and a corrupt file is not kept', () => {
  const backend = memoryBackend();
  const s = createStore(backend);
  s.solve('a', { moves: 1, par: 1, deals: 1 });
  ok(backend.getItem(KEY));
  s.reset();
  eq([backend.getItem(KEY), Object.keys(s.records).length, s.unlocked], [null, 0, 1]);
  const broken = createStore(memoryBackend('{not json'));
  eq([Object.keys(broken.records).length, broken.unlocked], [0, 1], 'a corrupt save starts clean instead of crashing');
  const wrong = createStore(memoryBackend(JSON.stringify({ records: 'nope', unlocked: -3, stats: 7 })));
  eq([Object.keys(wrong.records).length, wrong.unlocked, typeof wrong.stats], [0, 1, 'object'], 'a wrong shape is replaced by the blank one');
});

test('junk records are audited one by one: six bad rows dropped, the good one kept', () => {
  const junk = {
    v: 1,
    records: {
      'good-01': { solved: true, best: 6, plays: 2, deals: 1, perfect: true },
      'bad-null': null,                                             // null
      'bad-missing': { solved: true },                              // 缺字段：没有 best
      'bad-type': { solved: true, best: 'lots', plays: 2, deals: 1 }, // 类型错
      'bad-range': { solved: true, best: MAX_OPS + 1, plays: 2, deals: 1 }, // 越界
      'bad-array': [1, 2, 3],                                       // 形状错
      'bad-unsolved': { solved: false, best: 3 },                   // 没通关的记录不占位
    },
    daily: { '2026-09-27': { id: 'daily-2026-09-27', at: 1 }, 'not-a-date': { id: 'x' }, '2026-09-28': 'nope' },
    unlocked: 'seven',
    stats: { solves: 1e30, ops: -4, perfect: 2, deals: 3, hints: 4 },
  };
  const s = createStore(memoryBackend(JSON.stringify(junk)));
  eq(Object.keys(s.records), ['good-01'], 'the shell must never see a record it cannot render');
  eq(s.record('bad-null'), null);
  eq(s.dropped, 6);
  eq(s.record('good-01').best, 6, 'a neighbour being junk must not rewrite a valid best');
  eq(Object.keys(s.daily), ['2026-09-27'], 'a daily row is kept only with a date-shaped key and an id');
  eq(s.unlocked, 1, 'an unparseable unlock level falls back to the blank one, never to Infinity');
  eq([s.stats.solves, s.stats.ops], [0, 0], 'a stat past the ceiling is 0, not a forged 1e30');
  eq([s.stats.perfect, s.stats.deals, s.stats.hints], [2, 3, 4], 'the sane stats survive untouched');
  // And the HUD arithmetic main.js runs on must not be able to throw:
  eq(Object.values(s.records).filter((r) => r.solved).length, 1);
});

test('the audit does not disturb a save the store itself wrote', () => {
  const a = createStore(memoryBackend());
  a.solve('c1', { moves: 5, par: 5, deals: 2, hints: 0 });
  a.solve('c2', { moves: 9, par: 6, deals: 4, hints: 1 });
  a.unlock(3);
  const b = createStore(memoryBackend(a.raw()));
  eq([b.dropped, b.unlocked, Object.keys(b.records).length], [0, 3, 2]);
  eq(b.raw(), a.raw(), 'a round trip must not silently rewrite the file');
});

test('settings round-trip through their own key and only know their own keys', () => {
  const s = createStore(memoryBackend());
  eq(s.settings(), { sound: true }, 'sound defaults to on');
  eq(s.setSetting('sound', false), { sound: false });
  eq(createStore(memoryBackend()).settings(), { sound: true }, 'a fresh store is unaffected');
  eq(s.settings().sound, false);
  throws(() => s.setSetting('volume', 11), 'unknown settings are refused, not accumulated');
  ok(s.raw() === null, 'writing a setting must not touch the progress key');

  const stored = memoryBackend();
  stored.setItem(SETTINGS_KEY, JSON.stringify({ sound: 'yes', extra: 1 }));
  const p = createStore(stored);
  eq(p.settings(), { sound: true }, 'a string is not a boolean');
  eq(Object.keys(p.settings()), ['sound'], 'unknown keys never enter the object the HUD reads');
  stored.setItem(SETTINGS_KEY, '{oops');
  eq(p.settings(), { sound: true }, 'a corrupt settings blob is the blank one');
});

function fakeLS() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

run();
