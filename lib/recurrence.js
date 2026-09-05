// Turning a recurring-job form into the list of dates it books.
//
// Occurrences are generated up front as individual `jobs` rows (see
// supabase/migrations/0031_recurring_jobs.sql for why there is no rule
// engine), so this is the only place the recurrence rule is ever evaluated.

// Sanity cap against a mistake (e.g. daily "forever") generating an
// unbounded number of jobs in one go.
export const MAX_OCCURRENCES = 104;

// Ordered Monday first, the way a UK rota reads. `day` matches
// Date#getDay(), which is what gets stored on job_series.weekdays.
export const WEEKDAY_OPTIONS = [
  { day: 1, label: 'Monday', short: 'Mon' },
  { day: 2, label: 'Tuesday', short: 'Tue' },
  { day: 3, label: 'Wednesday', short: 'Wed' },
  { day: 4, label: 'Thursday', short: 'Thu' },
  { day: 5, label: 'Friday', short: 'Fri' },
  { day: 6, label: 'Saturday', short: 'Sat' },
  { day: 0, label: 'Sunday', short: 'Sun' },
];

function startOfMondayWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Whole weeks between two dates, counted Monday to Monday. Goes through
// local midnight so a DST switch between them does not shave an hour off
// and make a Sunday look like the previous week.
function weeksBetween(from, to) {
  const a = startOfMondayWeek(from);
  const b = startOfMondayWeek(to);
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * The dates a repeating job lands on.
 *
 * @param {Date} start first possible occurrence; its time of day is kept for
 *   every date generated
 * @param {'daily'|'weekly'|'monthly'} recurrenceType
 * @param {number} intervalCount every N days / weeks / months
 * @param {'count'|'date'} endMode
 * @param {Date|null} endDate last day allowed when endMode is 'date'
 * @param {number} count how many to generate when endMode is 'count'
 * @param {number[]} [weekdays] weekly only: Date#getDay() values the job
 *   runs on. Every ticked day in each "on" week is booked, starting from
 *   the week the start date falls in and skipping days before it. Omitted
 *   or empty falls back to the start date's own weekday.
 */
export function generateOccurrenceDates(start, recurrenceType, intervalCount, endMode, endDate, count, weekdays) {
  const interval = Math.max(1, Number(intervalCount) || 1);
  const limit = endMode === 'count' ? Math.min(MAX_OCCURRENCES, Math.max(1, Number(count) || 1)) : MAX_OCCURRENCES;

  if (recurrenceType === 'weekly') {
    const days = new Set(
      Array.isArray(weekdays) && weekdays.length > 0 ? weekdays.map(Number) : [start.getDay()]
    );
    const dates = [];
    const current = new Date(start);
    // Bounded so an end date centuries away, or a rule that somehow never
    // matches, still terminates: at most one match per ticked day per
    // on-week, so this many days always covers MAX_OCCURRENCES.
    const maxDays = (MAX_OCCURRENCES + 1) * 7 * interval;
    for (let i = 0; i < maxDays && dates.length < limit; i++) {
      if (endMode === 'date' && endDate && current > endDate) break;
      if (days.has(current.getDay()) && weeksBetween(start, current) % interval === 0) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  const dates = [];
  const current = new Date(start);
  while (dates.length < limit) {
    dates.push(new Date(current));
    if (endMode === 'count' && dates.length >= limit) break;
    if (recurrenceType === 'daily') current.setDate(current.getDate() + interval);
    else current.setMonth(current.getMonth() + interval);
    if (endMode === 'date' && endDate && current > endDate) break;
  }
  return dates;
}
