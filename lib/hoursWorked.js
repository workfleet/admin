// The one definition of "hours worked" for a cleaner.
//
// The same figure drives the holiday accrual on the rota and the totals on
// the cleaner's own hours page, so the rule lives here rather than being
// rewritten per page - two pages disagreeing about someone's hours is the
// kind of bug staff notice and stop trusting the app over.
//
// A job's duration is split evenly across everyone assigned to it: a 2-hour
// job with 2 people counts as 1 hour each, not 2 hours each. This must match
// the server-side enforce_holiday_balance() trigger exactly, or a balance
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

// One cleaner's share of a single job, in hours.
export function jobShareHours(job, assigneeCounts) {
  return (job.duration_minutes || 0) / (assigneeCounts[job.id] || 1) / 60;
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
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
