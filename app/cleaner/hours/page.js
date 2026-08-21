'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clock, CalendarDays, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import {
  HOLIDAY_ACCRUAL_RATE,
  fetchAssigneeCounts,
  jobShareHours,
  formatHours,
} from '../../../lib/hoursWorked';
import BackButton from '../../components/BackButton';

// Months are keyed off the cleaner's own clock, not UTC - a 1am job on the
// 1st belongs to the month they actually worked it.
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Completed jobs grouped into months, newest first, each month's jobs newest
// first - the order someone reads in when they're checking the most recent
// pay period against a payslip.
function groupByMonth(completedJobs, assigneeCounts) {
  const months = new Map();

  completedJobs.forEach((job) => {
    const date = new Date(job.scheduled_at);
    const key = monthKey(date);
    if (!months.has(key)) months.set(key, { key, label: monthLabel(date), hours: 0, jobs: [] });
    const month = months.get(key);
    const hours = jobShareHours(job, assigneeCounts);
    month.hours += hours;
    month.jobs.push({
      id: job.id,
      date,
      address: job.properties?.address || 'Job',
      hours,
      sharedWith: (assigneeCounts[job.id] || 1) - 1,
    });
  });

  const list = [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
  list.forEach((m) => m.jobs.sort((a, b) => b.date - a.date));
  return list;
}

export default function CleanerHours() {
  const router = useRouter();
  const [months, setMonths] = useState([]);
  const [totals, setTotals] = useState({ hours: 0, jobs: 0, scheduledThisMonth: 0 });
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: assignmentRows } = await supabase
      .from('job_assignments')
      .select('jobs(id, scheduled_at, status, duration_minutes, properties(address))')
      .eq('cleaner_id', session.user.id);

    const jobs = (assignmentRows || []).map((row) => row.jobs).filter(Boolean);
    const assigneeCounts = await fetchAssigneeCounts(jobs.map((j) => j.id));

    const completed = jobs.filter((j) => j.status === 'completed');
    const grouped = groupByMonth(completed, assigneeCounts);

    // Work still to come this month is worth showing next to what's banked,
    // but it isn't worked yet and never counts towards the totals.
    const thisMonth = monthKey(new Date());
    const scheduledThisMonth = jobs
      .filter((j) => (j.status === 'scheduled' || j.status === 'in_progress')
        && monthKey(new Date(j.scheduled_at)) === thisMonth)
      .reduce((sum, j) => sum + jobShareHours(j, assigneeCounts), 0);

    setMonths(grouped);
    setTotals({
      hours: grouped.reduce((sum, m) => sum + m.hours, 0),
      jobs: completed.length,
      scheduledThisMonth,
    });
    // The month they're most likely to be checking is open on arrival; the
    // rest stay collapsed so the page opens as a summary, not a wall of jobs.
    setExpanded(grouped[0]?.key ?? null);
    setLoading(false);
  };

  if (loading) return <div className="container">Loading...</div>;

  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthHours = months.find((m) => m.key === monthKey(now))?.hours || 0;
  const lastMonthHours = months.find((m) => m.key === monthKey(lastMonthDate))?.hours || 0;
  const busiestMonthHours = months.reduce((max, m) => Math.max(max, m.hours), 0);

  return (
    <div className="container">
      <BackButton />
      <h1>My Hours</h1>

      <div className="card" style={{ textAlign: 'center' }}>
        <div
          className="stat-card-icon"
          style={{ margin: '0 auto 10px', '--stat-tint': 'var(--wf-teal-tint)', '--stat-ink': 'var(--wf-teal-ink)' }}
        >
          <Clock size={18} />
        </div>
        <div className="stat-number" style={{ fontSize: 40, color: 'var(--wf-teal-ink)' }}>
          {formatHours(totals.hours)}
        </div>
        <div className="stat-label" style={{ marginTop: 8 }}>Total hours worked</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>
          Across {totals.jobs} completed job{totals.jobs === 1 ? '' : 's'}
        </p>
      </div>

      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat-card stat-jobs">
          <div className="stat-card-top">
            <div className="stat-card-icon"><CalendarDays size={18} /></div>
          </div>
          <div className="stat-number">{formatHours(thisMonthHours)}</div>
          <div className="stat-label">{now.toLocaleDateString(undefined, { month: 'long' })}</div>
          <div className="stat-sublabel">
            {totals.scheduledThisMonth > 0 ? `${formatHours(totals.scheduledThisMonth)} still to come` : 'so far'}
          </div>
        </div>
        <div className="stat-card stat-unassigned">
          <div className="stat-card-top">
            <div className="stat-card-icon"><CalendarDays size={18} /></div>
          </div>
          <div className="stat-number">{formatHours(lastMonthHours)}</div>
          <div className="stat-label">{lastMonthDate.toLocaleDateString(undefined, { month: 'long' })}</div>
          <div className="stat-sublabel">last month</div>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--wf-ash)' }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          These hours build up your holiday at {(HOLIDAY_ACCRUAL_RATE * 100).toFixed(2)}% —
          that's <strong>{formatHours(totals.hours * HOLIDAY_ACCRUAL_RATE)}</strong> earned so far.
        </p>
        <p style={{ fontSize: 12.5, margin: '6px 0 0' }}>
          <Link href="/cleaner/rota" style={{ color: 'var(--brand-link)', fontWeight: 600, textDecoration: 'none' }}>
            See your holiday balance and book time off →
          </Link>
        </p>
      </div>

      <h2 style={{ marginTop: 24, marginBottom: 4 }}>Month by month</h2>

      {months.length === 0 ? (
        <p className="empty-state">No completed jobs yet — your hours will appear here as you finish them.</p>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
          Tap a month to see the jobs behind it.
        </p>
      )}

      {months.map((month) => {
        const open = expanded === month.key;
        return (
          <div key={month.key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setExpanded(open ? null : month.key)}
              aria-expanded={open}
              aria-label={`${month.label}, ${formatHours(month.hours)} across ${month.jobs.length} job${month.jobs.length === 1 ? '' : 's'}`}
              style={{
                width: '100%', border: 'none', borderRadius: 0, background: 'transparent', color: 'inherit',
                padding: '14px 16px', textAlign: 'left', display: 'block', cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {month.label}
                </span>
                <span style={{ fontFamily: 'var(--wf-data)', fontSize: 15, fontWeight: 600, color: 'var(--wf-teal-ink)' }}>
                  {formatHours(month.hours)}
                </span>
              </span>
              {/* Each month's bar is drawn against the busiest month, so a
                  year of work has a shape you can read at a glance. */}
              <span
                aria-hidden="true"
                style={{ display: 'block', height: 4, borderRadius: 2, background: 'var(--hairline)', marginTop: 10 }}
              >
                <span
                  style={{
                    display: 'block', height: '100%', borderRadius: 2, background: 'var(--wf-teal-ink)',
                    width: `${busiestMonthHours > 0 ? (month.hours / busiestMonthHours) * 100 : 0}%`,
                  }}
                />
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginTop: 6, fontWeight: 400 }}>
                {month.jobs.length} job{month.jobs.length === 1 ? '' : 's'}
              </span>
            </button>

            {open && (
              <div style={{ borderTop: '1px solid var(--hairline)', padding: '4px 16px 12px' }}>
                {month.jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/cleaner/jobs/${job.id}`}
                    className="task-row"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', gap: 8 }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{job.address}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>
                        {job.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                        {job.sharedWith > 0 && (
                          <>
                            {' · '}
                            <Users size={11} style={{ verticalAlign: -1 }} />
                            {` shared with ${job.sharedWith} other${job.sharedWith === 1 ? '' : 's'}`}
                          </>
                        )}
                      </span>
                    </span>
                    <span style={{ fontFamily: 'var(--wf-data)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatHours(job.hours)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '16px 0 0' }}>
        Hours come from each job's allocated time. A job you shared with someone
        else is split evenly between you, so a 2-hour job for two people counts as
        1 hour each. If something looks wrong, message the office.
      </p>
    </div>
  );
}
