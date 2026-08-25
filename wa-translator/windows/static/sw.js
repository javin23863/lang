// Cache only the credential-free dashboard shell. Room bearer URLs, APIs,
// authentication, captions and any request carrying user state are always
// network-only and must never enter persistent browser Cache Storage.
const CACHE_NAME = 'lingua-relay-shell-v3';
const CACHE_PREFIX = 'lingua-relay-shell-';
const SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/design-tokens.css',
  '/dashboard.css',
  '/app-runtime.js',
  '/dashboard-api.js',
  '/dashboard-account.js',
  '/dashboard-room-model.js',
  '/dashboard-room-controller.js',
  '/dashboard-share.js',
  '/dashboard-settings.js',
  '/dashboard-lifecycle.js',
  '/product-events.js',
  '/dashboard-onboarding.js',
  '/dashboard-product-events.js',
  '/qr.js',
  '/icon.svg',
  '/manifest.webmanifest',
]);

function requestUrl(request) {
  try { return new URL(request.url); }
  catch (_) { return null; }
}

function networkOnly(path) {
  return path === '/room.html'
    || path.startsWith('/room/')
    || path.startsWith('/ws/')
    || path.startsWith('/api/')
    || path.startsWith('/auth/')
    || path.startsWith('/static/i18n/');
}

function cacheableShellRequest(request, url) {
  return request.method === 'GET'
    && url?.origin === self.location.origin
    && url.search === ''
    && !networkOnly(url.pathname)
    && SHELL_PATHS.has(url.pathname);
}

async function updateShell(request) {
  const response = await fetch(request, {cache: 'no-store'});
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...SHELL_PATHS]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = requestUrl(request);
  if (!url || !cacheableShellRequest(request, url)) {
    event.respondWith(fetch(request, {cache: 'no-store'}));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const fresh = updateShell(request).catch(() => null);
    if (cached) {
      event.waitUntil(fresh);
      return cached;
    }
    const response = await fresh;
    if (response) return response;
    throw new Error('dashboard shell unavailable');
  })());
});
