import { describe, it, expect } from 'vitest';
import {
  claimWindowError,
  defaultClaimWindow,
  isClaimableMissedJob,
  jobEnd,
  unpaidMissedJobs,
} from '../lib/missedClockin';

// A forgotten clock-in does not shorten a shift, it deletes it: the job never
// reaches 'completed', and hours are only ever counted on completed jobs. So
// the rules here decide whether somebody gets paid for a day they worked.
// Offering the claim too readily invites a shift being declared twice; not
// offering it at all is the bug this whole path exists to fix.

const at = (iso) => new Date(iso);
const job = (overrides = {}) => ({
  id: 'job-1',
  scheduled_at: '2026-08-20T09:00:00.000Z',
  duration_minutes: 120,
  status: 'scheduled',
  ...overrides,
});

describe('jobEnd', () => {
  it('falls back to two hours when no duration was recorded', () => {
    // Same fallback the rota and the payroll panel use. Picking a different
    // one here would make a job claimable at a time the rest of the app
    // thinks it is still running.
    expect(jobEnd(job({ duration_minutes: null })).toISOString()).toBe('2026-08-20T11:00:00.000Z');
  });
});

describe('isClaimableMissedJob', () => {
  it('offers nothing while the shift is still running', () => {
    expect(isClaimableMissedJob(job(), at('2026-08-20T10:00:00.000Z'))).toBe(false);
  });

  it('offers nothing in the minute before the shift is due to end', () => {
    expect(isClaimableMissedJob(job(), at('2026-08-20T10:59:00.000Z'))).toBe(false);
  });

  it('offers the claim once the booked time has run out', () => {
    expect(isClaimableMissedJob(job(), at('2026-08-20T11:30:00.000Z'))).toBe(true);
  });

  it('offers the claim on a job already marked missed', () => {
    expect(isClaimableMissedJob(job({ status: 'missed' }), at('2026-08-20T11:30:00.000Z'))).toBe(true);
  });

  it('does not wait for reconcile to have run', () => {
    // reconcile_job_statuses() only runs when an admin opens the rota or the
    // dashboard, so a long-overdue job can still read 'scheduled'. A cleaner
    // must not have to wait on somebody else opening a page before they can
    // put their own hours right - this is the whole reason for the second
    // limb of the rule, and of the matching one in 0076's insert policy.
    const staleStatus = job({ status: 'scheduled' });
    expect(isClaimableMissedJob(staleStatus, at('2026-08-21T09:00:00.000Z'))).toBe(true);
  });

  it('offers nothing on a job that was completed', () => {
    expect(isClaimableMissedJob(job({ status: 'completed' }), at('2026-08-20T11:30:00.000Z'))).toBe(false);
  });

  it('offers nothing on a job somebody is currently on site for', () => {
    // 'in_progress' means a real check-in exists. Overrunning your allotted
    // time must not put a "you forgot to clock in" prompt in front of
    // somebody who is still holding the mop.
    expect(isClaimableMissedJob(job({ status: 'in_progress' }), at('2026-08-20T12:30:00.000Z'))).toBe(false);
  });
});

describe('defaultClaimWindow', () => {
  it('offers the booked times back, which is the answer on nearly every claim', () => {
    const { from, to } = defaultClaimWindow(job());
    expect(from.toISOString()).toBe('2026-08-20T09:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-20T11:00:00.000Z');
  });
});

describe('claimWindowError', () => {
  const now = at('2026-08-20T18:00:00.000Z');

  it('accepts a shift that has been and gone', () => {
    expect(claimWindowError(
      { from: at('2026-08-20T09:00:00.000Z'), to: at('2026-08-20T11:00:00.000Z') },
      now
    )).toBeNull();
  });

  it('refuses a finish time before the start', () => {
    expect(claimWindowError(
      { from: at('2026-08-20T11:00:00.000Z'), to: at('2026-08-20T09:00:00.000Z') },
      now
    )).toMatch(/after the start/);
  });

  it('refuses a shift that has not finished yet', () => {
    // Declaring work you have not done is a booking, not a record - and
    // 0076's insert policy refuses it server-side too, so letting it through
    // here would only produce a confusing failure further down.
    expect(claimWindowError(
      { from: at('2026-08-20T17:00:00.000Z'), to: at('2026-08-20T19:00:00.000Z') },
      now
    )).toMatch(/future/);
  });

  it('refuses a time that was never filled in', () => {
    expect(claimWindowError({ from: null, to: at('2026-08-20T11:00:00.000Z') }, now)).toMatch(/started/);
    expect(claimWindowError({ from: at('2026-08-20T09:00:00.000Z'), to: null }, now)).toMatch(/finished/);
  });
});

describe('unpaidMissedJobs', () => {
  const now = at('2026-08-25T09:00:00.000Z');
  const missedA = job({ id: 'a', scheduled_at: '2026-08-20T09:00:00.000Z', status: 'missed' });
  const missedB = job({ id: 'b', scheduled_at: '2026-08-22T09:00:00.000Z', status: 'missed' });
  const done = job({ id: 'c', scheduled_at: '2026-08-21T09:00:00.000Z', status: 'completed' });

  it('lists only the shifts that are actually missing from the total', () => {
    expect(unpaidMissedJobs([missedA, missedB, done], [], now).map((j) => j.id)).toEqual(['b', 'a']);
  });

  it('drops a shift already waiting on the office', () => {
    // Asking twice about the same shift is not something to invite - it puts
    // two claims in the admin queue for one day's work.
    const claims = [{ job_id: 'a', status: 'pending' }];
    expect(unpaidMissedJobs([missedA, missedB], claims, now).map((j) => j.id)).toEqual(['b']);
  });

  it('brings back a shift the office turned down', () => {
    // A declined claim leaves the shift genuinely unpaid, so it belongs back
    // on the list - the cleaner may have got the times wrong, and 0076's
    // unique index deliberately only covers pending claims so they can
    // correct one and try again.
    const claims = [{ job_id: 'a', status: 'declined' }];
    expect(unpaidMissedJobs([missedA], claims, now).map((j) => j.id)).toEqual(['a']);
  });

  it('drops a shift that was approved', () => {
    // An approved claim has already flipped the job to 'completed', so it is
    // counted - listing it as unpaid would be telling someone their hours
    // are missing while they are looking at them in the total above.
    const claims = [{ job_id: 'a', status: 'approved' }];
    expect(unpaidMissedJobs([missedA], claims, now)).toEqual([]);
  });
});
