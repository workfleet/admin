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

// Whether a failed write is worth trying again. A network failure comes
// back from supabase-js with no code at all (status 0); anything with a
// code is an answer from the server. 23505 is a primary-key collision,
// which for a replayed check-in means the original did land - handled by
// the caller as success, not here. An expired session (PGRST301) clears up
// on the next refresh. Everything else with a code - a policy refusal
// because the job was taken off them or the account deactivated, a
// foreign key to a job that has since been deleted, a check constraint -
// will fail the same way every time, and retrying it for ever meant a
// banner saying 'you don't need to do anything' over a clock-in that was
// never going to send, with every later clock-in stuck behind it.
export function isTransientError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '') return true;
  if (code === 'PGRST301') return true;
  return false;
}

// A permanent failure keeps its entry, marked, rather than being dropped:
// the time they tapped is still the truth about the shift and the office
// will want it. It just stops being retried, and the banner changes from
// reassurance to 'tell the office'. Dismissing it is the cleaner's call.
export function markFailed(id, reason, storage) {
  const next = readQueue(storage).map((e) => (
    e.id === id ? { ...e, failedAt: new Date().toISOString(), failReason: String(reason || '').slice(0, 200) } : e
  ));
  writeQueue(next, storage);
}

export function failedEntries(storage) {
  return readQueue(storage).filter((e) => e.failedAt);
}

// The check-in still waiting to send for a job, with any check-out that
// has been queued against it folded in - what the job page shows as the
// current clock state when the server has no row yet. Without this a
// reload after an offline check-in showed the Check In button again, and
// a second tap queued a second shift.
export function pendingCheckinFor(jobId, storage) {
  const queue = readQueue(storage).filter((e) => !e.failedAt);
  const entry = queue.find((e) => e.kind === 'check_in' && e.jobId === jobId);
  if (!entry) return null;
  const out = queue.find((e) => e.kind === 'check_out' && e.checkinId === entry.id);
  return { id: entry.id, jobId, at: entry.at, lat: entry.lat ?? null, lng: entry.lng ?? null, checkedOutAt: out ? out.at : null };
}

// True while the check-in row this id names is still on the phone rather
// than the server - a check-out for it has nothing to update yet.
export function isCheckinPending(checkinId, storage) {
  return readQueue(storage).some((e) => e.kind === 'check_in' && e.id === checkinId && !e.failedAt);
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

// How many clock events are still waiting to send, for the banner that
// tells a cleaner their tap was kept rather than lost. Failed ones are
// counted separately (failedEntries) because they need a different message.
export function pendingCount(storage) {
  return readQueue(storage).filter((e) => !e.failedAt).length;
}
