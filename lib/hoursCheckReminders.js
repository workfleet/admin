// "You didn't clock in yesterday - did you work it?"
//
// Staff already have a way to put a forgotten clock-in right themselves: the
// "I worked this" form on the job page (0076), which the office then
// approves. Hardly anyone used it. In the three weeks to 19 Nov 2026, 33 of
// 34 missed-clock-in claims were typed in by the office, decided within a
// minute of being made. The form was there; nobody was told about it at the
// moment it mattered. The 15-minute clock-in nudge fires during the shift,
// and the weekly "payroll closes tomorrow" message is generic and late.
//
// So the morning after a shift nobody clocked into, everyone on it hears
// about that shift by name, with a link straight to the form. Once per
// person per shift: the bell row carries the job (notifications.job_id,
// 0145), and a row already there for that person and job means they have
// been told. 0145's triggers take the row down again once the job is
// completed (an approved claim does that), so it does not linger.
//
// Pure: the server half (lib/hoursCheckRemindersServer.js) fetches and
// sends.

import { isClaimableMissedJob } from './missedClockin';

// Long enough to cover a weekend nobody opened the app; short enough that a
// first run doesn't dig up shifts that have already been paid or argued
// over. Payroll is weekly, so a week back is one pay period.
export const LOOKBACK_DAYS = 7;

// Every reminder starts with this, and the server matches on it to tell
// these apart from the clock-in nudge, which carries the same job_id.
export const MESSAGE_PREFIX = 'No hours recorded for';

export function siteName(job) {
  const client = job?.properties?.clients?.name;
  if (client) return client;
  const address = job?.properties?.address;
  if (address) return address.split(',')[0].trim();
  return 'your shift';
}

// Server-side, so the zone has to be spelled out: the server runs in UTC,
// and a reminder naming the wrong day is worse than none.
export function shiftWhen(scheduledAt) {
  const d = new Date(scheduledAt);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${day} ${time}`;
}

export function reminderMessage(job) {
  return `${MESSAGE_PREFIX} ${siteName(job)} on ${shiftWhen(job.scheduled_at)} - you didn't clock in. If you worked it, open the shift and tap "I worked this" to add your times.`;
}

// Who to remind about which shift.
//
// jobs: recent jobs with job_assignments(cleaner_id).
// claims: missed_clockin_claims rows (job_id, cleaner_id, status) for them.
// outcomes: missed_shift_outcomes rows (job_id, cleaner_id) - the office has
//   already said why that person wasn't paid (off sick, client cancelled),
//   so there is nothing to ask them.
// alreadyTold: notifications rows (job_id, user_id) already sent.
// recipients: ids allowed to get one (active, bookable, not test accounts).
//
// Returns [{ cleanerId, job }], newest shift first.
export function hoursCheckReminders({ jobs = [], claims = [], outcomes = [], alreadyTold = [], recipients = [], now = new Date() }) {
  const key = (jobId, cleanerId) => `${jobId}:${cleanerId}`;
  const done = new Set();
  // A pending claim is already with the office; an approved one has made the
  // job completed. A declined claim is the office's answer, not a reason to
  // ask again.
  claims.forEach((c) => done.add(key(c.job_id, c.cleaner_id)));
  outcomes.forEach((o) => done.add(key(o.job_id, o.cleaner_id)));
  alreadyTold.forEach((n) => done.add(key(n.job_id, n.user_id)));
  const allowed = new Set(recipients);
  const floor = now.getTime() - LOOKBACK_DAYS * 86400000;

  const out = [];
  for (const job of jobs) {
    if (!job?.scheduled_at || new Date(job.scheduled_at).getTime() < floor) continue;
    // The same test the claim form and its database policy use, so nobody is
    // sent to a form that would then refuse them.
    if (!isClaimableMissedJob(job, now)) continue;
    for (const a of job.job_assignments || []) {
      if (!a?.cleaner_id || !allowed.has(a.cleaner_id)) continue;
      if (done.has(key(job.id, a.cleaner_id))) continue;
      out.push({ cleanerId: a.cleaner_id, job });
    }
  }
  return out.sort((a, b) => new Date(b.job.scheduled_at) - new Date(a.job.scheduled_at));
}

// One push per person however many shifts they missed, so a bad week is one
// buzz rather than four. One shift opens that shift; several open My Hours,
// which lists them all.
export function pushFor(reminders) {
  if (reminders.length === 1) {
    const { job } = reminders[0];
    return {
      title: 'Did you work this shift?',
      body: `You didn't clock in at ${siteName(job)} on ${shiftWhen(job.scheduled_at)}. Tap to add your hours.`,
      tag: `hours-check-${job.id}`,
      url: `/cleaner/jobs/${job.id}`,
    };
  }
  return {
    title: `${reminders.length} shifts with no hours`,
    body: "You didn't clock in on these. Tap to add the hours you worked.",
    tag: `hours-check-${reminders[0].job.id}`,
    url: '/cleaner/hours',
  };
}
