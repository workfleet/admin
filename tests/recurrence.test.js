import { describe, it, expect } from 'vitest';
import { generateOccurrenceDates, MAX_OCCURRENCES } from '../lib/recurrence';

// Every date this produces becomes a real job on the rota with cleaners
// booked against it. A wrong weekday is a cleaner turning up on the wrong
// day; a missed one is a client nobody visits.

const at = (ymd, hm = '09:30') => new Date(`${ymd}T${hm}`);
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const days = (dates) => dates.map(ymd);

describe('weekly with ticked days', () => {
  // 2026-09-07 is a Monday.
  it('books every ticked day each week, in date order', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'weekly', 1, 'count', null, 5, [1, 3, 5]);
    expect(days(out)).toEqual(['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16']);
  });

  it('keeps the time of day on every occurrence', () => {
    const out = generateOccurrenceDates(at('2026-09-07', '14:15'), 'weekly', 1, 'count', null, 3, [1, 4]);
    expect(out.every((d) => d.getHours() === 14 && d.getMinutes() === 15)).toBe(true);
  });

  it('skips ticked days that fall before the start date in the first week', () => {
    // Start on a Wednesday but tick Mon/Wed/Fri: Monday the 7th has already gone.
    const out = generateOccurrenceDates(at('2026-09-09'), 'weekly', 1, 'count', null, 3, [1, 3, 5]);
    expect(days(out)).toEqual(['2026-09-09', '2026-09-11', '2026-09-14']);
  });

  it('does not need the start date itself to be a ticked day', () => {
    // Form filled in on a Monday for a Tue/Thu job: first visit is Tuesday.
    const out = generateOccurrenceDates(at('2026-09-07'), 'weekly', 1, 'count', null, 2, [2, 4]);
    expect(days(out)).toEqual(['2026-09-08', '2026-09-10']);
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // Sat/Sun ticked from a Saturday: the Sunday is the very next day, in the
    // same week, not six days later in the next one.
    const out = generateOccurrenceDates(at('2026-09-12'), 'weekly', 2, 'count', null, 4, [6, 0]);
    expect(days(out)).toEqual(['2026-09-12', '2026-09-13', '2026-09-26', '2026-09-27']);
  });

  it('every other week skips the whole off week', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'weekly', 2, 'count', null, 4, [1, 5]);
    expect(days(out)).toEqual(['2026-09-07', '2026-09-11', '2026-09-21', '2026-09-25']);
  });

  it('stops at the end date, inclusive of a ticked day on it', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'weekly', 1, 'date', at('2026-09-16', '23:59'), 0, [1, 3]);
    expect(days(out)).toEqual(['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16']);
  });

  it('falls back to the start weekday when no days are ticked', () => {
    const out = generateOccurrenceDates(at('2026-09-09'), 'weekly', 1, 'count', null, 3, []);
    expect(days(out)).toEqual(['2026-09-09', '2026-09-16', '2026-09-23']);
  });

  it('counts across the October clock change without drifting a day', () => {
    // BST ends 2026-10-25. A Sunday job on either side of it must stay a Sunday.
    const out = generateOccurrenceDates(at('2026-10-18'), 'weekly', 1, 'count', null, 3, [0]);
    expect(days(out)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01']);
    expect(out.every((d) => d.getHours() === 9)).toBe(true);
  });

  it('never exceeds the occurrence cap however far away the end date is', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'weekly', 1, 'date', at('2099-01-01'), 0, [1, 2, 3, 4, 5, 6, 0]);
    expect(out).toHaveLength(MAX_OCCURRENCES);
  });
});

describe('daily and monthly', () => {
  it('daily steps by the interval', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'daily', 3, 'count', null, 3);
    expect(days(out)).toEqual(['2026-09-07', '2026-09-10', '2026-09-13']);
  });

  it('monthly keeps the day of month', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'monthly', 1, 'count', null, 3);
    expect(days(out)).toEqual(['2026-09-07', '2026-10-07', '2026-11-07']);
  });

  it('ends on the end date', () => {
    const out = generateOccurrenceDates(at('2026-09-07'), 'daily', 1, 'date', at('2026-09-09', '23:59'), 0);
    expect(days(out)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
  });
});
