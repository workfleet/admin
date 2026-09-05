// Job photos that survive having no signal.
//
// The clock queue (lib/clockQueue.js) fixed the half of this that costs money.
// This is the half that costs evidence: a photo is what settles a complaint
// about whether a room was done, and the moment it can be taken is the moment
// the cleaner is standing in front of the mess. If that upload fails they are
// already driving to the next job, and it is gone.
//
// IndexedDB rather than localStorage, which is the whole reason this was the
// harder half. localStorage stores strings, so a photo would have to be
// base64'd - a third bigger, synchronous on the main thread, and against a
// quota measured in single-digit megabytes that a couple of photos would
// exhaust. IndexedDB stores the Blob as a Blob, off-thread, with room to work
// in.
//
// The rule from the clock queue carries over: what is stored is the moment
// the photo was TAKEN. A photo is evidence about a time as much as a place,
// and one filed under when the signal came back is evidence about nothing.

const DB_NAME = 'wf-photo-queue';
const DB_VERSION = 1;
const STORE = 'pending';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // Photos are flushed oldest first, so a job's set arrives in the
        // order it was shot rather than scrambled.
        store.createIndex('takenAt', 'takenAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
  });
}

// Every call is wrapped: private browsing, a full disk and a browser with
// storage disabled all throw rather than returning empty, and none of them is
// a reason to stop somebody working.
async function withStore(mode, run) {
  let db;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.__value ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// The storage path is decided here, at the moment the photo is taken, not
// when it uploads. Same reasoning as the clock queue's client-generated ids:
// a replay writes to the same path and inserts the same row, so a flush that
// half-succeeded cannot produce the photo twice. It also keeps the name
// carrying the time it was taken, which is what somebody scrolling a job's
// photos is reading them by.
export function makePhotoPath(jobId, takenAt, originalName) {
  const stamp = new Date(takenAt).toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  // Extension goes first, then everything that is not plainly safe. Dots are
  // not on the allowed list: sanitising before stripping left "../" as ".."
  // in the key, which is a traversal-shaped string in a path even though the
  // slashes were already gone. Capped because some cameras name a file after
  // the entire album it came from.
  const safe = (originalName || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40) || 'photo';
  return `${jobId}/${stamp}-${suffix}-${safe}.jpg`;
}

export async function queuePhoto({ jobId, blob, path, takenAt, caption }) {
  const entry = { id: path, jobId, blob, path, takenAt, caption: caption || null, queuedAt: new Date().toISOString() };
  const ok = await withStore('readwrite', (store) => { store.put(entry); return true; });
  return ok ? entry : null;
}

export async function pendingPhotos(jobId) {
  const all = await withStore('readonly', (store) => {
    const out = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out.push(cursor.value);
      cursor.continue();
    };
    return { __value: out };
  });
  const list = all || [];
  const filtered = jobId ? list.filter((p) => p.jobId === jobId) : list;
  return filtered.sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
}

export async function removePhoto(id) {
  await withStore('readwrite', (store) => { store.delete(id); return true; });
}

export async function pendingPhotoCount() {
  return (await pendingPhotos()).length;
}
