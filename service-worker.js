const CACHE = 'form5-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);

  // Always try network first for POST submissions (we let client handle queue)
  if (ev.request.method === 'GET') {
    ev.respondWith(
      caches.match(ev.request).then(cached => {
        if (cached) return cached;
        return fetch(ev.request).then(res => {
          // Cache new GETs
          return caches.open(CACHE).then(cache => {
            cache.put(ev.request, res.clone());
            return res;
          });
        }).catch(() => {
          // Fallback to cached root for navigation
          if (ev.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
    );
  }
});
