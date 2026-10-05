// The last good copy of a job page, so it still opens with no signal.
//
// The service worker (public/sw.js) caches the page shell, but the job itself
// comes from Supabase, so a cleaner who opened the job in a basement got "No
// signal - this job couldn't be loaded" and no photo button. Android makes it
// worse: opening the camera can push the browser out of memory, and the tab
// reloads when the camera closes - offline, that reload used to lose the job.
//
// So every successful load keeps a copy here, and an offline load shows it.
// It is only ever a fallback: online, the page always reads the server.
//
// Kept to what the page needs to be worked from - the job, its tasks and
// checklist, and this cleaner's check-in - and only for the cleaner who saved
// it. Copies older than MAX_AGE_MS are ignored and pruned, and only the most
// recent MAX_JOBS are kept, so access notes do not pile up on a phone.

const PREFIX = 'wf.job.v1.';
const MAX_JOBS = 15;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function safeStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function snapshotKeys(store) {
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function read(store, key) {
  try {
    return JSON.parse(store.getItem(key) || 'null');
  } catch {
    return null;
  }
}

export function saveJobSnapshot(jobId, userId, data, { storage, now = Date.now() } = {}) {
  const store = safeStorage(storage);
  if (!store || !jobId || !userId) return;
  try {
    store.setItem(PREFIX + jobId, JSON.stringify({ ...data, userId, savedAt: now }));
  } catch {
    // Storage full or blocked. Offline viewing is a convenience.
  }
  pruneJobSnapshots({ storage: store, now });
}

export function loadJobSnapshot(jobId, userId, { storage, now = Date.now() } = {}) {
  const store = safeStorage(storage);
  if (!store || !jobId || !userId) return null;
  const snap = read(store, PREFIX + jobId);
  if (!snap || snap.userId !== userId) return null;
  if (!(now - snap.savedAt < MAX_AGE_MS)) return null;
  return snap;
}

export function pruneJobSnapshots({ storage, now = Date.now() } = {}) {
  const store = safeStorage(storage);
  if (!store) return;
  const entries = snapshotKeys(store).map((key) => ({ key, savedAt: read(store, key)?.savedAt || 0 }));
  entries.sort((a, b) => b.savedAt - a.savedAt);
  entries.forEach((entry, index) => {
    if (index >= MAX_JOBS || !(now - entry.savedAt < MAX_AGE_MS)) {
      try { store.removeItem(entry.key); } catch { /* nothing to do */ }
    }
  });
}

// The service worker caches a page only when the browser navigates to it,
// and cleaners reach a job by tapping through the rota - a client-side
// navigation that never passes through it. So the page that the saved copy
// above needs was missing exactly when it mattered: Android reloading the
// tab after the camera closes, with no signal, got the bare offline page.
// Fetching the page's own URL into the service worker's runtime cache fixes
// that. Must match RUNTIME in public/sw.js.
const SW_RUNTIME_CACHE = 'workfleet-runtime-v1';

export async function warmPageShell(path) {
  try {
    if (typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return;
    // Re-fetched every time rather than kept once: a shell from an old
    // deploy points at build chunks the next one may not have cached.
    const cache = await caches.open(SW_RUNTIME_CACHE);
    await cache.add(path);
  } catch {
    // Offline, quota, or no service worker. Nothing to do.
  }
}

export function clearJobSnapshots(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  for (const key of snapshotKeys(store)) {
    try { store.removeItem(key); } catch { /* nothing to do */ }
  }
}
