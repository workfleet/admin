import { describe, it, expect } from 'vitest';
import { localDateString } from '../lib/localDate';
import { needsReorder } from '../lib/inventory';

// localDateString exists because toISOString().slice(0, 10) is wrong for this
// job: it names the UTC day, and under British Summer Time local midnight is
// 23:00 the day before in UTC. A job at 00:30 then files itself under
// yesterday - on the rota, on the hours page, and on any date-column filter.

describe('localDateString', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 7, 30, 14, 0, 0))).toBe('2026-08-30');
  });

  it('pads single-digit months and days', () => {
    expect(localDateString(new Date(2026, 0, 5, 9, 0, 0))).toBe('2026-01-05');
  });

  it('names the local day, not the UTC one, just after local midnight', () => {
    // The bug this function was written for. Constructed from local parts, so
    // it is 00:30 wherever the test runs - under BST that is 23:30 on the
    // 29th in UTC, and toISOString would answer 2026-08-29.
    const justAfterMidnight = new Date(2026, 7, 30, 0, 30, 0);
    expect(localDateString(justAfterMidnight)).toBe('2026-08-30');
  });

  it('names the local day just before local midnight too', () => {
    // The mirror case, which catches zones behind UTC.
    expect(localDateString(new Date(2026, 7, 30, 23, 30, 0))).toBe('2026-08-30');
  });

  it('handles the last day of a year', () => {
    expect(localDateString(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31');
  });
});

describe('needsReorder', () => {
  it('leaves a product sitting exactly on its threshold alone', () => {
    // The threshold is the level to keep in stock, so 1 of 1 is fine.
    expect(needsReorder({ stock_level: 1, reorder_threshold: 1 })).toBe(false);
    expect(needsReorder({ stock_level: 5, reorder_threshold: 3 })).toBe(false);
  });

  it('flags a product that has dropped below its threshold', () => {
    expect(needsReorder({ stock_level: 2, reorder_threshold: 3 })).toBe(true);
  });

  it('always flags a product that has run out, even with no threshold set', () => {
    expect(needsReorder({ stock_level: 0, reorder_threshold: 0 })).toBe(true);
  });

  it('treats missing or unreadable levels as zero rather than skipping the product', () => {
    expect(needsReorder({})).toBe(true);
    expect(needsReorder(null)).toBe(true);
    expect(needsReorder({ stock_level: null, reorder_threshold: 4 })).toBe(true);
  });

  it('reads numeric strings, which is how these arrive from Postgres', () => {
    expect(needsReorder({ stock_level: '2', reorder_threshold: '3' })).toBe(true);
    expect(needsReorder({ stock_level: '9', reorder_threshold: '3' })).toBe(false);
  });
});
