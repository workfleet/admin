import { describe, it, expect } from 'vitest';
import {
  periodContaining,
  periodStartingAt,
  periodEndingAt,
  periodHasEnded,
  nextPeriodToClose,
  recentEndedPeriods,
  isLastDayOfPeriod,
  periodLabel,
  monthLabelIfWhole,
  parseLocalDate,
} from '../lib/payroll';

// The office runs payroll to this calendar. If the app names the wrong week,
// a close either pays a day twice or leaves one out - and both are found on a
// payslip, weeks later, by someone who then stops trusting the figure.

const weekly = { frequency: 'weekly', weekStartsOn: 5 }; // Friday, as on the dashboard
const monthly = { frequency: 'monthly' };

describe('periodContaining', () => {
  it('puts a midweek day in the Friday-to-Thursday week around it', () => {
    // Wednesday 2 Sep 2026 sits in the week that began Friday 28 Aug.
    expect(periodContaining(new Date(2026, 8, 2), weekly)).toEqual({ start: '2026-08-28', end: '2026-09-04' });
  });

  it('starts a new week on the start day itself', () => {
    // Friday belongs to the week it opens, not the one it follows.
    expect(periodContaining(new Date(2026, 8, 4), weekly)).toEqual({ start: '2026-09-04', end: '2026-09-11' });
    // And Thursday is still the previous week's last day.
    expect(periodContaining(new Date(2026, 8, 3), weekly)).toEqual({ start: '2026-08-28', end: '2026-09-04' });
  });

  it('honours a different start day', () => {
    // Monday-start weeks, for a company that runs them that way.
    expect(periodContaining(new Date(2026, 8, 2), { frequency: 'weekly', weekStartsOn: 1 }))
      .toEqual({ start: '2026-08-31', end: '2026-09-07' });
  });

  it('uses whole calendar months when monthly', () => {
    expect(periodContaining(new Date(2026, 8, 15), monthly)).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(periodContaining(new Date(2026, 11, 31), monthly)).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('ignores the time of day', () => {
    expect(periodContaining(new Date(2026, 8, 3, 23, 59), weekly)).toEqual({ start: '2026-08-28', end: '2026-09-04' });
  });

  it('falls back to Friday weeks on nonsense settings', () => {
    expect(periodContaining(new Date(2026, 8, 2), { frequency: 'fortnightly', weekStartsOn: 9 }))
      .toEqual({ start: '2026-08-28', end: '2026-09-04' });
    expect(periodContaining(new Date(2026, 8, 2), null)).toEqual({ start: '2026-08-28', end: '2026-09-04' });
  });

  it('is seven calendar days across the clocks going back', () => {
    // The last Sunday of October 2026 is the 25th. A week that spans it has
    // 169 hours; it must still end seven dates later, not on the 24th at 23:00.
    expect(periodContaining(new Date(2026, 9, 26), weekly)).toEqual({ start: '2026-10-23', end: '2026-10-30' });
  });
});

describe('periodStartingAt / periodEndingAt', () => {
  it('continues from a boundary', () => {
    expect(periodStartingAt('2026-09-04', weekly)).toEqual({ start: '2026-09-04', end: '2026-09-11' });
    expect(periodEndingAt('2026-09-04', weekly)).toEqual({ start: '2026-08-28', end: '2026-09-04' });
  });

  it('runs a full month from a boundary when monthly', () => {
    expect(periodStartingAt('2026-09-01', monthly)).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(periodEndingAt('2027-01-01', monthly)).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('runs one short period to the new boundary after a schedule change', () => {
    // Switched from weekly to monthly mid-stream: the next period picks up
    // at the old end (a Friday) and runs to the 1st, so no day is skipped
    // and the one after is a proper calendar month.
    expect(periodStartingAt('2026-09-04', monthly)).toEqual({ start: '2026-09-04', end: '2026-10-01' });
    // And the other way: monthly ended on Thursday 1 Oct; Friday weeks begin
    // the next day, so the bridging period is a single Thursday.
    expect(periodStartingAt('2026-10-01', weekly)).toEqual({ start: '2026-10-01', end: '2026-10-02' });
    // Changing the weekday from Friday to Monday: Fri 4 Sep to Mon 7 Sep.
    expect(periodStartingAt('2026-09-04', { frequency: 'weekly', weekStartsOn: 1 }))
      .toEqual({ start: '2026-09-04', end: '2026-09-07' });
  });
});

describe('periodHasEnded', () => {
  const period = { start: '2026-08-28', end: '2026-09-04' };

  it('is false while the last day is still running', () => {
    expect(periodHasEnded(period, new Date(2026, 8, 3, 23, 30))).toBe(false);
  });

  it('is true from midnight at the end date', () => {
    expect(periodHasEnded(period, new Date(2026, 8, 4, 0, 0))).toBe(true);
    expect(periodHasEnded(period, new Date(2026, 8, 20))).toBe(true);
  });
});

describe('nextPeriodToClose', () => {
  it('follows straight on from the last closed period', () => {
    expect(nextPeriodToClose('2026-09-04', weekly, new Date(2026, 8, 6)))
      .toEqual({ start: '2026-09-04', end: '2026-09-11' });
  });

  it('names a period that has not ended yet, so the page can say so', () => {
    const next = nextPeriodToClose('2026-09-04', weekly, new Date(2026, 8, 6));
    expect(periodHasEnded(next, new Date(2026, 8, 6))).toBe(false);
  });

  it('offers the most recent finished period when nothing has been closed', () => {
    // Sunday 6 Sep: the current week began Fri 4 Sep, so the last finished
    // one is 28 Aug - 3 Sep.
    expect(nextPeriodToClose(null, weekly, new Date(2026, 8, 6)))
      .toEqual({ start: '2026-08-28', end: '2026-09-04' });
    expect(nextPeriodToClose(null, monthly, new Date(2026, 8, 6)))
      .toEqual({ start: '2026-08-01', end: '2026-09-01' });
  });
});

describe('recentEndedPeriods', () => {
  it('lists finished periods newest first, tiling with no gaps', () => {
    const list = recentEndedPeriods(3, weekly, new Date(2026, 8, 6));
    expect(list).toEqual([
      { start: '2026-08-28', end: '2026-09-04' },
      { start: '2026-08-21', end: '2026-08-28' },
      { start: '2026-08-14', end: '2026-08-21' },
    ]);
    list.forEach((p) => expect(periodHasEnded(p, new Date(2026, 8, 6))).toBe(true));
  });
});

describe('isLastDayOfPeriod', () => {
  const period = { start: '2026-08-28', end: '2026-09-04' };

  it('is the day before the exclusive end', () => {
    expect(isLastDayOfPeriod(period, new Date(2026, 8, 3, 9))).toBe(true);
    expect(isLastDayOfPeriod(period, new Date(2026, 8, 2, 9))).toBe(false);
    expect(isLastDayOfPeriod(period, new Date(2026, 8, 4, 9))).toBe(false);
  });
});

describe('labels', () => {
  it('names a week by its first and last day', () => {
    expect(periodLabel({ start: '2026-08-28', end: '2026-09-04' })).toBe('Fri 28 Aug – Thu 3 Sep 2026');
    expect(periodLabel({ start: '2026-08-28', end: '2026-09-04' }, { withYear: false })).toBe('Fri 28 Aug – Thu 3 Sep');
  });

  it('names a whole month as a month', () => {
    expect(monthLabelIfWhole({ start: '2026-08-01', end: '2026-09-01' })).toBe('August 2026');
    expect(monthLabelIfWhole({ start: '2026-08-28', end: '2026-09-04' })).toBeNull();
    expect(monthLabelIfWhole({ start: '2026-12-01', end: '2027-01-01' })).toBe('December 2026');
  });
});

describe('parseLocalDate', () => {
  it('reads a date string as local midnight, not UTC', () => {
    const d = parseLocalDate('2026-08-28');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 7, 28, 0]);
  });
});
