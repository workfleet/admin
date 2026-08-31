import { describe, it, expect } from 'vitest';
import {
  shiftHours,
  formatTime,
  formatTimeRange,
  describeDays,
  isPatternComplete,
} from '../lib/shiftSchedule';

// A staffed-contract quote is sold shift by shift: so many hours, so many
// operatives, at so much per hour. Get the hours wrong and the weekly charge
// on a document a commercial buyer signs is wrong with it.

describe('shiftHours', () => {
  it('measures an ordinary daytime shift', () => {
    expect(shiftHours('09:00', '12:30')).toBe(3.5);
    expect(shiftHours('06:00', '14:00')).toBe(8);
  });

  it('carries a shift through midnight instead of going negative', () => {
    // 10pm-2am is four hours of cover, not minus twenty.
    expect(shiftHours('22:00', '02:00')).toBe(4);
    expect(shiftHours('23:30', '00:30')).toBe(1);
  });

  it('treats identical start and end as an unfinished entry, not a full day', () => {
    // Nobody schedules round-the-clock cleaning cover. Reading this as 24
    // hours would quote a day's pay per operative off a half-typed form.
    expect(shiftHours('09:00', '09:00')).toBe(0);
  });

  it('rejects times it cannot read rather than guessing', () => {
    expect(shiftHours('', '17:00')).toBe(0);
    expect(shiftHours('25:00', '17:00')).toBe(0);
    expect(shiftHours('09:70', '17:00')).toBe(0);
    expect(shiftHours(null, undefined)).toBe(0);
  });
});

describe('formatTime', () => {
  it('renders 12-hour times the way the quote document reads', () => {
    expect(formatTime('09:00')).toBe('9:00am');
    expect(formatTime('17:30')).toBe('5:30pm');
  });

  it('gets the two midnights right', () => {
    // 12-hour clocks make 00:xx and 12:xx the easy ones to invert.
    expect(formatTime('00:00')).toBe('12:00am');
    expect(formatTime('12:00')).toBe('12:00pm');
    expect(formatTime('00:30')).toBe('12:30am');
    expect(formatTime('12:45')).toBe('12:45pm');
  });

  it('returns nothing for an unreadable time', () => {
    expect(formatTime('nonsense')).toBe('');
  });

  it('formats a range', () => {
    expect(formatTimeRange('18:00', '20:30')).toBe('6:00pm - 8:30pm');
  });
});

describe('describeDays', () => {
  it('collapses a consecutive run into a range', () => {
    expect(describeDays(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Monday to Friday');
  });

  it('keeps a broken run as a list, so the quote promises no day nobody attends', () => {
    expect(describeDays(['mon', 'wed', 'thu', 'fri', 'sat'])).toBe('Monday, Wednesday, Thursday, Friday, Saturday');
  });

  it('lists rather than ranges when only two days are picked', () => {
    expect(describeDays(['mon', 'tue'])).toBe('Monday, Tuesday');
  });

  it('sorts into week order however they were ticked', () => {
    expect(describeDays(['fri', 'mon', 'wed'])).toBe('Monday, Wednesday, Friday');
  });

  it('is empty for no days at all', () => {
    expect(describeDays([])).toBe('');
    expect(describeDays(undefined)).toBe('');
  });
});

describe('isPatternComplete', () => {
  const complete = { start: '09:00', end: '17:00', rate: 15, operatives: 2, days: ['mon'], recurrence: 'weekly' };

  it('accepts a fully specified weekly pattern', () => {
    expect(isPatternComplete(complete)).toBe(true);
  });

  it('rejects a pattern that would price at nothing', () => {
    expect(isPatternComplete({ ...complete, rate: 0 })).toBe(false);
    expect(isPatternComplete({ ...complete, operatives: 0 })).toBe(false);
    expect(isPatternComplete({ ...complete, end: '09:00' })).toBe(false);
  });

  it('requires at least one day for recurring work', () => {
    expect(isPatternComplete({ ...complete, days: [] })).toBe(false);
  });

  it('does not require days for occasional work, which has no fixed pattern', () => {
    expect(isPatternComplete({ ...complete, days: [], recurrence: 'occasional' })).toBe(true);
  });

  it('rejects nothing at all', () => {
    expect(isPatternComplete(null)).toBe(false);
  });
});
