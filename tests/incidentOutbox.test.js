import { describe, it, expect } from 'vitest';
import { isNetworkError, sendReport } from '../lib/incidentOutbox';

// A stand-in for supabase-js with just the calls sendReport makes, each
// answering whatever the test says.
function fakeSupabase({ upload = [], insert, select } = {}) {
  const calls = { uploads: [], inserts: 0, selects: 0 };
  let u = 0;
  const builder = {
    insert(row) { calls.inserts += 1; calls.row = row; return builder; },
    select() { return builder; },
    eq() { return builder; },
    single: async () => insert,
    maybeSingle: async () => { calls.selects += 1; return select || { data: null }; },
  };
  return {
    calls,
    storage: { from: () => ({ upload: async (path) => { calls.uploads.push(path); return upload[u++] || { error: null }; } }) },
    from: () => builder,
  };
}

const entry = {
  id: 'r1',
  userId: 'u1',
  row: { id: 'r1', kind: 'near_miss', reported_by: 'u1' },
  photos: [{ path: 'u1/a.jpg', blob: {} }, { path: 'u1/b.jpg', blob: {} }],
  savedAt: '2026-11-13T10:00:00Z',
};

describe('isNetworkError', () => {
  it('treats no signal, timeouts, server errors and a lapsed sign-in as worth retrying', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true); // Safari
    expect(isNetworkError(new Error('timed out'))).toBe(true);
    expect(isNetworkError({ status: 503, message: 'Service Unavailable' })).toBe(true);
    expect(isNetworkError({ status: 401, message: 'JWT expired' })).toBe(true);
  });

  it('does not retry a refusal the server meant', () => {
    expect(isNetworkError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isNetworkError({ code: '23514', message: 'violates check constraint' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('sendReport', () => {
  it('uploads the photos, then inserts the row under the id it was written with', async () => {
    const sb = fakeSupabase({ insert: { data: { id: 'r1' }, error: null } });
    expect(await sendReport(sb, entry, 'id')).toEqual({ ok: true, data: { id: 'r1' } });
    expect(sb.calls.uploads).toEqual(['u1/a.jpg', 'u1/b.jpg']);
    expect(sb.calls.row.id).toBe('r1');
  });

  it('keeps going when a photo is already there from an earlier try', async () => {
    const sb = fakeSupabase({ upload: [{ error: { statusCode: '409', message: 'The resource already exists' } }], insert: { data: { id: 'r1' }, error: null } });
    expect((await sendReport(sb, entry, 'id')).ok).toBe(true);
    expect(sb.calls.inserts).toBe(1);
  });

  it('stops and asks to retry when there is no signal, before inserting anything', async () => {
    const sb = fakeSupabase({ upload: [{ error: { message: 'Failed to fetch' } }] });
    expect(await sendReport(sb, entry, 'id')).toEqual({ ok: false, retry: true });
    expect(sb.calls.inserts).toBe(0);
  });

  it('counts a report that already arrived as sent, not as a failure', async () => {
    const sb = fakeSupabase({
      insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      select: { data: { id: 'r1', status: 'open' } },
    });
    expect(await sendReport(sb, entry, 'id')).toEqual({ ok: true, data: { id: 'r1', status: 'open' } });
    expect(sb.calls.selects).toBe(1);
  });

  it('reports a refusal so it is kept and the office is rung, not retried for ever', async () => {
    const refusal = { code: '42501', message: 'new row violates row-level security policy' };
    const sb = fakeSupabase({ insert: { data: null, error: refusal } });
    expect(await sendReport(sb, entry, 'id')).toEqual({ ok: false, retry: false, error: refusal });
  });

  it('retries when the insert itself loses signal', async () => {
    const sb = fakeSupabase({ insert: { data: null, error: { message: 'Failed to fetch' } } });
    expect(await sendReport(sb, { ...entry, photos: [] }, 'id')).toEqual({ ok: false, retry: true });
  });
});
