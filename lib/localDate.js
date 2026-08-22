// Formats a Date as YYYY-MM-DD in the *local* zone, for comparing against
// Postgres `date` columns (time_off_requests.start_date, due dates, expiry
// dates) and for filling <input type="date">.
//
// The obvious `d.toISOString().slice(0, 10)` is wrong for this: toISOString
// is UTC, so anywhere ahead of UTC it can name the previous day. Under
// British Summer Time local midnight is 23:00 the day before in UTC, so a
// job at 00:30 reads as yesterday - and a zone like Australia/Sydney is
// wrong year round, not only in summer.
//
// Only correct for a Date that means a local wall-clock moment. A date-only
// string parsed with `new Date('2026-08-22')` is already UTC midnight, and
// running that through here shifts it back a day in any zone behind UTC -
// keep using toISOString for those.
export function localDateString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
