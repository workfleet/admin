'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Clock, CalendarDays, ChevronDown, ChevronRight, Users, AlertTriangle, Lock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import {
  HOLIDAY_ACCRUAL_RATE,
  assignedJob,
  fetchAssigneeCounts,
  jobShareHours,
  formatHours,
} from '../../../lib/hoursWorked';
import { unpaidMissedJobs } from '../../../lib/missedClockin';
import { periodLabel, monthLabelIfWhole, parseLocalDate } from '../../../lib/payroll';
import BackButton from '../../components/BackButton';

// The periods the office has closed that this cleaner was paid in, newest
// first, with the hours that went out under their name - lines plus any
// adjustments carried on that run. This is what turns "my payslip is wrong"
// into a question asked while it can still be fixed.
function groupPayroll(lineRows, adjustmentRows) {
  const periods = new Map();
  const periodFor = (p) => {
    if (!periods.has(p.id)) {
      periods.set(p.id, {
        id: p.id,
        start: p.period_start,
        end: p.period_end,
        closedAt: new Date(p.closed_at),
        minutes: 0,
        jobs: 0,
        adjustments: [],
      });
    }
    return periods.get(p.id);
  };

  lineRows.forEach((row) => {
    if (!row.payroll_periods) return;
    const period = periodFor(row.payroll_periods);
    period.minutes += Number(row.minutes);
    period.jobs += 1;
  });

  const pending = [];
  adjustmentRows.forEach((row) => {
    if (row.included_in_period_id && row.period) {
      const period = periodFor(row.period);
      period.minutes += Number(row.minutes);
      period.adjustments.push(row);
    } else if (!row.included_in_period_id) {
      pending.push(row);
    }
  });

  const sent = [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
  return { sent, pending };
}

function payrollPeriodName(period) {
  return monthLabelIfWhole(period) || periodLabel(period, { withYear: false });
}

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
  // Shifts that have quietly fallen out of the total above. This is the page
  // someone opens to check a payslip, so it's the one place a shortfall has
  // to be visible rather than merely absent.
  const [missed, setMissed] = useState([]);
  const [payroll, setPayroll] = useState({ sent: [], pending: [] });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: assignmentRows } = await supabase
      .from('job_assignments')
      .select('paid_minutes, jobs(id, scheduled_at, status, duration_minutes, properties(address))')
      .eq('cleaner_id', session.user.id);

    const jobs = (assignmentRows || []).map(assignedJob).filter(Boolean);
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

    const [{ data: claimRows }, { data: outcomeRows }, { data: payrollLines }, { data: payrollAdjustments }] = await Promise.all([
      supabase
        .from('missed_clockin_claims')
        .select('job_id, status')
        .eq('cleaner_id', session.user.id),
      // Missed shifts the office has already accounted for (0093) - not
      // worth prompting them to claim a visit the client called off.
      supabase
        .from('missed_shift_outcomes')
        .select('job_id, outcome')
        .eq('cleaner_id', session.user.id),
      supabase
        .from('payroll_period_lines')
        .select('minutes, payroll_periods(id, period_start, period_end, closed_at)')
        .eq('cleaner_id', session.user.id),
      supabase
        .from('payroll_adjustments')
        .select('id, minutes, reason, job_address, job_date, included_in_period_id, period:payroll_periods!payroll_adjustments_included_in_period_id_fkey(id, period_start, period_end, closed_at)')
        .eq('cleaner_id', session.user.id)
        .order('created_at', { ascending: false }),
    ]);

    setPayroll(groupPayroll(payrollLines || [], payrollAdjustments || []));

    setMissed(unpaidMissedJobs(jobs, claimRows || [], new Date(), outcomeRows || []).map((job) => ({
      id: job.id,
      date: new Date(job.scheduled_at),
      address: job.properties?.address || 'Job',
      hours: jobShareHours(job, assigneeCounts),
    })));

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
        {/* stat-hours carries the hue, the same as an hours tile on the admin
            dashboard - the figure itself stays neutral ink like every other
            figure in the app, so the colour lives in one place only. */}
        <div className="stat-card-icon stat-hours" style={{ margin: '0 auto 10px' }}>
          <Clock size={18} />
        </div>
        <div className="stat-number" style={{ fontSize: 40 }}>
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

      {/* What the office has actually sent. Once a period is here it is
          locked: a change to it does not alter the figure shown, it arrives
          as an adjustment on the next run, and that is spelled out so nobody
          watches a total move and wonders why. */}
      {(payroll.sent.length > 0 || payroll.pending.length > 0) && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Lock size={16} />
            <strong style={{ fontSize: 14 }}>Sent to payroll</strong>
          </div>
          {payroll.sent.length === 0 ? (
            <p style={{ fontSize: 13, margin: 0, color: 'var(--muted)' }}>Nothing sent yet.</p>
          ) : (
            <p style={{ fontSize: 13, margin: 0, color: 'var(--muted)' }}>
              These periods are locked. If a figure looks wrong, message the office — any change goes on the next run.
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            {payroll.sent.slice(0, 6).map((period) => (
              <div key={period.id} className="task-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{payrollPeriodName(period)}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>
                    Sent {period.closedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {period.jobs > 0 ? ` · ${period.jobs} job${period.jobs === 1 ? '' : 's'}` : ''}
                    {period.adjustments.length > 0
                      ? ` · includes ${period.adjustments.length} adjustment${period.adjustments.length === 1 ? '' : 's'}`
                      : ''}
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--wf-data)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatHours(period.minutes / 60)}
                </span>
              </div>
            ))}
          </div>
          {payroll.pending.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>On your next run</span>
              {payroll.pending.map((adj) => {
                const minutes = Number(adj.minutes);
                return (
                  <div key={adj.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--muted)' }}>
                      {adj.job_address || 'Job'}
                      {adj.job_date ? `, ${parseLocalDate(adj.job_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                      {' — '}{adj.reason}
                    </span>
                    <span style={{ fontFamily: 'var(--wf-data)', fontWeight: 600, whiteSpace: 'nowrap', color: minutes < 0 ? 'var(--wf-overdue)' : 'inherit' }}>
                      {minutes < 0 ? '-' : '+'}{formatHours(Math.abs(minutes) / 60)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Overdue red, not verified green: nothing here has been proven yet,
          and --wf-verified is reserved for things that have been. */}
      {missed.length > 0 && (
        <div
          className="card"
          style={{ background: 'var(--wf-overdue-bg)', borderLeft: '3px solid var(--wf-overdue)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <AlertTriangle size={16} />
            <strong style={{ fontSize: 14 }}>
              {missed.length} shift{missed.length === 1 ? '' : 's'} not counted
            </strong>
          </div>
          <p style={{ fontSize: 13, margin: 0 }}>
            Nobody clocked in on {missed.length === 1 ? 'this one' : 'these'}, so{' '}
            <strong>{formatHours(missed.reduce((sum, j) => sum + j.hours, 0))}</strong> is missing
            from the total above — and from the holiday it would have earned. If you worked{' '}
            {missed.length === 1 ? 'it' : 'them'}, open the shift and tell the office.
          </p>
          <div style={{ marginTop: 10 }}>
            {missed.map((job) => (
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
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--wf-data)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatHours(job.hours)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

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
                <span style={{ fontFamily: 'var(--wf-data)', fontSize: 15, fontWeight: 600 }}>
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
                    display: 'block', height: '100%', borderRadius: 2, background: 'var(--wf-azure)',
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
