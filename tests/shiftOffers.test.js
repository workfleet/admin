import { describe, it, expect } from 'vitest';
import { liveOffers, splitOffers } from '../lib/shiftOffers';

// The home page counts these in a pill and the ShiftCoverCard lists them.
// One rule, tested once, so the two numbers cannot drift apart.

const NOW = new Date(2026, 8, 17, 10, 30);
const offer = (id, extra = {}) => ({ id, released_by: 'someone', jobs: { scheduled_at: '2026-09-18T09:00:00Z' }, expires_at: null, ...extra });

describe('liveOffers', () => {
  it('keeps open offers whose job still exists and has not expired', () => {
    const rows = [
      offer('ok'),
      offer('deleted-job', { jobs: null }),
      offer('expired', { expires_at: new Date(2026, 8, 17, 9).toISOString() }),
      offer('still-open', { expires_at: new Date(2026, 8, 17, 12).toISOString() }),
    ];
    expect(liveOffers(rows, NOW).map((o) => o.id)).toEqual(['ok', 'still-open']);
  });

  it('copes with nothing loaded', () => {
    expect(liveOffers(null, NOW)).toEqual([]);
  });
});

describe('splitOffers', () => {
  it('separates my own requests from the ones I could take, minus those I declined', () => {
    const live = [offer('mine', { released_by: 'me' }), offer('a'), offer('b')];
    const { mine, available } = splitOffers(live, ['b'], 'me');
    expect(mine.map((o) => o.id)).toEqual(['mine']);
    expect(available.map((o) => o.id)).toEqual(['a']);
  });

  it('copes with nothing declined', () => {
    expect(splitOffers([offer('a')], null, 'me').available).toHaveLength(1);
  });
});
