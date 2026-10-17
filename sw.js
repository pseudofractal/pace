const CACHE_PREFIX = `pace-${self.registration.scope}-`;
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !ASSETS.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
        // Keep both entry URLs current, regardless of which one was visited.
        if (event.request.mode === 'navigate') {
          await Promise.all(['./', './index.html'].map(path =>
            cache.put(new URL(path, self.registration.scope).href, response.clone())));
        }
        return response;
      }
      return await cache.match(event.request) || response;
    } catch {
      const cached = await cache.match(event.request, {ignoreSearch: true});
      return cached || Response.error();
    }
  })());
});
