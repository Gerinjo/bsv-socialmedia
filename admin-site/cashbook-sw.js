// No caching of balances, identities, photographs, signatures or API responses.
const CACHE = 'bsv-cashbook-public-v5';
const OFFLINE = '/kassenbuch/offline';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bsv-cashbook-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
