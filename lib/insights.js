// The figures behind the Insights page: twelve weeks of hours and visits,
// the clients taking the most time, and who arrives on time.
//
// Pure functions over rows the page has already fetched, so the arithmetic
// is testable and the page only draws. Hours follow the payroll rules
// (lib/hoursWorked.js): a shared job splits its length between the people
// on it unless the office set someone's minutes. On time follows the
// cleaner page (lib/clockIn.js): up to LATE_GRACE_MINUTES after the start.
import { assignmentMinutes } from './hoursWorked';
import { lateMinutes } from './clockIn';

export const WEEKS = 12;
export const WINDOW_DAYS = 28;
const DAY_MS = 86400000;

// Monday 00:00 local of the week containing `date`.
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

// The Monday of each of the last `n` weeks, oldest first, this week last.
export function lastWeeks(now = new Date(), n = WEEKS) {
  const current = weekStart(now);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(current);
    d.setDate(d.getDate() - (n - 1 - i) * 7);
    return d;
  });
}

// Index into `weeks` for a date, or -1 outside the range.
function weekIndexOf(date, weeks) {
  const t = new Date(date).getTime();
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (t >= weeks[i].getTime()) {
      const end = new Date(weeks[i]);
      end.setDate(end.getDate() + 7);
      return t < end.getTime() ? i : -1;
    }
  }
  return -1;
}

function assigneeCountsOf(assignments) {
  const counts = {};
  for (const row of assignments) {
    const id = row.jobs?.id ?? row.job_id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function inWindow(date, from, to) {
  const t = new Date(date).getTime();
  return t >= from.getTime() && t < to.getTime();
}

// jobs:        { id, scheduled_at, status, duration_minutes, properties: { client_id, clients: { name } } }
// assignments: { job_id, cleaner_id, paid_minutes, jobs: { id, duration_minutes, status, scheduled_at } }
// checkins:    { job_id, cleaner_id, checked_in_at }
// names:       Map cleaner_id -> full name
export function buildInsights({ jobs = [], assignments = [], checkins = [], names = new Map(), now = new Date() }) {
  const weeks = lastWeeks(now);
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const previousStart = new Date(windowStart.getTime() - WINDOW_DAYS * DAY_MS);

  // ---- hours worked each week (completed work, payroll shares)
  const counts = assigneeCountsOf(assignments);
  const hoursByWeek = weeks.map((w) => ({ weekStart: w, hours: 0 }));
  let hoursNow = 0;
  let hoursBefore = 0;
  for (const row of assignments) {
    if (row.jobs?.status !== 'completed') continue;
    const minutes = assignmentMinutes(row, counts);
    const i = weekIndexOf(row.jobs.scheduled_at, weeks);
    if (i >= 0) hoursByWeek[i].hours += minutes / 60;
    if (inWindow(row.jobs.scheduled_at, windowStart, now)) hoursNow += minutes / 60;
    else if (inWindow(row.jobs.scheduled_at, previousStart, windowStart)) hoursBefore += minutes / 60;
  }

  // ---- visits each week: done and missed
  const visitsByWeek = weeks.map((w) => ({ weekStart: w, completed: 0, missed: 0 }));
  const tally = { now: { completed: 0, missed: 0 }, before: { completed: 0, missed: 0 } };
  const clientMinutes = new Map();
  const jobById = new Map();
  for (const job of jobs) {
    jobById.set(job.id, job);
    if (job.status !== 'completed' && job.status !== 'missed') continue;
    const i = weekIndexOf(job.scheduled_at, weeks);
    if (i >= 0) visitsByWeek[i][job.status] += 1;
    const bucket = inWindow(job.scheduled_at, windowStart, now) ? tally.now
      : inWindow(job.scheduled_at, previousStart, windowStart) ? tally.before : null;
    if (bucket) bucket[job.status] += 1;

    // ---- client time: the visit's booked length, once per visit
    if (job.status === 'completed' && bucket === tally.now) {
      const id = job.properties?.client_id;
      if (!id) continue;
      const entry = clientMinutes.get(id) || { id, name: job.properties?.clients?.name || 'Unknown client', minutes: 0, visits: 0 };
      entry.minutes += job.duration_minutes || 0;
      entry.visits += 1;
      clientMinutes.set(id, entry);
    }
  }
  const clients = [...clientMinutes.values()]
    .map((c) => ({ ...c, hours: c.minutes / 60 }))
    .sort((a, b) => b.hours - a.hours);

  // ---- on time: first clock-in per person per visit, against its start
  const firstIn = new Map();
  for (const c of checkins) {
    const key = `${c.job_id}:${c.cleaner_id}`;
    const prev = firstIn.get(key);
    if (!prev || new Date(c.checked_in_at) < new Date(prev.checked_in_at)) firstIn.set(key, c);
  }
  const people = new Map();
  const onTimeTally = { now: { on: 0, all: 0 }, before: { on: 0, all: 0 } };
  for (const c of firstIn.values()) {
    const job = jobById.get(c.job_id);
    if (!job) continue;
    const late = lateMinutes(c.checked_in_at, job.scheduled_at);
    if (late == null) continue;
    const onTime = late <= 0;
    if (inWindow(job.scheduled_at, windowStart, now)) {
      onTimeTally.now.all += 1;
      if (onTime) onTimeTally.now.on += 1;
      const p = people.get(c.cleaner_id) || { id: c.cleaner_id, name: names.get(c.cleaner_id) || 'Unknown', onTime: 0, total: 0 };
      p.total += 1;
      if (onTime) p.onTime += 1;
      people.set(c.cleaner_id, p);
    } else if (inWindow(job.scheduled_at, previousStart, windowStart)) {
      onTimeTally.before.all += 1;
      if (onTime) onTimeTally.before.on += 1;
    }
  }
  const punctuality = [...people.values()]
    .map((p) => ({ ...p, rate: p.total ? p.onTime / p.total : 0 }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);

  const rate = (num, den) => (den > 0 ? num / den : null);
  return {
    weeks,
    hoursByWeek,
    visitsByWeek,
    clients,
    punctuality,
    kpis: {
      hours: { now: hoursNow, before: hoursBefore },
      visits: { now: tally.now.completed, before: tally.before.completed },
      missedRate: {
        now: rate(tally.now.missed, tally.now.completed + tally.now.missed),
        before: rate(tally.before.missed, tally.before.completed + tally.before.missed),
      },
      onTimeRate: {
        now: rate(onTimeTally.now.on, onTimeTally.now.all),
        before: rate(onTimeTally.before.on, onTimeTally.before.all),
      },
    },
  };
}
