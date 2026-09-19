// Turning an edit to a recurring series into the smallest set of changes
// to the jobs it already has.
//
// Until 2026-09-19 there was no way to change a series: the office deleted
// its jobs and created it again, which threw away every assignment, task,
// check-in and one-off adjustment on the way - and on one occasion a job
// that had nothing to do with the series. So an edit is reconciled against
// what exists rather than regenerated: a job on a day the new pattern still
// covers is kept (moved if its time or length changed), a day the pattern
// no longer covers loses its job, and a day it newly covers gains one.
//
// Two kinds of job are never touched, whatever the edit says:
//  - one that has already happened or started (status other than
//    'scheduled') - history is not for editing;
//  - one the office moved by hand off the old pattern, such as a Saturday
//    visit pushed to Sunday. It is not on a day the old rule produced, so
//    the rule was never what put it there.

import { localDateString } from './localDate';

const dayKey = (value) => localDateString(value instanceof Date ? value : new Date(value));

/**
 * @param {Array<{id: string, scheduled_at: string, status: string, duration_minutes: number}>} jobs
 *   the series' existing jobs from the edited occurrence onward
 * @param {Date[]} newDates every occurrence the edited rule produces, with
 *   the new time of day on each
 * @param {number} newDuration minutes each occurrence should now run for
 * @param {Date[]} oldDates what the rule as it stood produced over the same
 *   span; a job on none of these days is one someone moved deliberately
 * @returns {{keep: object[], move: Array<{job: object, to: Date}>, add: Date[], remove: object[], locked: object[]}}
 */
export function planSeriesEdit(jobs, newDates, newDuration, oldDates) {
  const onOldPattern = new Set(oldDates.map(dayKey));
  const byDay = new Map();
  const locked = [];

  for (const job of jobs) {
    const editable = job.status === 'scheduled' && onOldPattern.has(dayKey(job.scheduled_at));
    if (!editable) { locked.push(job); continue; }
    // Two editable jobs on one day (a duplicate) both stay editable; only
    // one can match the new date, and the other is removed as surplus.
    const key = dayKey(job.scheduled_at);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(job);
  }

  // A locked job still holds its day: the new pattern landing on it adds
  // nothing, so a completed visit never gets a duplicate booked beside it.
  const lockedDays = new Set(locked.map((j) => dayKey(j.scheduled_at)));

  const keep = [];
  const move = [];
  const add = [];

  for (const date of newDates) {
    const key = dayKey(date);
    const candidates = byDay.get(key);
    if (candidates && candidates.length > 0) {
      const job = candidates.shift();
      const sameTime = new Date(job.scheduled_at).getTime() === date.getTime();
      const sameLength = (job.duration_minutes || 120) === newDuration;
      if (sameTime && sameLength) keep.push(job);
      else move.push({ job, to: date });
    } else if (!lockedDays.has(key)) {
      add.push(date);
    }
  }

  const remove = [...byDay.values()].flat();

  return { keep, move, add, remove, locked };
}

/** One line the office can read before agreeing to it. */
export function describeSeriesPlan(plan) {
  const parts = [];
  if (plan.keep.length) parts.push(`keeps ${plan.keep.length}`);
  if (plan.move.length) parts.push(`moves ${plan.move.length}`);
  if (plan.add.length) parts.push(`adds ${plan.add.length}`);
  if (plan.remove.length) parts.push(`removes ${plan.remove.length}`);
  if (parts.length === 0) return 'No changes.';
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
}
