// The rota read one cleaner at a time.
//
// The calendar draws the week on the clock, which answers "what is on at
// ten on Tuesday". The office's other question is "what is Amira doing
// this week, and who has room on Thursday" - that wants a row per person
// with the days across, so you read along a line. This builds those rows.
//
// A job with two cleaners on it sits on both their rows: each of them
// really is booked. A job with nobody on it goes on a row of its own at
// the top, because a job that has quietly fallen off the rota is the one
// thing the office most needs to see.

export const UNASSIGNED_ROW_ID = 'unassigned';
export const DEFAULT_DURATION_MINUTES = 120;

function sameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

function makeRow(id, name, current, weekDays) {
  return { id, name, current, days: weekDays.map(() => []), jobCount: 0, minutes: 0 };
}

// `cleaners` is the staff list the office can book, in the order it should
// appear. Someone who has left but still has a job this week (their name
// rides on the assignment) gets a row after the current staff rather than
// having their job vanish from the sheet.
export function buildCleanerRows(jobs, cleaners, weekDays) {
  const rows = new Map();
  rows.set(UNASSIGNED_ROW_ID, makeRow(UNASSIGNED_ROW_ID, 'Needs a cleaner', true, weekDays));
  (cleaners || []).forEach((c) => rows.set(c.id, makeRow(c.id, c.full_name || 'Unknown', true, weekDays)));

  const former = [];
  (jobs || []).forEach((job) => {
    const when = new Date(job.scheduled_at);
    const dayIndex = weekDays.findIndex((d) => sameDay(d, when));
    if (dayIndex === -1) return;

    const assignments = (job.job_assignments || []).filter((a) => a && a.cleaner_id);
    const targets = assignments.length === 0 ? [UNASSIGNED_ROW_ID] : assignments.map((a) => a.cleaner_id);
    targets.forEach((id) => {
      if (!rows.has(id)) {
        const a = assignments.find((x) => x.cleaner_id === id);
        const row = makeRow(id, a?.profiles?.full_name || 'Former staff', false, weekDays);
        rows.set(id, row);
        former.push(row);
      }
      const row = rows.get(id);
      row.days[dayIndex].push(job);
      row.jobCount += 1;
      row.minutes += job.duration_minutes || DEFAULT_DURATION_MINUTES;
    });
  });

  rows.forEach((row) => {
    row.days.forEach((list) => list.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
  });

  former.sort((a, b) => a.name.localeCompare(b.name));
  const current = [rows.get(UNASSIGNED_ROW_ID), ...(cleaners || []).map((c) => rows.get(c.id))];
  return [...current, ...former];
}

// Everyone else on the job, for the "with Chloe" note on a chip.
export function coworkersOf(job, cleanerId) {
  return (job.job_assignments || [])
    .filter((a) => a && a.cleaner_id && a.cleaner_id !== cleanerId)
    .map((a) => a.profiles?.full_name || 'Unknown');
}

// "Amira Shah" -> "Amira". A chip has one line, and a first name is what the
// office calls people anyway.
export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

// 390 -> "6.5", 480 -> "8". Whole hours drop the ".0" so the column reads
// as a number rather than a measurement.
export function formatHours(minutes) {
  const h = (minutes || 0) / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

// The free time in someone's day, for slotting a job in. Counted inside the
// working window - a gap at three in the morning is not one the office
// would book - and only when it is long enough to be worth showing.
// Overlapping jobs are merged first so a double-booking can't open a false
// gap between its two halves. Times are minutes of the day.
export const WORKING_DAY = { from: 7 * 60, to: 18 * 60, min: 30 };

function minutesOfDay(when) {
  const d = new Date(when);
  return d.getHours() * 60 + d.getMinutes();
}

export function freeGaps(jobs, { from, to, min } = WORKING_DAY) {
  const spans = (jobs || [])
    .map((j) => {
      const start = minutesOfDay(j.scheduled_at);
      return { start, end: start + (j.duration_minutes || DEFAULT_DURATION_MINUTES) };
    })
    .sort((a, b) => a.start - b.start);

  const gaps = [];
  let cursor = from;
  spans.forEach((s) => {
    if (s.start - cursor >= min) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  });
  if (to - cursor >= min) gaps.push({ start: cursor, end: to });
  return gaps;
}

// 90 -> "1h 30m", 120 -> "2h", 45 -> "45m".
export function formatGap(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
}
