// The two criteria most easily faked by a string — 静音 and 可安装 — proven as behaviour,
// in node, with no browser and no new dependency:
//   * audio: muted must not build a single oscillator, and must suspend the context;
//   * pwa/sw: the worker must serve the network when it is alive and the cache only when it
//     is dead, must purge old cache versions, and must keep third-party requests alone.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { test, run, eq, ok, throws } from '../tools/harness.mjs';
import { createAudio, SOUND_KEYS } from '../js/audio.js';
import { registerServiceWorker, checkManifest } from '../js/pwa.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- audio -------------------------------------------------------------------------

function fakeAudio() {
  const built = { oscillators: 0, gains: 0 };
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: { name: 'destination' },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    createOscillator() {
      built.oscillators += 1;
      if (ctx.state === 'suspended') throw new Error('oscillator built while the context is suspended');
      return {
        type: 'sine',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, start() {}, stop() {},
      };
    },
    createGain() {
      built.gains += 1;
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
  };
  return { ctx, built, factory: () => ctx };
}

test('muted is a real stop: no context, no node, no play — and it counts', () => {
  const a = fakeAudio();
  const audio = createAudio({ muted: true, factory: a.factory });
  for (const v of SOUND_KEYS) eq(audio.play(v), { ok: false, reason: 'muted', nodes: 0 }, `${v} must be refused`);
  const s = audio.state();
  eq([s.nodes, s.plays, s.refusals, s.context], [0, 0, SOUND_KEYS.length, 'none']);
  eq(a.built.oscillators, 0, 'a muted shell must not build a single oscillator');
});

test('unmuting starts sound, and muting mid-run suspends the context', () => {
  const a = fakeAudio();
  const audio = createAudio({ muted: false, factory: a.factory });
  ok(audio.play('deal').ok, 'the first sound after a gesture must be heard');
  eq([audio.state().nodes, a.built.oscillators], [1, 1]);
  audio.play('deal');
  const before = audio.state().nodes;
  audio.setMuted(true);
  eq(audio.state().context, 'suspended', 'mute must suspend the AudioContext, not just mute a gain');
  for (let i = 0; i < 12; i++) audio.play('deal');
  eq(audio.state().nodes, before, '12 refused plays must build 0 nodes');
  audio.setMuted(false);
  audio.play('win');
  eq(audio.state().nodes, before + 1, 'and one play after unmuting must build exactly one');
  eq(audio.state().plays, 3);
});

test('hold() freezes and releases the same context, and unknown voices fall back to ui', () => {
  const a = fakeAudio();
  const audio = createAudio({ factory: a.factory });
  audio.play('merge');
  eq(audio.hold(true).state, 'suspended');
  eq(audio.hold(false).state, 'running');
  eq(audio.state().stops, 2, 'suspend and resume are both accounted');
  ok(audio.play('nonexistent-voice').ok, 'an unknown voice must degrade to the ui blip, not throw');
  // No WebAudio at all (node, or a browser that refused the context): silence, not a crash.
  const dry = createAudio({ factory: () => null });
  eq(dry.play('deal'), { ok: false, reason: 'no-audio-context', nodes: 0 });
  eq(dry.hold(true).ok, false, 'hold before any context exists has nothing to suspend');
});

test('the mute aliases the HUD uses all reach the same switch', () => {
  const a = fakeAudio();
  const audio = createAudio({ factory: a.factory });
  audio.play('ui');
  eq(audio.sfxEnabled, true);
  audio.mute();
  eq(audio.muted, true);
  audio.unmute();
  eq(audio.muted, false);
  audio.toggleMute();
  eq(audio.muted, true);
  audio.toggleMute();
  eq(audio.muted, false, 'three names, one state — no second source of truth');
});

// ---- pwa -------------------------------------------------------------------------

test('registerServiceWorker skips the environments that cannot host one', async () => {
  const saved = { nav: globalThis.navigator, loc: globalThis.location };
  const give = (navigator, location) => {
    Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'location', { value: location, configurable: true, writable: true });
  };
  try {
    give(undefined, { protocol: 'http:', href: 'http://h/i.html' });
    eq(await registerServiceWorker(), null, 'no navigator at all');
    give({ serviceWorker: null }, { protocol: 'http:', href: 'http://h/i.html' });
    eq(await registerServiceWorker(), null, 'a webview that hands back navigator.serviceWorker === null');
    let called = 0;
    give({ serviceWorker: { register: (...a) => { called += 1; return Promise.resolve({ installing: true, waiting: false }); } } },
      { protocol: 'file:', href: 'file:///tmp/index.html' });
    eq(await registerServiceWorker(), null, 'file:// must skip registration entirely');
    eq(called, 0, 'and skipping must mean the register call never happened');
    give({ serviceWorker: { register: () => Promise.reject(new Error('blocked by policy')) } },
      { protocol: 'https:', href: 'https://h/i.html' });
    eq(await registerServiceWorker(), null, 'a rejected registration resolves to null instead of an unhandled rejection');
    let scope = null;
    give({ serviceWorker: { register: (src, opts) => { scope = { src, opts }; return Promise.resolve({ installing: true, waiting: false }); } } },
      { protocol: 'http:', href: 'http://127.0.0.1:5212/index.html#/c/3' });
    eq(await registerServiceWorker(), { scope: '/', installing: true, update: false });
    eq(scope.src, 'sw.js', 'the worker must be registered at the page root so its scope covers the app');
  } finally {
    give(saved.nav, saved.loc);
  }
});

