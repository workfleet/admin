import { describe, it, expect, beforeEach } from 'vitest';
import {
  QUEUE_VERSION,
  collapse,
  enqueue,
  failedEntries,
  isCheckinPending,
  isTransientError,
  makeId,
  markFailed,
  pendingCheckinFor,
  pendingCount,
  readQueue,
  removeFromQueue,
  writeQueue,
} from '../lib/clockQueue';

// A queue holding somebody's pay. The failure that matters is not losing an
// entry - it is syncing one with the wrong time on it, because a missing
// shift gets queried and a plausible-looking wrong one does not.

// Minimal localStorage stand-in. Values are stored as strings, as the real
// one does, so a test cannot accidentally pass by round-tripping an object.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

let store;
beforeEach(() => { store = fakeStorage(); });

const checkIn = (over = {}) => ({
  id: 'in-1', kind: 'check_in', jobId: 'job-1',
  at: '2026-09-02T09:00:00.000Z', lat: 51.7, lng: -4.29, ...over,
});

describe('makeId', () => {
  it('gives a different id each time', () => {
    expect(makeId()).not.toBe(makeId());
  });
});

describe('enqueue and readQueue', () => {
  it('keeps the time it was given, not the time it was queued', () => {
    // The whole point. If this ever reads back as "now", a shift taken in a
    // basement at 9am syncs as having started whenever signal returned.
    enqueue(checkIn(), store);
    expect(readQueue(store)[0].at).toBe('2026-09-02T09:00:00.000Z');
  });

  it('survives a round trip through string storage', () => {
    enqueue(checkIn(), store);
    const fresh = fakeStorage(store._dump());
    expect(readQueue(fresh)).toHaveLength(1);
    expect(readQueue(fresh)[0].jobId).toBe('job-1');
  });

  it('keeps entries in the order they were taken', () => {
    enqueue(checkIn({ id: 'a' }), store);
    enqueue(checkIn({ id: 'b' }), store);
    expect(readQueue(store).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('drops entries written by a different version rather than guessing', () => {
    writeQueue([{ ...checkIn(), version: 99 }], store);
    expect(readQueue(store)).toEqual([]);
  });

  it('survives storage holding nonsense', () => {
    const broken = fakeStorage({ 'wf.clockQueue.v1': 'not json{' });
    expect(readQueue(broken)).toEqual([]);
  });

  it('survives storage holding the wrong shape', () => {
    const wrong = fakeStorage({ 'wf.clockQueue.v1': '{"nope":true}' });
    expect(readQueue(wrong)).toEqual([]);
  });

  it('stamps the version so a later build knows what it is reading', () => {
    enqueue(checkIn(), store);
    expect(readQueue(store)[0].version).toBe(QUEUE_VERSION);
  });
});

describe('removeFromQueue', () => {
  it('removes only the entry named', () => {
    enqueue(checkIn({ id: 'a' }), store);
    enqueue(checkIn({ id: 'b' }), store);
    removeFromQueue('a', store);
    expect(readQueue(store).map((e) => e.id)).toEqual(['b']);
  });

  it('does nothing for an id that is not there', () => {
    enqueue(checkIn({ id: 'a' }), store);
    removeFromQueue('nope', store);
    expect(pendingCount(store)).toBe(1);
  });
});

describe('collapse', () => {
  it('folds a check-out into its own unsent check-in', () => {
    // A whole shift worked with no signal. Sending these as two round trips
    // would fail if the check-out were replayed first, because the row it
    // names does not exist on the server yet.
    const entries = [
      { ...checkIn(), version: 1 },
      { id: 'out-1', kind: 'check_out', checkinId: 'in-1', at: '2026-09-02T11:00:00.000Z', version: 1 },
    ];
    const result = collapse(entries);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('check_in');
    expect(result[0].at).toBe('2026-09-02T09:00:00.000Z');
    expect(result[0].checkedOutAt).toBe('2026-09-02T11:00:00.000Z');
  });

  it('leaves a check-out alone when its check-in already reached the server', () => {
    // Checked in with signal, lost it before finishing. There is a real row
    // to update, so this stays an update.
    const entries = [
      { id: 'out-1', kind: 'check_out', checkinId: 'server-row', at: '2026-09-02T11:00:00.000Z', version: 1 },
    ];
    expect(collapse(entries)).toEqual(entries);
  });

  it('does not let one shift\'s check-out close another shift', () => {
    const entries = [
      { ...checkIn({ id: 'in-1' }), version: 1 },
      { ...checkIn({ id: 'in-2', jobId: 'job-2', at: '2026-09-02T12:00:00.000Z' }), version: 1 },
      { id: 'out-2', kind: 'check_out', checkinId: 'in-2', at: '2026-09-02T14:00:00.000Z', version: 1 },
    ];
    const result = collapse(entries);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.id === 'in-1').checkedOutAt).toBeUndefined();
    expect(result.find((e) => e.id === 'in-2').checkedOutAt).toBe('2026-09-02T14:00:00.000Z');
  });

  it('does not mutate what it was handed', () => {
    // The caller still has the original queue in storage and removes entries
    // from it by id afterwards; a collapse that edited them in place would
    // corrupt that.
    const original = { ...checkIn(), version: 1 };
    collapse([original, { id: 'o', kind: 'check_out', checkinId: 'in-1', at: 'x', version: 1 }]);
    expect(original.checkedOutAt).toBeUndefined();
  });

  it('passes an empty queue straight through', () => {
    expect(collapse([])).toEqual([]);
  });
});

describe('isTransientError', () => {
  // The line between 'keep it and try again' and 'tell the office'. Getting
  // it wrong one way retries a refusal for ever with a reassuring banner over
  // it; wrong the other way throws away a clock-in that only needed signal.
  it('treats a network failure as worth retrying', () => {
    // supabase-js reports a failed fetch with an empty code and status 0.
    expect(isTransientError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isTransientError({ message: 'x' })).toBe(true);
  });

  it('treats an expired session as worth retrying', () => {
    expect(isTransientError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
  });

  it('treats a policy refusal, a missing job and a bad value as final', () => {
    expect(isTransientError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isTransientError({ code: '23503', message: 'violates foreign key constraint' })).toBe(false);
    expect(isTransientError({ code: '23514', message: 'violates check constraint' })).toBe(false);
  });

  it('is false for no error at all', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('markFailed and failedEntries', () => {
  it('keeps a refused entry, with its time, and takes it out of the pending count', () => {
    // The tap time is still the truth about the shift; the office wants it.
    enqueue(checkIn(), store);
    markFailed('in-1', 'row-level security', store);
    expect(pendingCount(store)).toBe(0);
    expect(failedEntries(store)).toHaveLength(1);
    expect(failedEntries(store)[0].at).toBe('2026-09-02T09:00:00.000Z');
    expect(failedEntries(store)[0].failReason).toBe('row-level security');
  });

  it('marks only the entry named', () => {
    enqueue(checkIn({ id: 'a' }), store);
    enqueue(checkIn({ id: 'b', jobId: 'job-2' }), store);
    markFailed('a', 'x', store);
    expect(pendingCount(store)).toBe(1);
    expect(failedEntries(store).map((e) => e.id)).toEqual(['a']);
  });

  it('a failed entry can still be removed once the cleaner dismisses it', () => {
    enqueue(checkIn(), store);
    markFailed('in-1', 'x', store);
    removeFromQueue('in-1', store);
    expect(failedEntries(store)).toHaveLength(0);
  });
});

describe('pendingCheckinFor', () => {
  it('finds the check-in waiting for a job so a reload does not offer Check In again', () => {
    enqueue(checkIn(), store);
    const found = pendingCheckinFor('job-1', store);
    expect(found).toMatchObject({ id: 'in-1', at: '2026-09-02T09:00:00.000Z', checkedOutAt: null });
  });

  it('folds in a check-out queued against it', () => {
    enqueue(checkIn(), store);
    enqueue({ id: 'out-1', kind: 'check_out', checkinId: 'in-1', jobId: 'job-1', at: '2026-09-02T11:00:00.000Z' }, store);
    expect(pendingCheckinFor('job-1', store).checkedOutAt).toBe('2026-09-02T11:00:00.000Z');
  });

  it('is null for a job with nothing waiting, and ignores failed entries', () => {
    expect(pendingCheckinFor('job-9', store)).toBeNull();
    enqueue(checkIn(), store);
    markFailed('in-1', 'x', store);
    expect(pendingCheckinFor('job-1', store)).toBeNull();
  });
});

describe('isCheckinPending', () => {
  it('is true only while that check-in is still on the phone', () => {
    // The check-out path reads this to decide between updating a server row
    // and queueing: an update against a row that is not there yet matches
    // nothing and reports success, which is how check-outs got lost.
    enqueue(checkIn(), store);
    expect(isCheckinPending('in-1', store)).toBe(true);
    expect(isCheckinPending('server-row', store)).toBe(false);
    removeFromQueue('in-1', store);
    expect(isCheckinPending('in-1', store)).toBe(false);
  });
});
