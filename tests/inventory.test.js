import { describe, it, expect } from 'vitest';
import { latestUpdate, stockLastUpdatedLine, loadProducts, PRODUCT_AUDIT_FIELDS } from '../lib/inventory';

describe('latestUpdate', () => {
  it('returns null when no product carries a timestamp', () => {
    expect(latestUpdate([])).toBeNull();
    expect(latestUpdate(undefined)).toBeNull();
    expect(latestUpdate([{ id: 'a', name: 'Bleach' }])).toBeNull();
  });

  it('picks the newest change whatever order the list is in', () => {
    const products = [
      { id: 'a', updated_at: '2026-09-01T09:00:00Z', updater: { full_name: 'Amira' } },
      { id: 'c', updated_at: '2026-09-17T15:02:00Z', updater: { full_name: 'Jess' } },
      { id: 'b', updated_at: '2026-09-10T12:30:00Z', updater: { full_name: 'Ben' } },
    ];
    expect(latestUpdate(products).id).toBe('c');
    expect(latestUpdate(products).updater.full_name).toBe('Jess');
  });

  it('ignores rows without a timestamp rather than treating them as newest', () => {
    const products = [
      { id: 'a', updated_at: '2026-09-01T09:00:00Z' },
      { id: 'b' },
    ];
    expect(latestUpdate(products).id).toBe('a');
  });
});

describe('stockLastUpdatedLine', () => {
  it('is null when nothing has ever been counted', () => {
    expect(stockLastUpdatedLine([])).toBeNull();
    expect(stockLastUpdatedLine(null)).toBeNull();
  });

  it('names the newest count in UK time with the year spelt out', () => {
    const products = [
      { updated_at: '2026-09-01T09:00:00Z', updater: { full_name: 'Amira' } },
      { updated_at: '2026-09-17T15:02:00Z', updater: { full_name: 'Jess Kidwell' } },
    ];
    // 15:02 UTC is 16:02 in London during British Summer Time - a document
    // that says 15:02 would disagree with the clock on the wall.
    expect(stockLastUpdatedLine(products)).toMatch(/^Stock last updated 17 Sept? 2026, 16:02 by Jess Kidwell$/);
  });

  it('still gives the time when the updater is unknown', () => {
    expect(stockLastUpdatedLine([{ updated_at: '2026-01-05T08:30:00Z' }])).toMatch(/^Stock last updated 5 Jan 2026, 08:30$/);
  });
});

describe('loadProducts', () => {
  const fakeClient = (responses) => {
    const calls = [];
    return {
      calls,
      from: () => ({
        select: (fields) => ({
          order: async () => {
            calls.push(fields);
            return responses.shift();
          },
        }),
      }),
    };
  };

  it('returns the audited rows when the database has the columns', async () => {
    const rows = [{ id: 'a', updated_at: '2026-09-17T15:02:00Z' }];
    const client = fakeClient([{ data: rows, error: null }]);
    const result = await loadProducts(client, 'id, name');
    expect(result).toEqual({ data: rows, error: null, auditAvailable: true });
    expect(client.calls).toEqual(['id, name, ' + PRODUCT_AUDIT_FIELDS]);
  });

  it('falls back to the bare columns when the migration has not been applied', async () => {
    const rows = [{ id: 'a', name: 'Bleach' }];
    const client = fakeClient([
      { data: null, error: { code: 'PGRST200', message: 'Could not find a relationship' } },
      { data: rows, error: null },
    ]);
    const result = await loadProducts(client, 'id, name');
    expect(result).toEqual({ data: rows, error: null, auditAvailable: false });
    expect(client.calls).toEqual(['id, name, ' + PRODUCT_AUDIT_FIELDS, 'id, name']);
  });

  it('treats an unknown column the same way', async () => {
    const client = fakeClient([
      { data: null, error: { code: '42703', message: 'column products.updated_at does not exist' } },
      { data: [], error: null },
    ]);
    expect((await loadProducts(client, 'id')).auditAvailable).toBe(false);
  });

  it('reports any other error instead of hiding it behind an empty list', async () => {
    const error = { code: '42501', message: 'permission denied' };
    const client = fakeClient([{ data: null, error }]);
    const result = await loadProducts(client, 'id');
    expect(result.error).toBe(error);
    expect(client.calls).toHaveLength(1);
  });
});
