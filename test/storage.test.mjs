// The save file: one localStorage key, guarded, and monotone where it matters.
//
// The rule this suite exists to enforce: touching storage without a backend THROWS. A store
// that quietly returned null would let a wiped save look like a solved one.

import { test, run, eq, ok, throws } from '../tools/harness.mjs';
import { KEY, memoryBackend, localStorageBackend, createStore } from '../js/core/storage.js';

test('localStorageBackend refuses an environment with no localStorage', () => {
  // node has no window at all — this is the guarded-exception path, and it must be loud.
  throws(() => localStorageBackend(), 'expected localStorageBackend() to throw without a window');
  globalThis.window = { localStorage: fakeLS() };
  try {
    const b = localStorageBackend();
    eq(b.name, 'local');
    b.setItem('x', '1');
    eq(b.getItem('x'), '1');
  } finally {
    delete globalThis.window;
  }
  throws(() => localStorageBackend(), 'and it throws again once the window is gone');
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

function fakeLS() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

run();
