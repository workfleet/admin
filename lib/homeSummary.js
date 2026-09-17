// What the cleaner's home page says about their day and their numbers.
//
// The page used to open on a request form and never mentioned the day's
// work. These helpers turn one cleaner's assignment rows into the few
// things they actually open the app for: what's next, what else is on
// today, and the three figures they'd otherwise go looking for on the
// hours and rota pages. Pure, so the day boundaries and the week arithmetic
// can be tested without a browser.
import { hoursWorked, jobShareHours } from './hoursWorked';

// "Morning" until noon, "afternoon" until 6pm, "evening" after that. Read
// off the cleaner's own clock - the greeting is the first thing they see.
export function greetingFor(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// The name someone actually gets called - "Sarah", not "Sarah Jane Smith".
export function firstNameOf(fullName) {
  const first = (fullName || '').trim().split(/\s+/)[0];
  return first || 'there';
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Splits a cleaner's jobs into what the top of the home page shows.
//
//   current   - the job they're clocked in to right now, if any. Shown as a
//               banner ahead of everything else because the one thing they
//               need while on site is the way back to that job's page.
//   upNext    - the next scheduled job from now on, whatever day it's on.
//               A cleaner with nothing left today still wants to know
//               tomorrow's first call.
//   today     - every job dated today, earliest first, whatever its status,
//               so a finished morning still shows as done rather than
//               vanishing.
//
// `jobs` must already be sorted by scheduled_at ascending, as the rota does.
export function splitJobsForHome(jobs, now = new Date()) {
  const current = jobs.find((j) => j.status === 'in_progress') || null;
  const today = jobs.filter((j) => sameLocalDay(new Date(j.scheduled_at), now));
  const upNext = jobs.find((j) =>
    j.status === 'scheduled' && (
      new Date(j.scheduled_at) >= now
      // A job booked for earlier today that nobody has started yet is still
      // "next" - it's what they're late for, not something to hide.
      || sameLocalDay(new Date(j.scheduled_at), now)
    )
  ) || null;
  return { current, upNext, today };
}

// Monday 00:00 local of the week `now` falls in. Rotas here run Monday to
// Sunday, so "this week" has to as well, not the Sunday-first week
// JavaScript's getDay() implies.
export function startOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
}

// Hours from completed jobs dated this week, on the same share rule as the
// hours page and the holiday balance, so all three figures agree.
export function hoursThisWeek(jobs, assigneeCounts, now = new Date()) {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const inWeek = jobs.filter((j) => {
    const at = new Date(j.scheduled_at);
    return at >= start && at < end;
  });
  return hoursWorked(inWeek, assigneeCounts);
}

// Hours still booked for this week - scheduled or in progress - so the tile
// can say "6h 30m worked, 4h to go" rather than a lone figure that reads as
// a poor week on a Tuesday.
export function hoursLeftThisWeek(jobs, assigneeCounts, now = new Date()) {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return jobs
    .filter((j) => j.status === 'scheduled' || j.status === 'in_progress')
    .filter((j) => {
      const at = new Date(j.scheduled_at);
      return at >= start && at < end;
    })
    .reduce((sum, j) => sum + jobShareHours(j, assigneeCounts), 0);
}

export function jobsCompletedThisMonth(jobs, now = new Date()) {
  return jobs.filter((j) => {
    if (j.status !== 'completed') return false;
    const at = new Date(j.scheduled_at);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  }).length;
}

// One line under the greeting: "2 jobs today, next at 9:00am" and the
// honest alternatives. Kept here so the wording is tested rather than
// assembled inline from three ternaries.
export function daySummary({ today, upNext, current }, now = new Date()) {
  const clock = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (current) return `You're clocked in at ${current.properties?.address || 'a job'}`;
  const count = today.length;
  const remaining = today.filter((j) => j.status === 'scheduled');
  if (count === 0) {
    if (!upNext) return 'Nothing on the rota yet';
    const at = new Date(upNext.scheduled_at);
    const dayWord = sameLocalDay(at, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
      ? 'tomorrow'
      : at.toLocaleDateString(undefined, { weekday: 'long' });
    return `Nothing today - next job ${dayWord} at ${clock(at)}`;
  }
  const jobsWord = count === 1 ? 'job' : 'jobs';
  if (remaining.length === 0) return `${count} ${jobsWord} today, all done`;
  return `${count} ${jobsWord} today, next at ${clock(remaining[0].scheduled_at)}`;
}
