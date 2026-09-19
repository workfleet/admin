import { describe, it, expect } from 'vitest';
import { planSeriesEdit, describeSeriesPlan } from '../lib/seriesEdit';
import { generateOccurrenceDates } from '../lib/recurrence';

// Editing a series used to mean deleting its jobs and starting again, and
// the delete took a cleaner's unrelated job with it. The plan is what
// stands between "change the time" and "lose every check-in".

const at = (ymd, hm = '10:00') => new Date(`${ymd}T${hm}`);
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const job = (ymdStr, hm = '10:00', extra = {}) => ({
  id: `${ymdStr}T${hm}`, scheduled_at: at(ymdStr, hm).toISOString(), status: 'scheduled', duration_minutes: 180, ...extra,
});

// 2026-09-21 is a Monday. Mon/Wed/Fri 10:00 for two weeks.
const oldRule = () => generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 3, 5]);
const existing = () => oldRule().map((d) => job(ymd(d)));

describe('an edit that changes nothing', () => {
  it('keeps every job and touches none', () => {
    const plan = planSeriesEdit(existing(), oldRule(), 180, oldRule());
    expect(plan.keep).toHaveLength(6);
    expect(plan.move).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});

describe('changing the time or length', () => {
  it('moves every job in place rather than replacing it', () => {
    const newRule = generateOccurrenceDates(at('2026-09-21', '11:30'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 3, 5]);
    const plan = planSeriesEdit(existing(), newRule, 180, oldRule());
    expect(plan.move).toHaveLength(6);
    expect(plan.move.every((m) => m.to.getHours() === 11 && m.to.getMinutes() === 30)).toBe(true);
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
    // The job keeps its identity, so assignments and tasks come with it.
    expect(plan.move.map((m) => m.job.id)).toEqual(existing().map((j) => j.id));
  });

  it('a length change alone is a move too', () => {
    const plan = planSeriesEdit(existing(), oldRule(), 120, oldRule());
    expect(plan.move).toHaveLength(6);
    expect(plan.keep).toEqual([]);
  });
});

describe('changing the days', () => {
  it('drops the days that left the pattern and adds the days that joined it', () => {
    // Mon/Wed/Fri -> Tue/Thu
    const newRule = generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [2, 4]);
    const plan = planSeriesEdit(existing(), newRule, 180, oldRule());
    expect(plan.remove.map((j) => ymd(new Date(j.scheduled_at)))).toEqual([
      '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02',
    ]);
    expect(plan.add.map(ymd)).toEqual(['2026-09-22', '2026-09-24', '2026-09-29', '2026-10-01']);
    expect(plan.keep).toEqual([]);
  });

  it('keeps the days both patterns share', () => {
    // Mon/Wed/Fri -> Mon/Fri
    const newRule = generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 5]);
    const plan = planSeriesEdit(existing(), newRule, 180, oldRule());
    expect(plan.keep).toHaveLength(4);
    expect(plan.remove.map((j) => ymd(new Date(j.scheduled_at)))).toEqual(['2026-09-23', '2026-09-30']);
    expect(plan.add).toEqual([]);
  });
});

describe('changing how long it runs', () => {
  it('extending books the extra dates only', () => {
    const newRule = generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-10-09', '23:59'), 0, [1, 3, 5]);
    const plan = planSeriesEdit(existing(), newRule, 180, oldRule());
    expect(plan.keep).toHaveLength(6);
    expect(plan.add.map(ymd)).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
    expect(plan.remove).toEqual([]);
  });

  it('shortening removes the dates past the new end', () => {
    const newRule = generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-09-25', '23:59'), 0, [1, 3, 5]);
    const plan = planSeriesEdit(existing(), newRule, 180, oldRule());
    expect(plan.keep).toHaveLength(3);
    expect(plan.remove.map((j) => ymd(new Date(j.scheduled_at)))).toEqual(['2026-09-28', '2026-09-30', '2026-10-02']);
  });
});

describe('what an edit must never touch', () => {
  it('leaves a job that has already happened alone, and books nothing beside it', () => {
    const jobs = existing();
    jobs[0] = { ...jobs[0], status: 'completed' };
    const newRule = generateOccurrenceDates(at('2026-09-21', '14:00'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 3, 5]);
    const plan = planSeriesEdit(jobs, newRule, 180, oldRule());
    expect(plan.locked).toEqual([jobs[0]]);
    expect(plan.move).toHaveLength(5);
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('leaves a job the office moved to a day off the old pattern alone', () => {
    // The Wed 23rd visit was pushed to Sat 26th by hand.
    const jobs = existing().filter((j) => !j.id.startsWith('2026-09-23'));
    jobs.push(job('2026-09-26'));
    // Time change across the series.
    const newRule = generateOccurrenceDates(at('2026-09-21', '09:00'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 3, 5]);
    const plan = planSeriesEdit(jobs, newRule, 180, oldRule());
    expect(plan.locked.map((j) => ymd(new Date(j.scheduled_at)))).toEqual(['2026-09-26']);
    expect(plan.remove).toEqual([]);
    // The Wednesday the moved job vacated is back on the pattern, so it is
    // booked again - the office sees that in the preview before agreeing.
    expect(plan.add.map(ymd)).toEqual(['2026-09-23']);
    expect(plan.move).toHaveLength(5);
  });

  it('does not book a second visit on a day that already has a moved-in job', () => {
    // Fri 25th's job was moved to Sat 26th; now the pattern gains Saturdays.
    const jobs = existing().filter((j) => !j.id.startsWith('2026-09-25'));
    jobs.push(job('2026-09-26', '10:00'));
    const newRule = generateOccurrenceDates(at('2026-09-21'), 'weekly', 1, 'date', at('2026-10-02', '23:59'), 0, [1, 3, 5, 6]);
    const plan = planSeriesEdit(jobs, newRule, 180, oldRule());
    // Sat 26th already has a job, so only the vacated Friday is booked.
    expect(plan.add.map(ymd)).toEqual(['2026-09-25']);
    expect(plan.remove).toEqual([]);
  });

  it('removes a duplicate booked twice on one day, keeping one', () => {
    const jobs = [...existing(), job('2026-09-23', '10:00', { id: 'dup' })];
    const plan = planSeriesEdit(jobs, oldRule(), 180, oldRule());
    expect(plan.keep).toHaveLength(6);
    expect(plan.remove.map((j) => j.id)).toEqual(['dup']);
  });
});

describe('describing the plan', () => {
  it('reads as one line', () => {
    expect(describeSeriesPlan({ keep: [1, 2], move: [1], add: [], remove: [1, 1, 1] })).toBe('Keeps 2, moves 1, removes 3.');
    expect(describeSeriesPlan({ keep: [], move: [], add: [], remove: [] })).toBe('No changes.');
  });
});
