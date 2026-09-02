// Clock events that survive having no signal.
//
// GPS works in a basement; Supabase does not. Until now a check-in with no
// signal failed, and until the commit before this one it failed silently -
// which on site is indistinguishable from success, so the cleaner starts work
// believing they are clocked in and the shift is marked missed hours later.
// That is the likeliest single cause of the missed clock-ins the claim flow
// exists to mop up, so it is worth fixing at the source rather than only
// providing a way to apologise for it afterwards.
//
// The rule that makes this safe: the queue records THE MOMENT THEY TAPPED,
// and that is what is written when it syncs. A queue that stamped the sync
// time would turn a missing shift into a wrong one, which is worse - a gap
// gets noticed and queried, a plausible-looking wrong number does not.
//
// localStorage rather than IndexedDB on purpose. These are a few hundred
// bytes each, they must survive a reload and a force-quit, and they must be
// readable synchronously while deciding what to render. Photos are the case
// that needs IndexedDB, and they are not in scope here.

const STORAGE_KEY = 'wf.clockQueue.v1';

// Bumped whenever an entry shape changes. A queue written by an older build
// is dropped rather than guessed at: a mis-parsed clock event is a wrong
// timesheet, and there will only ever be a handful of them pending.
export const QUEUE_VERSION = 1;

export function readQueue(storage) {
  const store = storage || safeStorage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && e.version === QUEUE_VERSION && e.id && e.kind && e.at);
  } catch {
    return [];
  }
}

export function writeQueue(entries, storage) {
  const store = storage || safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked (private mode). Nothing useful to do: the
    // caller has already been told the write did not reach the server.
  }
}

// Private browsing and locked-down browsers make localStorage throw on
// access rather than return null, so every use goes through this.
function safeStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// The id is generated here, at tap time, not by the database. Two reasons,
// both load-bearing:
//
//   - A cleaner who checks in offline has to be able to check OUT offline
//     too, and a check-out has to name the row it closes. Without an id
//     decided up front there is nothing to point at.
//   - Replaying a queued check-in is safe. If the original insert actually
//     reached the server and only the response was lost, the replay collides
//     on the primary key and is discarded rather than writing the shift
//     twice. See flushEntry.
export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Older Safari. Only needs to be unique, not unguessable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function enqueue(entry, storage) {
  const queued = { ...entry, version: QUEUE_VERSION, queuedAt: new Date().toISOString() };
  const next = [...readQueue(storage), queued];
  writeQueue(next, storage);
  return queued;
}

export function removeFromQueue(id, storage) {
  writeQueue(readQueue(storage).filter((e) => e.id !== id), storage);
}

// A check-out for a shift still sitting in the queue never needs to reach the
// server as two round trips - the check-in has not landed yet, so the pair
// can be collapsed into one insert carrying both timestamps. Also the only
// way a fully-offline shift can sync at all if the check-in is replayed after
// the check-out, which ordering alone does not guarantee.
export function collapse(entries) {
  const byCheckin = new Map();
  const result = [];

  for (const entry of entries) {
    if (entry.kind === 'check_in') {
      byCheckin.set(entry.id, { ...entry });
      result.push(byCheckin.get(entry.id));
      continue;
    }
    const pendingIn = byCheckin.get(entry.checkinId);
    if (pendingIn) {
      pendingIn.checkedOutAt = entry.at;
      // The check-out entry itself is dropped: it has been folded into the
      // insert above, and replaying it afterwards would be a no-op update.
      continue;
    }
    result.push({ ...entry });
  }

  return result;
}

// How many clock events are still waiting, for the banner that tells a
// cleaner their tap was kept rather than lost.
export function pendingCount(storage) {
  return readQueue(storage).length;
}
