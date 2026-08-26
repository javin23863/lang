// Cache only the credential-free dashboard shell. Room bearer URLs, APIs,
// authentication, captions and any request carrying user state are always
// network-only and must never enter persistent browser Cache Storage.
const CACHE_NAME = 'lingua-relay-shell-v6';
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
  '/qr-encoder.js',
  '/icon.svg',
  '/manifest.webmanifest',
]);
const DASHBOARD_PATHS = new Set(['/', '/index.html']);
// app-runtime.js and qr.js both run inside browser/PWA room pages and carry
// transport recovery policy. Online clients must prefer deployed copies while
// retaining credential-free shell copies as offline dashboard fallbacks.
const NETWORK_FIRST_SHELL_PATHS = new Set(['/app-runtime.js', '/qr.js']);

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

function sameOriginGet(request, url) {
  return request.method === 'GET' && url?.origin === self.location.origin;
}

function cacheableShellRequest(request, url) {
  return sameOriginGet(request, url)
    && url.search === ''
    && !networkOnly(url.pathname)
    && SHELL_PATHS.has(url.pathname);
}

function canonicalShellRequest(path) {
  return new Request(new URL(path, self.location.origin).toString(), {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
  });
}

function shellRequests() {
  return [...SHELL_PATHS].map(canonicalShellRequest);
}

async function refreshShell() {
  const cache = await caches.open(CACHE_NAME);
  // addAll fetches the complete allowlisted generation before the dashboard is
  // released to load its subresources. Never persist a browser request whose
  // cookies, Authorization header or query parameters may carry user state.
  await cache.addAll(shellRequests());
  return cache;
}

async function cachedShell(path) {
  return caches.match(canonicalShellRequest(path));
}

async function networkFirstShell(url) {
  try {
    // Fetch the canonical credential-free URL, not the intercepted browser
    // request, so account cookies/headers never become part of shell delivery.
    return await fetch(canonicalShellRequest(url.pathname));
  } catch (error) {
    const cached = await cachedShell(url.pathname);
    if (cached) return cached;
    throw error;
  }
}

async function dashboardNavigation(request, url) {
  try {
    const cache = await refreshShell();
    if (url.search === '') {
      const fresh = await cache.match(canonicalShellRequest(url.pathname));
      if (fresh) return fresh;
    }
    // Query-bearing dashboard URLs (for example an OAuth failure marker) are
    // never cached, but the fixed shell was refreshed before this response is
    // released so its unversioned subresources cannot come from an older deploy.
    return await fetch(request, {cache: 'no-store'});
  } catch (_) {
    const cached = await cachedShell(url.pathname);
    if (cached) return cached;
    return fetch(request, {cache: 'no-store'});
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await refreshShell();
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

  if (url && sameOriginGet(request, url) && DASHBOARD_PATHS.has(url.pathname)) {
    event.respondWith(dashboardNavigation(request, url));
    return;
  }

  if (url && cacheableShellRequest(request, url)
      && NETWORK_FIRST_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(networkFirstShell(url));
    return;
  }

  if (!url || !cacheableShellRequest(request, url)) {
    event.respondWith(fetch(request, {cache: 'no-store'}));
    return;
  }

  event.respondWith((async () => {
    const canonical = canonicalShellRequest(url.pathname);
    const cached = await caches.match(canonical);
    if (cached) return cached;
    try {
      const cache = await refreshShell();
      const fresh = await cache.match(canonical);
      if (fresh) return fresh;
    } catch (_) { /* fall through to a one-off network response */ }
    return fetch(request, {cache: 'no-store'});
  })());
});
