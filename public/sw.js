// Makora Service Worker - Cache-first for static assets
const CACHE_NAME = 'makora-v2';

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/icons/icon-192.png',
        '/icons/icon-512.png'
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Check if request is for static assets (JS/CSS bundles)
function isStaticAsset(url) {
  return url.search.includes('meteor_js_resource=true') ||
         url.search.includes('meteor_css_resource=true') ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.css');
}

// Fetch event
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip WebSocket and DDP connections
  const url = new URL(event.request.url);
  if (url.pathname.includes('/sockjs/') ||
      url.pathname.includes('/websocket')) {
    return;
  }

  // Skip API calls (let them go to network)
  if (url.pathname.startsWith('/api/') ||
      url.pathname.includes('__meteor__')) {
    return;
  }

  // Static assets: Cache-first (stale-while-revalidate)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);

        // Fetch in background to update cache
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => null);

        // Return cached immediately, or wait for network
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Other requests: Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
