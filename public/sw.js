// Deliberately minimal: exists so Android's install-app prompt criteria
// are met (manifest + registered service worker), not to build an
// offline-first app. It only ever touches the couple of static assets
// listed below - HTML, JS bundles, and API calls all pass straight
// through untouched, so nobody ever gets stuck on stale cached app code.
const CACHE_NAME = 'workfleet-v1';
const STATIC_ASSETS = ['/icon.svg'];

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
