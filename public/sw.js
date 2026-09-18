// The cleaner app has to open with no signal. A cleaner clocks in and out
// from inside a basement or a rural property where the connection drops, and
// the whole offline-queue mechanism (lib/clockQueue.js) is useless if the app
// itself will not start - a cold launch with no signal used to be a browser
// error page, so the queued check-in feature was unreachable exactly when it
// was for.
//
// So this caches the app shell as it is visited online and serves it back
// offline. The pages are all client components ('use client'): the HTML is a
// shell with no personal data in it, and every figure is fetched client-side
// once the app is running, so caching the HTML leaks nothing.
//
// What is NOT cached, ever: Supabase and any other API call. Those go to the
// network only, so nobody is served a stale clock state or a cached balance.
// A queued write waits in localStorage/IndexedDB, not here.
//
// Bump PRECACHE when STATIC_ASSETS changes and RUNTIME when the runtime rules
// below change, so old caches are cleared on activate.
const PRECACHE = 'workfleet-precache-v4';
const RUNTIME = 'workfleet-runtime-v1';

// Not '/icon.svg' - Next reserves that path for its own metadata route and
// answers it with a 500, which made cache.addAll() reject and the whole
// service-worker install fail.
const STATIC_ASSETS = ['/brand-mark.svg', '/manifest.webmanifest'];

// The barest offline page, used only when someone cold-launches a URL they
// have never opened online so there is no cached shell to give them. Enough
// to explain why, not a browser error.
const OFFLINE_FALLBACK = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline</title><style>
:root{color-scheme:light}body{margin:0;min-height:100vh;display:flex;align-items:center;
justify-content:center;background:#202327;color:#fff;font:16px/1.5 system-ui,sans-serif;
padding:24px;text-align:center}.box{max-width:20rem}h1{font-size:19px;margin:0 0 8px}
p{margin:0 0 20px;color:#c9cdd3;font-size:14px}button{font:600 15px system-ui;background:#FF6B5B;
color:#202327;border:0;border-radius:10px;padding:12px 20px;cursor:pointer}
</style></head><body><div class="box"><h1>No signal</h1>
<p>You're offline and this screen hasn't been opened here before. Any clock-in you've
already saved is safe on your phone and will send itself when you're back in range.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // A failed precache must not fail the whole install (a single asset 404 on a
  // bad deploy would otherwise leave the app with no service worker at all).
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      Promise.all(STATIC_ASSETS.map((asset) => cache.add(asset).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([PRECACHE, RUNTIME]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// True for the app's own pages, false for Supabase/API/cross-origin, which
// must always hit the network and never be served from a cache.
function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  // Anything that looks like data rather than app code. /rest, /auth and
  // /storage are Supabase; /api is this app's own routes; /monitoring is the
  // Sentry tunnel.
  if (/^\/(api|rest|auth|storage|realtime|functions|monitoring)(\/|$)/.test(url.pathname)) return false;
  return true;
}

function isStaticAsset(url) {
  return url.origin === self.location.origin && (
    url.pathname.startsWith('/_next/static/') ||
    // Deliberately not .json: a stray dynamic .json served from this origin
    // must not be frozen in the cache. Build code and media only.
    /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // A page the cleaner navigates to: network first so an online launch is
  // always fresh (and never a shell wired to chunks a deploy has since
  // replaced), cache the copy, fall back to that copy offline, and to the
  // plain offline page only when there is nothing cached for this URL.
  if (request.mode === 'navigate' && isAppShell(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          return new Response(OFFLINE_FALLBACK, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })
    );
    return;
  }

  // Build assets are content-hashed and immutable, so cache-first is safe and
  // makes the shell reload instantly. A miss falls through to the network and
  // is cached for next time.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else - every Supabase and API call - is left to go straight to
  // the network untouched.
});

// Web Push. Falls back to the cleaner and office bells rather than always the
// admin one, and only an emergency alert demands interaction.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = {}; }

  const isEmergency = data.tag === 'emergency-alert';
  event.waitUntil(
    self.registration.showNotification(data.title || 'WorkFleet', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      requireInteraction: isEmergency,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

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
