// Deliberately minimal: exists so Android's install-app prompt criteria
// are met (manifest + registered service worker), not to build an
// offline-first app. It only ever touches the couple of static assets
// listed below - HTML, JS bundles, and API calls all pass straight
// through untouched, so nobody ever gets stuck on stale cached app code.
// Bumped again for Route W - the cached icon is coral on graphite now.
const CACHE_NAME = 'workfleet-v3';
// Not '/icon.svg' - Next reserves that path for its own metadata route
// and answers it with a 500, which made cache.addAll() reject and the
// whole service-worker install fail.
const STATIC_ASSETS = ['/brand-mark.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// Web Push - currently only used for emergency alerts (see lib/webPush.js
// on the server side). The payload is whatever JSON.stringify(payload)
// was passed to webpush.sendNotification().
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'WorkFleet', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      requireInteraction: true,
      data: { url: data.url || '/admin' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
