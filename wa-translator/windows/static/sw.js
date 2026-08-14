// Room bearer URLs and captions must never enter a persistent browser cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request, {cache: 'no-store'}));
});
