import { describe, it, expect } from 'vitest';
import { claimFor, describeClockRecord, indexClaims } from '../lib/clockIn';

// Four ways an attendance row gets written, and they are four different
// statements about somebody. The onboarding agreement has a clause about
// falsified clock-in records, so a shift nobody clocked into must never read
// back as one they did - that is the whole reason self_declared exists.

describe('describeClockRecord', () => {
  it('says nothing about an ordinary clock-in', () => {
    // Silence is the correct output here. Annotating every normal shift would
    // bury the ones that need reading.
    expect(describeClockRecord({ checked_in_at: 'x', checked_out_at: 'y' }, null)).toBeNull();
  });

  it('marks a check-out the app inferred from the geofence', () => {
    const how = describeClockRecord({ checked_out_at: 'y', auto_checked_out: true }, null);
    expect(how.tone).toBe('inferred');
    expect(how.label).toMatch(/automatically/);
  });

  it('marks a shift the cleaner declared and an admin approved', () => {
    const how = describeClockRecord(
      { self_declared: true, checked_out_at: 'y' },
      { status: 'approved', raised_by_admin: false }
    );
    expect(how.tone).toBe('declared');
    expect(how.label).toMatch(/Declared by staff/);
    expect(how.label).toMatch(/not clocked/);
  });

  it('marks a shift the office recorded without being asked', () => {
    const how = describeClockRecord(
      { self_declared: true, checked_out_at: 'y' },
      { status: 'approved', raised_by_admin: true }
    );
    expect(how.label).toMatch(/Recorded by the office/);
    expect(how.label).toMatch(/not clocked/);
  });

  it('stays neutral about a self-declared row with no claim behind it', () => {
    // The claim lookup can miss, and a check-out the office corrected by hand
    // has no claim at all. Blaming staff for a time the office wrote in is a
    // guess, and "clocked in normally" is the one outright wrong answer - so
    // it says what is known and no more.
    const how = describeClockRecord({ self_declared: true }, null);
    expect(how.tone).toBe('declared');
    expect(how.label).toMatch(/not clocked/);
    expect(how.label).not.toMatch(/staff/);
    expect(how.label).not.toMatch(/office/);
  });

  it('lets self-declared win over the auto flag', () => {
    // A declared row is written with both timestamps at once, so it is not
    // an automatic check-out however the columns happen to sit.
    const how = describeClockRecord(
      { self_declared: true, checked_out_at: 'y', auto_checked_out: true },
      null
    );
    expect(how.tone).toBe('declared');
  });

  it('returns nothing for no row at all', () => {
    expect(describeClockRecord(null, null)).toBeNull();
  });
});

describe('indexClaims and claimFor', () => {
  const checkin = { job_id: 'j1', cleaner_id: 'c1' };

  it('finds the claim for a row', () => {
    const index = indexClaims([{ job_id: 'j1', cleaner_id: 'c1', status: 'approved', raised_by_admin: true }]);
    expect(claimFor(index, checkin).raised_by_admin).toBe(true);
  });

  it('prefers the approved claim when an earlier one was declined', () => {
    // A declined claim leaves the way clear for a corrected one, so both can
    // exist. The approved one is what an attendance row was written from.
    const index = indexClaims([
      { job_id: 'j1', cleaner_id: 'c1', status: 'declined', raised_by_admin: false },
      { job_id: 'j1', cleaner_id: 'c1', status: 'approved', raised_by_admin: true },
    ]);
    expect(claimFor(index, checkin).status).toBe('approved');
  });

  it('does not hand one cleaner another\'s claim on a shared job', () => {
    const index = indexClaims([{ job_id: 'j1', cleaner_id: 'someone-else', status: 'approved', raised_by_admin: true }]);
    expect(claimFor(index, checkin)).toBeNull();
  });

  it('copes with nothing to index', () => {
    expect(claimFor(indexClaims([]), checkin)).toBeNull();
    expect(claimFor(indexClaims(null), checkin)).toBeNull();
    expect(claimFor(null, checkin)).toBeNull();
  });
});
