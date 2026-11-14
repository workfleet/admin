// Accident, incident and near-miss reports that survive having no signal.
//
// Accidents happen in basements, plant rooms and stairwells - exactly where
// a phone has no signal - and a report that fails to send at the scene is
// one nobody types out again later. So a report that cannot reach the
// server is kept on the phone, with its photos, and sent by
// IncidentQueueFlusher once there is signal again.
//
// Same approach as the job-photo queue (lib/photoQueue.js): IndexedDB, so a
// photo is kept as a Blob rather than a base64 string, and every id and
// photo path is decided when the report is written, not when it sends. A
// retry therefore re-uploads to the same paths and re-inserts the same row
// id, and a send that half-worked cannot produce the report twice.

import { isAlreadyUploaded, withTimeout } from './photoQueue';

const DB_NAME = 'wf-incident-outbox';
const DB_VERSION = 1;
const STORE = 'pending';
export const OUTBOX_CHANGED = 'wf-incident-outbox-changed';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
  });
}

// Private browsing, a full disk and storage switched off all throw; none of
// them is a reason to stop somebody reporting. null means "could not".
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

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED));
}

// entry: { id, userId, row, photos: [{ path, blob }], savedAt }
export async function saveToOutbox(entry) {
  const ok = await withStore('readwrite', (store) => { store.put(entry); return true; });
  if (ok) announce();
  return !!ok;
}

export async function outboxEntries(userId) {
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
  return (all || [])
    .filter((e) => !userId || e.userId === userId)
    .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
}

export async function removeFromOutbox(id) {
  await withStore('readwrite', (store) => { store.delete(id); return true; });
  announce();
}

// A failure that more signal would fix, as opposed to one the server meant
// (a policy refusal, a bad value) that no amount of retrying will change.
export function isNetworkError(error) {
  if (!error) return false;
  if (error.status === 0 || error.statusCode === 0) return true;
  if (typeof error.status === 'number' && error.status >= 500) return true;
  // A sign-in that lapsed while the phone was out of signal refreshes once
  // it is back, so that is worth waiting for too.
  if (error.status === 401 || String(error.statusCode) === '401' || error.code === 'PGRST301') return true;
  return /failed to fetch|networkerror|network request failed|load failed|timed out|fetch failed|aborted|jwt expired/i
    .test(`${error.message || ''} ${error.details || ''}`);
}

// Sends one report: photos first, then the row. Returns
//   { ok: true, data }         sent (or found already sent)
//   { ok: false, retry: true } no signal - keep it and try later
//   { ok: false, retry: false, error } the server refused it
// columns: what to select back for the page to show.
export async function sendReport(supabase, entry, columns) {
  for (const photo of entry.photos || []) {
    const { error } = await withTimeout(
      supabase.storage.from('incident-photos').upload(photo.path, photo.blob, { contentType: 'image/jpeg' }),
    );
    if (error && !isAlreadyUploaded(error)) {
      return isNetworkError(error) ? { ok: false, retry: true } : { ok: false, retry: false, error };
    }
  }

  const { data, error } = await withTimeout(
    supabase.from('incident_reports').insert(entry.row).select(columns).single(),
  );
  if (!error && data) return { ok: true, data };

  // Sent before, and the answer was lost on the way back: the row is
  // there under the id this report was given when it was written.
  if (error?.code === '23505') {
    const { data: existing } = await withTimeout(
      supabase.from('incident_reports').select(columns).eq('id', entry.row.id).maybeSingle(),
    );
    return { ok: true, data: existing || { ...entry.row, status: 'open' } };
  }
  if (!error || isNetworkError(error)) return { ok: false, retry: true };
  return { ok: false, retry: false, error };
}
