// The one definition of "hours worked" for a cleaner.
//
// The same figure drives the holiday accrual on the rota and the totals on
// the cleaner's own hours page, so the rule lives here rather than being
// rewritten per page - two pages disagreeing about someone's hours is the
// kind of bug staff notice and stop trusting the app over.
//
// A job's duration is split evenly across everyone assigned to it: a 2-hour
// job with 2 people counts as 1 hour each, not 2 hours each - unless the
// office has set that person's minutes for the job by hand
// (job_assignments.paid_minutes, 0094), in which case that is the figure.
// This must match assignment_paid_minutes() in the database exactly, which
// is what enforce_holiday_balance() and the payroll close read, or a balance
// shown here would mislead staff about what they can request.
//
// Duration comes from the job's duration_minutes rather than the
// checkin/checkout timestamps, because checkout is sometimes never recorded
// and duration_minutes is always present.
import { supabase } from './supabaseClient';

export const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

// Knowing "am I on this job" isn't enough to split its hours - the share
// depends on how many people in total are on it, which takes a second query
// against every teammate's assignment rows for the same jobs.
export async function fetchAssigneeCounts(jobIds) {
  if (jobIds.length === 0) return {};
  const { data } = await supabase.from('job_assignments').select('job_id').in('job_id', jobIds);
  const counts = {};
  (data || []).forEach((row) => {
    counts[row.job_id] = (counts[row.job_id] || 0) + 1;
  });
  return counts;
}

// One cleaner's share of a single job, in hours. `job.paid_minutes` is that
// person's override for the job, if any - see assignedJob() below for how
// it gets there.
export function jobShareHours(job, assigneeCounts) {
  if (job.paid_minutes != null) return job.paid_minutes / 60;
  return (job.duration_minutes || 0) / (assigneeCounts[job.id] || 1) / 60;
}

// A job_assignments row selected as `paid_minutes, jobs(...)` for one
// cleaner, turned into the job object the functions here read - the job
// with that person's override carried on it. Null when the row has no job
// (a deleted one the embed could not follow).
export function assignedJob(row) {
  if (!row?.jobs) return null;
  return { ...row.jobs, paid_minutes: row.paid_minutes ?? null };
}

// The same rule for code that works from assignment rows directly rather
// than job objects: one row's minutes given how many people share the job.
export function assignmentMinutes(row, assigneeCounts) {
  if (row.paid_minutes != null) return row.paid_minutes;
  return (row.jobs?.duration_minutes || 0) / (assigneeCounts[row.jobs?.id] || 1);
}

export function hoursWorked(jobs, assigneeCounts) {
  return jobs
    .filter((j) => j.status === 'completed')
    .reduce((sum, j) => sum + jobShareHours(j, assigneeCounts), 0);
}

// Whole hours and minutes read better than a decimal for a figure someone is
// checking against a payslip - "6h 30m", not "6.5h".
export function formatHours(hours) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (totalMinutes === 0) return '0h'; // "0m" reads like a rounding error
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
