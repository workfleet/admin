// When a forgotten clock-in can still be put right, and what it should say.
//
// The rules live here rather than in the pages that apply them (the cleaner's
// job page, their hours page, the admin queue, the nudge sweep) so they can't
// drift apart - the failure that matters is a page offering "I worked this"
// on a job the database will then refuse the claim for, which reads to a
// cleaner as the app losing their hours a second time.
//
// Every rule below mirrors the "cleaner insert own" policy in migration 0076.
// Change one, change both.

// How long after a job's start time a cleaner gets prodded about not having
// clocked in. Long enough to cover parking, finding the key safe and getting
// through the door; short enough that they are still standing in the
// building when the phone buzzes, which is the whole point - a nudge they
// can act on costs nobody an approval.
export const NUDGE_AFTER_MINUTES = 15;

// Same fallback the rota and lib/hoursWorked.js use for a job with no
// duration recorded.
const DEFAULT_DURATION_MINUTES = 120;

export function jobEnd(job) {
  return new Date(new Date(job.scheduled_at).getTime()
    + (job.duration_minutes || DEFAULT_DURATION_MINUTES) * 60000);
}

// A job is claimable once it is lost: either reconcile_job_statuses() has
// marked it 'missed', or its allotted time has run out and nobody has loaded
// a page recently enough for that to have happened yet. The second limb is
// not a nicety - reconcile only runs when an admin opens the rota or
// dashboard, so without it a cleaner who notices at 6pm would be told to come
// back later by an app that is simply behind.
export function isClaimableMissedJob(job, now = new Date()) {
  if (!job || !job.scheduled_at) return false;
  if (job.status === 'missed') return true;
  return job.status === 'scheduled' && jobEnd(job) < now;
}

// What to put in the form before they touch it. The booked times are the
// right answer on nearly every claim - it is the same figure payroll would
// have paid had the button been pressed - so the honest thing is to offer it
// and let them correct it, not to make them reconstruct their own day.
export function defaultClaimWindow(job) {
  return { from: new Date(job.scheduled_at), to: jobEnd(job) };
}

// The claim has to describe work that has finished. Declaring a shift you
// have not worked yet is a booking, not a record, and 0076 refuses it.
export function claimWindowError({ from, to }, now = new Date()) {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return 'Enter the time you started.';
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) return 'Enter the time you finished.';
  if (to <= from) return 'The finish time needs to be after the start time.';
  if (to > now) return "That finish time is in the future - a shift can only be recorded once it's done.";
  return null;
}

// Which of a cleaner's jobs are silently missing from their pay, newest
// first. Drives the prompt on the hours page: the page they open to check a
// payslip is the one place they are already thinking about whether the
// figure is right.
export function unpaidMissedJobs(jobs, claims = [], now = new Date()) {
  // A job with a pending claim is already in someone's queue, and a job with
  // an approved one is 'completed' and counted - neither is still lost.
  const spokenFor = new Set(
    claims.filter((c) => c.status !== 'declined').map((c) => c.job_id)
  );
  return jobs
    .filter((j) => isClaimableMissedJob(j, now) && !spokenFor.has(j.id))
    .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
}