test('checkManifest reports the manifest the page actually links', async () => {
  const saved = globalThis.document;
  const okDoc = { querySelector: () => ({ href: 'http://h/manifest.webmanifest' }) };
  Object.defineProperty(globalThis, 'document', { value: okDoc, configurable: true, writable: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ name: 'x', start_url: './', display: 'standalone', icons: [{ src: 'a', sizes: '192x192' }] }) });
  eq(await checkManifest(), { ok: true, name: 'x', start_url: './', display: 'standalone', icons: 1 });
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
  eq(await checkManifest(), { ok: false, reason: 'http 404' }, 'a 404 manifest is an un-installable app with no symptom');
  globalThis.fetch = () => Promise.reject(new Error('boom'));
  eq(await checkManifest(), { ok: false, reason: 'Error' });
  Object.defineProperty(globalThis, 'document', { value: { querySelector: () => null }, configurable: true, writable: true });
  eq(await checkManifest(), { ok: false, reason: 'no-link' });
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, 'document', { value: saved, configurable: true, writable: true });
});

// ---- sw.js -------------------------------------------------------------------------

function driveWorker({ networkUp }) {
  const handlers = {};
  const cache = new Map();
  const puts = [];
  const purged = [];
  // A real worker resolves './index.html' against the worker script's own URL; the fake has
  // to do the same, or the shell would be cached under a key nothing ever asks for.
  const base = 'http://127.0.0.1:5212/sw.js';
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, base).href;
  let up = networkUp;
  const fetchStub = async (req) => {
    const url = abs(req);
    if (!up) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, type: 'basic', url, clone: () => ({ ok: true, url }) };
  };
  const bucket = {
    put: (req, res) => { const k = abs(req); cache.set(k, res); puts.push(k); },
    match: async (req) => cache.get(abs(req)) || null,
    add: async (req) => { const r = await fetchStub(req); cache.set(r.url, r); },
  };
  const self = {
    location: { origin: 'http://127.0.0.1:5212' },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    caches: {
      open: async () => bucket,
      keys: async () => ['staircase-v1', 'staircase-v0-ancient'],
      delete: async (n) => { purged.push(n); return true; },
    },
  };
  class Request {
    constructor(url, opts = {}) { this.url = url; Object.assign(this, opts); }
  }
  class Response {
    constructor(body, opts = {}) { this.body = body; this.status = opts.status || 200; this.headers = opts.headers || {}; }
  }
  const sandbox = {
    self, caches: self.caches, fetch: (r) => fetchStub(r), Request, Response,
    Promise, URL, console, setTimeout, Math, JSON,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });
  const respond = async (request) => {
    let p = null;
    handlers.fetch({ request, method: 'GET', respondWith: (x) => { p = x; } });
    return p ? await p : null;
  };
  return {
    handlers, respond, puts, purged, cache,
    setNetwork(v) { up = v; },
    async boot() {
      await handlers.install({});
      // The listener hands its work to waitUntil and returns nothing; awaiting the listener
      // alone would let the assertions race the shell seeding.
      let ready = null;
      handlers.activate({ waitUntil: (p) => { ready = p; } });
      if (ready) await ready;
    },
  };
}

test('the worker serves the network while it is alive', async () => {
  const w = driveWorker({ networkUp: true });
  await w.boot();
  eq(w.purged, ['staircase-v0-ancient'], 'activate must delete other cache versions, and only those');
  const res = await w.respond({ url: 'http://127.0.0.1:5212/js/core/solve.js', method: 'GET', mode: 'cors' });
  ok(res.ok, 'a live network means live code');
  ok(w.cache.has('http://127.0.0.1:5212/js/core/solve.js'), 'and it gets recorded on the way past');
});

test('the worker falls back to cache only when the network is dead', async () => {
  const w = driveWorker({ networkUp: true });
  await w.boot();
  await w.respond({ url: 'http://127.0.0.1:5212/css/game.css', method: 'GET', mode: 'cors' });
  w.setNetwork(false);
  const hit = await w.respond({ url: 'http://127.0.0.1:5212/css/game.css', method: 'GET', mode: 'cors' });
  ok(hit && hit.url.endsWith('game.css'), 'the cached copy is what comes back offline');
  const miss = await w.respond({ url: 'http://127.0.0.1:5212/nope.txt', method: 'GET', mode: 'cors' });
  eq([miss.status, miss.body], [503, 'offline: 这个资源没在本地缓存过'], 'an uncached subresource must say so, not 404 silently');
});

test('a navigation with no cache left returns the shell, and third-party is never touched', async () => {
  const w = driveWorker({ networkUp: true });
  await w.boot();
  w.setNetwork(false);
  const nav = await w.respond({ url: 'http://127.0.0.1:5212/#/c/5', method: 'GET', mode: 'navigate' });
  ok(nav && nav.url.endsWith('index.html'), 'an offline navigation must land on the cached shell');
  let answered = false;
  const third = await new Promise((done) => {
    w.handlers.fetch({
      request: { url: 'https://other.example/x.png', method: 'GET' },
      respondWith: () => { answered = true; },
      method: 'GET',
    });
    setTimeout(() => done({ answered }), 0);
  });
  eq(third.answered, false, 'the worker must not intercept cross-origin requests');
});

test('sw.js ships the promises a reviewer would otherwise take on faith', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  ok(/VERSION = 'staircase-v\d+'/.test(sw), 'the cache name must carry a version');
  ok(!/cache:\s*'force-cache'|respondWith\(caches\.match/.test(sw),
    'a cache-first worker pins js/css to the day it was installed: new HTML with old JS');
});

run();
