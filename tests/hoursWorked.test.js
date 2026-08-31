import { describe, it, expect } from 'vitest';
import { jobShareHours, hoursWorked, formatHours, HOLIDAY_ACCRUAL_RATE } from '../lib/hoursWorked';

// These figures reach staff twice - as the totals on a cleaner's own hours
// page, and as the holiday balance the rota lets them book against. They also
// have to agree with the enforce_holiday_balance() trigger in the database. A
// disagreement between any two of those is the kind of thing someone notices
// on a payslip and stops trusting the app over.

const job = (id, minutes, status = 'completed') => ({ id, duration_minutes: minutes, status });

describe('jobShareHours', () => {
  it('splits a job evenly across everyone assigned to it', () => {
    // A 2-hour job with 2 people on it is 1 hour each, not 2 hours each -
    // otherwise a team of four bills the company four times the work.
    expect(jobShareHours(job('a', 120), { a: 2 })).toBe(1);
    expect(jobShareHours(job('a', 120), { a: 4 })).toBe(0.5);
  });

  it('treats a job with no assignment rows as one person', () => {
    // Missing rows must not divide by zero and hand someone Infinity hours.
    expect(jobShareHours(job('a', 120), {})).toBe(2);
    expect(Number.isFinite(jobShareHours(job('a', 120), { a: 0 }))).toBe(true);
  });

  it('reads zero for a job with no duration recorded', () => {
    expect(jobShareHours({ id: 'a' }, {})).toBe(0);
    expect(jobShareHours(job('a', null), {})).toBe(0);
  });
});

describe('hoursWorked', () => {
  it('counts completed jobs only', () => {
    const jobs = [
      job('a', 120),
      job('b', 60, 'scheduled'),
      job('c', 90, 'in_progress'),
      job('d', 180, 'missed'),
    ];
    expect(hoursWorked(jobs, {})).toBe(2);
  });

  it('sums each cleaner-share, not each job', () => {
    const jobs = [job('a', 120), job('b', 120)];
    expect(hoursWorked(jobs, { a: 2, b: 4 })).toBe(1.5);
  });

  it('is zero for an empty week rather than undefined', () => {
    expect(hoursWorked([], {})).toBe(0);
  });
});

describe('formatHours', () => {
  it('reads as hours and minutes, the way a payslip does', () => {
    expect(formatHours(6.5)).toBe('6h 30m');
    expect(formatHours(1)).toBe('1h');
    expect(formatHours(0.25)).toBe('15m');
  });

  it('says 0h rather than 0m, which reads like a rounding error', () => {
    expect(formatHours(0)).toBe('0h');
  });

  it('rounds to the nearest minute rather than showing a decimal', () => {
    expect(formatHours(1 / 3)).toBe('20m');
    expect(formatHours(2.999)).toBe('3h');
  });
});

describe('HOLIDAY_ACCRUAL_RATE', () => {
  it('is the UK statutory rate of 5.6 weeks over 46.4 working weeks', () => {
    // Hard-coded in the app and again in the database trigger. If this moves,
    // the trigger has to move with it.
    expect(HOLIDAY_ACCRUAL_RATE).toBeCloseTo(5.6 / 46.4, 4);
  });
});
