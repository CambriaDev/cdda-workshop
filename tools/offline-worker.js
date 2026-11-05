/* Build-time placeholders are replaced by the Vite release plugin. */
const RELEASE = __RELEASE__;
const ASSETS = __ASSETS__;
const CACHE = 'cdda-release-' + RELEASE;
const READY = new URL('__offline_ready__', self.registration.scope).href;
let preparing;
self.addEventListener('install', () => { /* Never claim readiness before full verification. */ });
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
async function status() {
  const cache = await caches.open(CACHE);
  if (!(await cache.match(READY))) return false;
  for (const asset of ASSETS) if (!(await cache.match(new URL(asset.path, self.registration.scope).href))) return false;
  return true;
}
async function prepare(send) {
  if (await status()) { send({ type: 'ready', release: RELEASE }); return; }
  const cache = await caches.open(CACHE);
  let done = 0, bytes = 0, cursor = 0;
  const totalBytes = ASSETS.reduce((n, a) => n + a.size, 0);
  await cache.delete(READY);
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < ASSETS.length) {
      const asset = ASSETS[cursor++];
      const url = new URL(asset.path, self.registration.scope).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + asset.path);
      const data = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.hash) throw new Error('Integrity mismatch: ' + asset.path);
      // Fetch bodies are decoded; do not retain transfer encoding/length or Vary
      // metadata from the preparation request (module loads use different modes).
      const headers = new Headers(response.headers);
      headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
      await cache.put(url, new Response(data, { headers, status: 200 }));
      done++; bytes += data.byteLength;
      send({ type: 'progress', done, total: ASSETS.length, bytes, totalBytes });
    }
  }));
  await cache.put(READY, new Response(RELEASE));
  await self.skipWaiting();
  await self.clients.claim();
  // The previous complete release survives all failed updates.
  for (const key of await caches.keys()) if (key.startsWith('cdda-release-') && key !== CACHE) await caches.delete(key);
  send({ type: 'ready', release: RELEASE });
}
self.addEventListener('message', event => {
  const send = data => { if (event.ports[0]) event.ports[0].postMessage(data); else event.source?.postMessage(data); };
  if (event.data?.type === 'status') event.waitUntil(status().then(ready => send({ type: ready ? 'ready' : 'missing', release: RELEASE })));
  if (event.data?.type === 'prepare') {
    if (preparing) { send({ type: 'error', message: 'Offline preparation is already running.' }); return; }
    preparing = prepare(send).catch(error => send({ type: 'error', message: String(error) })).finally(() => { preparing = undefined; });
    event.waitUntil(preparing);
  }
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const keys = [CACHE, ...(await caches.keys()).filter(key => key.startsWith('cdda-release-') && key !== CACHE).reverse()];
    for (const key of keys) {
      const cache = await caches.open(key);
      if (!(await cache.match(READY))) continue;
      const hit = await cache.match(event.request);
      if (hit) return hit;
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('index.html', self.registration.scope).href);
        if (shell) return shell;
      }
    }
    return fetch(event.request);
  })());
});
