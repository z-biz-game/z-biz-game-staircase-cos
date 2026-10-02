// Offline shell for the PWA install. The policy is network-first on purpose: this game's
// "最少" is computed on the device, so serving a stale bundle is worse than serving nothing.
// Successful same-origin GETs are recorded as they pass, which is what makes a second visit
// work with no network at all.
//
// Registered from js/pwa.js, which refuses file:// — a Service Worker cannot exist there, and
// swallowing that error here would just hide it.

const VERSION = 'staircase-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/game.css', './js/main.js'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Old versions of the cache go away on activation, so an upgrade never leaves two.
    const stale = (await caches.keys()).filter((name) => name !== VERSION);
    await Promise.all(stale.map((name) => caches.delete(name)));
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map((src) => cache.add(new Request(src, { cache: 'reload' })).catch(() => null)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 第三方（本仓一个都没有）不归我管
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('offline: 这个资源没在本地缓存过', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
