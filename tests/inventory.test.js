import { describe, it, expect } from 'vitest';
import { latestUpdate } from '../lib/inventory';

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
