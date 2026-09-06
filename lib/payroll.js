// Pay periods, as dates.
//
// The office runs payroll to a calendar the app has to agree with exactly:
// weekly from a chosen weekday (Friday to Thursday, matching the dashboard's
// "This Week"), or by calendar month. This is the one place that calendar is
// worked out. The payroll page uses it to name the next period to close, the
// cleaner's hours page to say which of their weeks have gone, and the
// reminder sweep to know which day is the last one.
//
// Everything here is date-only. A period is a pair of YYYY-MM-DD strings,
// start inclusive and end exclusive, which is how migration 0082 stores it
// and how tiling weeks come out with no off-by-one at the join. Dates are
// built at local midnight and read back with the local getters, so the
// arithmetic is right across a clocks change - a week that spans the last
// Sunday in October is still seven calendar days, not seven times 24 hours.
import { localDateString } from './localDate';

// Matches the defaults in company_settings (0082), and the Friday-start
// weeks the dashboard has always used. weekStartsOn uses getDay() numbering:
// 0 = Sunday .. 6 = Saturday.
export const DEFAULT_PAYROLL_SETTINGS = { frequency: 'weekly', weekStartsOn: 5 };

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 'YYYY-MM-DD' -> local midnight. new Date('2026-08-28') would be UTC
// midnight, which is the previous evening anywhere west of Greenwich and
// names the wrong day on a British Summer Time morning. See lib/localDate.js.
export function parseLocalDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normaliseSettings(settings) {
  const s = { ...DEFAULT_PAYROLL_SETTINGS, ...(settings || {}) };
  if (s.frequency !== 'monthly') s.frequency = 'weekly';
  const day = Number(s.weekStartsOn);
  s.weekStartsOn = Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_PAYROLL_SETTINGS.weekStartsOn;
  return s;
}

function toPeriod(start, end) {
  return { start: localDateString(start), end: localDateString(end) };
}

// The period a given day falls in.
export function periodContaining(date, settings) {
  const s = normaliseSettings(settings);
  const day = startOfDay(date);

  if (s.frequency === 'monthly') {
    const start = new Date(day.getFullYear(), day.getMonth(), 1);
    const end = new Date(day.getFullYear(), day.getMonth() + 1, 1);
    return toPeriod(start, end);
  }

  const back = (day.getDay() - s.weekStartsOn + 7) % 7;
  const start = addDays(day, -back);
  return toPeriod(start, addDays(start, 7));
}

// The period beginning on a given day. Used to continue from where the last
// close ended. Normally that end is already a boundary of the schedule and
// this is simply the next period. If the frequency or weekday has been
// changed since, the next period starts at the old end and runs only to the
// first boundary of the new schedule - one short period, after which
// everything is back on the calendar the office asked for. Nothing is left
// unclosed and nothing is closed twice.
export function periodStartingAt(startString, settings) {
  const s = normaliseSettings(settings);
  const start = parseLocalDate(startString);

  if (s.frequency === 'monthly') {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return toPeriod(start, end);
  }

  const forward = (s.weekStartsOn - start.getDay() + 7) % 7 || 7;
  return toPeriod(start, addDays(start, forward));
}

// Has the period finished, as of `now`? A period can only be closed once
// its last day is over - the end date is exclusive, so that is the moment
// `now` reaches the end date at local midnight.
export function periodHasEnded(period, now = new Date()) {
  return startOfDay(now) >= parseLocalDate(period.end);
}

// The period the office should be closing next. Once a period has been
// closed, the next one starts where it ended, whether or not that period is
// over yet - the page needs to name it either way. Before anything has been
// closed there is no anchor, so the most recent finished period is offered
// as the sensible first one (the admin can pick an earlier one instead).
export function nextPeriodToClose(lastClosedEnd, settings, now = new Date()) {
  if (lastClosedEnd) return periodStartingAt(lastClosedEnd, settings);
  const current = periodContaining(now, settings);
  return periodEndingAt(current.start, settings);
}

// The period whose end is a given boundary - i.e. the one before the period
// that starts there.
export function periodEndingAt(endString, settings) {
  const s = normaliseSettings(settings);
  const end = parseLocalDate(endString);
  if (s.frequency === 'monthly') {
    return toPeriod(new Date(end.getFullYear(), end.getMonth() - 1, 1), end);
  }
  return toPeriod(addDays(end, -7), end);
}

// The last `count` periods that have already finished, newest first. Offered
// as the choice of starting point for the first ever close.
export function recentEndedPeriods(count, settings, now = new Date()) {
  const periods = [];
  let period = nextPeriodToClose(null, settings, now);
  for (let i = 0; i < count; i++) {
    periods.push(period);
    period = periodEndingAt(period.start, settings);
  }
  return periods;
}

// Whether `now` falls on a period's final day - the day the reminder goes
// out, so people check their hours before the office closes the period
// tomorrow.
export function isLastDayOfPeriod(period, now = new Date()) {
  return localDateString(startOfDay(now)) === localDateString(addDays(parseLocalDate(period.end), -1));
}

// Today's date in the company's own time zone, for code running on a server
// whose clock is UTC. On a Thursday night in summer the server is already
// into Friday by 23:00 London time, and a reminder sent for "today" would be
// about the wrong day.
export function todayInZone(timeZone = 'Europe/London', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Spelled out by hand rather than via toLocaleDateString, which under en-GB
// gives "Thu, 3 Sept 2026" in some runtimes and "Thu 3 Sep 2026" in others -
// a label that changes between the server and the browser is worse than one
// that is merely plain.
function shortDate(date, withYear) {
  const base = `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
  return withYear ? `${base} ${date.getFullYear()}` : base;
}

// "Fri 28 Aug – Thu 3 Sep 2026". Named by its last day rather than its
// exclusive end, because that is how the office talks about a week.
export function periodLabel(period, { withYear = true } = {}) {
  const start = parseLocalDate(period.start);
  const last = addDays(parseLocalDate(period.end), -1);
  if (localDateString(last) === localDateString(start)) return shortDate(start, withYear);
  return `${shortDate(start, false)} – ${shortDate(last, withYear)}`;
}

// Whether the period is a whole calendar month - the label then reads
// "August 2026" rather than a date range.
export function monthLabelIfWhole(period) {
  const start = parseLocalDate(period.start);
  const end = parseLocalDate(period.end);
  const wholeMonth = start.getDate() === 1 && end.getDate() === 1
    && (end.getMonth() === (start.getMonth() + 1) % 12);
  if (!wholeMonth) return null;
  return start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
