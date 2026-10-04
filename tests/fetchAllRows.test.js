import { describe, it, expect } from 'vitest';
import { fetchAllRows } from '../lib/fetchAllRows';

// PostgREST stops at 1000 rows and says nothing. These are the guarantees
// that make fetchAllRows safe to put behind a payroll total: every row comes
// back exactly once, and a failure never passes for a short list.

// A stand-in for a Supabase query: .range(from, to) resolves to that slice
// of `rows`, or to `error` on the page that starts at `failFrom`.
function fakeTable(rows, { failFrom = null } = {}) {
  const calls = [];
  const makeQuery = () => ({
    range: (from, to) => {
      calls.push([from, to]);
      if (failFrom !== null && from === failFrom) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  });
  return { makeQuery, calls };
}

const numbered = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('fetchAllRows', () => {
  it('returns every row past the first page', () => {
    // 2,500 rows is what a summed history looks like once a table has
    // outgrown one request - the case the helper exists for.
    const { makeQuery, calls } = fakeTable(numbered(2500));
    return fetchAllRows(makeQuery).then(({ data, error }) => {
      expect(error).toBeNull();
      expect(data).toHaveLength(2500);
      expect(new Set(data.map((r) => r.id)).size).toBe(2500);
      expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });
  });

  it('asks once more when the last page is exactly full', async () => {
    // A full page can't tell "that was all" from "there's more", so it has
    // to ask again and get an empty page back.
    const { makeQuery, calls } = fakeTable(numbered(2000));
    const { data } = await fetchAllRows(makeQuery);
    expect(data).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });

  it('makes one request for a short table', async () => {
    const { makeQuery, calls } = fakeTable(numbered(12));
    const { data } = await fetchAllRows(makeQuery);
    expect(data).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });

  it('returns no data at all when a later page fails', async () => {
    // Half a payroll is worse than an error: the caller must not be able to
    // mistake the first page for the whole set.
    const { makeQuery } = fakeTable(numbered(2500), { failFrom: 1000 });
    const { data, error } = await fetchAllRows(makeQuery);
    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('builds a fresh query for every page', async () => {
    // A Supabase builder can only be awaited once.
    let built = 0;
    const rows = numbered(1500);
    const makeQuery = () => {
      built += 1;
      return { range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }) };
    };
    await fetchAllRows(makeQuery);
    expect(built).toBe(2);
  });
});
