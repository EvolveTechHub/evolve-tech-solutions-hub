// Evolve Technology Solutions Hub
// Disable the old offline page cache that could serve stale or failed navigation responses.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Intentionally do not intercept fetch requests.
// Pages and assets are served directly from the latest Cloudflare Pages deployment.
