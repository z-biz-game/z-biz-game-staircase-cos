// PWA registration, kept in its own module so js/main.js stays about the game.
//
// Two environments have no business registering a worker: file:// (Electron, and anyone who
// double-clicks index.html) and plain HTTP on a non-localhost host, where the browser refuses
// anyway. Both return null instead of throwing an unhandled rejection into the console.

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  const here = typeof location !== 'undefined' ? location.protocol : 'none:';
  if (here !== 'http:' && here !== 'https:') return Promise.resolve(null);
  const scope = typeof location !== 'undefined' ? new URL('.', location.href).pathname : '/';
  return navigator.serviceWorker.register('sw.js', { scope })
    .then((reg) => ({ scope, installing: !!reg.installing, update: !!reg.waiting }))
    .catch(() => null);
}

// A manifest that 404s is an un-installable app with no symptom, so the link is checked here
// and the answer is handed to the test hook rather than kept in a comment.
export function checkManifest() {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const link = document.querySelector('link[rel="manifest"]');
  if (!link || !link.href) return Promise.resolve({ ok: false, reason: 'no-link' });
  if (typeof fetch !== 'function') return Promise.resolve({ ok: true, src: link.href, checked: false });
  return fetch(link.href, { method: 'GET' })
    .then((res) => (res.ok ? res.json() : { ok: false, reason: `http ${res.status}` }))
    .then((mf) => (mf && mf.icons
      ? { ok: true, name: mf.name, start_url: mf.start_url, display: mf.display, icons: mf.icons.length }
      : { ok: false, reason: 'manifest has no icons' }))
    .catch((err) => ({ ok: false, reason: String(err && err.name) }));
}
