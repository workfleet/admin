import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankCandidates, isGoodMatch, topReason, GOOD_MATCH_SCORE } from '../lib/coverRanking';

// This order decides who gets the first call when a shift is dropped at
// 6am. If it puts the wrong person top, the office stops reading it.

const base = {
  cleaner_id: 'x', full_name: 'Sam', eligible: true, ineligible_reason: null,
  visits_here: 0, last_visit_at: null, hours_this_week: 10, distance_km: null, distance_basis: null,
  completed_recent: 0, missed_recent: 0, rated_count: 0, avg_rating: null, declined: false,
};

describe('scoreCandidate', () => {
  it('rewards knowing the site most of all, capped after five visits', () => {
    const one = scoreCandidate({ ...base, visits_here: 1 });
    const five = scoreCandidate({ ...base, visits_here: 5 });
    const twenty = scoreCandidate({ ...base, visits_here: 20 });
    expect(one.reasons[0].text).toBe('Worked here once');
    expect(five.score).toBeGreaterThan(one.score);
    expect(twenty.score).toBe(five.score);
  });

  it('names the last visit when it is known', () => {
    const r = scoreCandidate({ ...base, visits_here: 3, last_visit_at: '2026-08-28T09:00:00Z' });
    expect(r.reasons[0].text).toBe('Worked here 3 times (last 28 Aug)');
  });

  it('scores distance in bands and says what it is measured from', () => {
    const near = scoreCandidate({ ...base, distance_km: 2.3, distance_basis: 'same_day_job' });
    const mid = scoreCandidate({ ...base, distance_km: 12, distance_basis: 'usual_area' });
    const far = scoreCandidate({ ...base, distance_km: 48, distance_basis: 'usual_area' });
    expect(near.reasons.find((r) => r.key === 'distance').text).toBe('2.3 km from their other job that day');
    expect(mid.reasons.find((r) => r.key === 'distance').text).toBe('12 km from their usual area');
    expect(near.score).toBeGreaterThan(mid.score);
    expect(mid.score).toBeGreaterThan(far.score);
    // A long way off still gets said, it just earns nothing.
    expect(far.reasons.find((r) => r.key === 'distance').points).toBe(0);
  });

  it('says nothing about distance when it is unknown', () => {
    expect(scoreCandidate(base).reasons.some((r) => r.key === 'distance')).toBe(false);
  });

  it('penalises a week that would go over the heavy limit with this shift on it', () => {
    // 44h already plus a 2h shift is 46h: over.
    const heavy = scoreCandidate({ ...base, hours_this_week: 44 }, { jobMinutes: 120 });
    expect(heavy.reasons.find((r) => r.key === 'hours').points).toBe(-20);
    // 44h plus a 30-minute shift stays under.
    const ok = scoreCandidate({ ...base, hours_this_week: 44 }, { jobMinutes: 30 });
    expect(ok.reasons.find((r) => r.key === 'hours').points).toBeGreaterThan(0);
  });

  it('prefers someone with room in their week', () => {
    const light = scoreCandidate({ ...base, hours_this_week: 8 });
    const fullish = scoreCandidate({ ...base, hours_this_week: 34 });
    expect(light.score).toBeGreaterThan(fullish.score);
    expect(light.reasons.find((r) => r.key === 'hours').text).toBe('8.0h that week - room for more');
  });

  it('only judges completion once there is enough history', () => {
    const thin = scoreCandidate({ ...base, completed_recent: 3, missed_recent: 1 });
    expect(thin.reasons.some((r) => r.key === 'completion')).toBe(false);
    const solid = scoreCandidate({ ...base, completed_recent: 19, missed_recent: 1 });
    expect(solid.reasons.find((r) => r.key === 'completion').text).toBe('95% of recent shifts completed');
    expect(solid.reasons.find((r) => r.key === 'completion').points).toBe(19);
  });

  it('only counts client ratings once there are a few', () => {
    expect(scoreCandidate({ ...base, rated_count: 2, avg_rating: 5 }).reasons.some((r) => r.key === 'rating')).toBe(false);
    const rated = scoreCandidate({ ...base, rated_count: 6, avg_rating: 4.5 });
    expect(rated.reasons.find((r) => r.key === 'rating')).toEqual({ key: 'rating', points: 9, text: 'Rated 4.5 by clients' });
  });

  it('mentions a decline without scoring it', () => {
    const r = scoreCandidate({ ...base, declined: true });
    expect(r.reasons.find((r2) => r2.key === 'declined').points).toBe(0);
  });

  it('lists reasons biggest first', () => {
    const r = scoreCandidate({ ...base, visits_here: 2, distance_km: 3, distance_basis: 'same_day_job', hours_this_week: 40 }, { jobMinutes: 480 });
    expect(r.reasons.map((x) => x.key)).toEqual(['visits', 'distance', 'hours']);
  });
});

describe('rankCandidates', () => {
  it('puts eligible people first, decliners last among them, then by score', () => {
    const list = rankCandidates([
      { ...base, cleaner_id: 'a', full_name: 'Alex', eligible: false, ineligible_reason: 'on approved time off', visits_here: 9 },
      { ...base, cleaner_id: 'b', full_name: 'Bea', visits_here: 4 },
      { ...base, cleaner_id: 'c', full_name: 'Cal', visits_here: 6, declined: true },
      { ...base, cleaner_id: 'd', full_name: 'Dee', visits_here: 1 },
    ]);
    expect(list.map((c) => c.full_name)).toEqual(['Bea', 'Dee', 'Cal', 'Alex']);
  });

  it('breaks ties by name so the order is stable', () => {
    const list = rankCandidates([
      { ...base, cleaner_id: 'z', full_name: 'Zoe' },
      { ...base, cleaner_id: 'a', full_name: 'Ana' },
    ]);
    expect(list.map((c) => c.full_name)).toEqual(['Ana', 'Zoe']);
  });

  it('copes with an empty or missing list', () => {
    expect(rankCandidates([])).toEqual([]);
    expect(rankCandidates(null)).toEqual([]);
  });
});

describe('isGoodMatch / topReason', () => {
  it('is a good match only when eligible, not declined, and scoring enough', () => {
    const [good] = rankCandidates([{ ...base, visits_here: 3 }]);
    expect(good.score).toBeGreaterThanOrEqual(GOOD_MATCH_SCORE);
    expect(isGoodMatch(good)).toBe(true);
    expect(isGoodMatch({ ...good, eligible: false })).toBe(false);
    expect(isGoodMatch({ ...good, declined: true })).toBe(false);
    const [plain] = rankCandidates([{ ...base, hours_this_week: 36 }]);
    expect(isGoodMatch(plain)).toBe(false);
  });

  it('gives the strongest positive reason for a push, or nothing', () => {
    const [good] = rankCandidates([{ ...base, visits_here: 3, distance_km: 1, distance_basis: 'same_day_job' }]);
    expect(topReason(good)).toBe('Worked here 3 times');
    const [far] = rankCandidates([{ ...base, hours_this_week: 44, distance_km: 60, distance_basis: 'usual_area' }], { jobMinutes: 120 });
    expect(topReason(far)).toBeNull();
  });
});
