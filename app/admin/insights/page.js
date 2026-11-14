'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { fetchAllRows } from '../../../lib/fetchAllRows';
import { withoutTestAccounts, isTestAccount } from '../../../lib/testAccounts';
import { buildInsights, lastWeeks, WINDOW_DAYS } from '../../../lib/insights';
import { ColumnChart, RankedBars, MeterList, StatTile, VIZ } from '../../components/Charts';
import { PageSkeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';

// Twelve weeks of the business at a glance: hours worked, visits done and
// missed, the clients taking the most time, and who arrives on time.
// Admin-only, like Payroll - it is built from everyone's hours.
const TOP_CLIENTS = 8;
const MIN_CLOCKINS = 3; // fewer than this and a percentage says nothing

const hoursFmt = (v) => (v >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toLocaleString());
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const shortDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function Insights() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, allowed: false, error: false, data: null });

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    const { data: me } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (me?.role !== 'admin') { setState({ loading: false, allowed: false, error: false, data: null }); return; }

    const now = new Date();
    const from = lastWeeks(now)[0];
    // On time compares the last four weeks with the four before.
    const checkinsFrom = new Date(now.getTime() - 2 * WINDOW_DAYS * 86400000);

    const [jobs, assignments, checkins] = await Promise.all([
      fetchAllRows(() => supabase
        .from('jobs')
        .select('id, scheduled_at, status, duration_minutes, property_id, properties(client_id, clients(name))')
        .gte('scheduled_at', from.toISOString())
        .lt('scheduled_at', now.toISOString())
        .not('property_id', 'is', null)
        .order('id')),
      fetchAllRows(() => supabase
        .from('job_assignments')
        .select('job_id, cleaner_id, paid_minutes, jobs!inner(id, duration_minutes, status, scheduled_at)')
        .gte('jobs.scheduled_at', from.toISOString())
        .lt('jobs.scheduled_at', now.toISOString())
        .order('job_id')
        .order('cleaner_id')),
      fetchAllRows(() => supabase
        .from('checkins')
        .select('id, job_id, cleaner_id, checked_in_at')
        .gte('checked_in_at', checkinsFrom.toISOString())
        .order('id')),
    ]);
    if (jobs.error || assignments.error || checkins.error) {
      setState({ loading: false, allowed: true, error: true, data: null });
      return;
    }

    // The Test Cleaner account never counts towards the team's figures.
    const staffAssignments = (assignments.data || []).filter((a) => !isTestAccount(a.cleaner_id));
    const staffCheckins = (checkins.data || []).filter((c) => !isTestAccount(c.cleaner_id));
    const ids = [...new Set(staffCheckins.map((c) => c.cleaner_id))];
    const { data: people } = ids.length
      ? await supabase.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] };
    const names = new Map(withoutTestAccounts(people || []).map((p) => [p.id, p.full_name || 'Unnamed']));

    setState({
      loading: false,
      allowed: true,
      error: false,
      data: buildInsights({ jobs: jobs.data || [], assignments: staffAssignments, checkins: staffCheckins, names, now }),
    });
  };

  if (state.loading) return <PageSkeleton variant="dashboard" />;

  if (!state.allowed) {
    return (
      <div className="page-inner">
        <h1>Insights</h1>
        <EmptyState icon={BarChart3} title="For admins only" body="Insights are built from everyone's hours, so only admins can open them." />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="page-inner">
        <h1>Insights</h1>
        <EmptyState icon={BarChart3} title="Couldn't load the figures" body="Check the connection and try again." action={{ label: 'Try again', onClick: () => { setState((s) => ({ ...s, loading: true })); load(); } }} />
      </div>
    );
  }

  const { hoursByWeek, visitsByWeek, clients, punctuality, kpis, weeks } = state.data;
  const lastIndex = weeks.length - 1;
  const weekLabel = (d) => shortDate(d);
  const weekSub = (d) => `Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;

  const hoursData = hoursByWeek.map((w, i) => ({
    label: weekLabel(w.weekStart), sublabel: weekSub(w.weekStart), values: { hours: w.hours }, partial: i === lastIndex,
  }));
  const visitsData = visitsByWeek.map((w, i) => ({
    label: weekLabel(w.weekStart), sublabel: weekSub(w.weekStart), values: { completed: w.completed, missed: w.missed }, partial: i === lastIndex,
  }));
  const topClients = clients.slice(0, TOP_CLIENTS);
  const otherClients = clients.slice(TOP_CLIENTS);
  const onTimeRows = punctuality.filter((p) => p.total >= MIN_CLOCKINS);
  const period = 'the 4 weeks before';

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Insights</h1>
          <p className="page-subtitle">The last 12 weeks at a glance. Figures are the last 4 weeks unless a chart says otherwise.</p>
        </div>
      </div>

      <p className="insights-compare">Last 4 weeks; arrows compare with the 4 weeks before.</p>
      <div className="insights-stats">
        <StatTile label="Hours worked" value={hoursFmt(kpis.hours.now)} now={kpis.hours.now} before={kpis.hours.before} formatDelta={(d) => `${d > 0 ? '+' : '−'}${hoursFmt(Math.abs(d))}h`} period={period} />
        <StatTile label="Visits completed" value={kpis.visits.now.toLocaleString()} now={kpis.visits.now} before={kpis.visits.before} formatDelta={(d) => `${d > 0 ? '+' : '−'}${Math.abs(d)}`} period={period} />
        <StatTile label="Visits missed" value={pct(kpis.missedRate.now)} now={kpis.missedRate.now} before={kpis.missedRate.before} upIsGood={false} formatDelta={(d) => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pts`} period={period} />
        <StatTile label="Arrived on time" value={pct(kpis.onTimeRate.now)} now={kpis.onTimeRate.now} before={kpis.onTimeRate.before} formatDelta={(d) => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} pts`} period={period} />
      </div>

      <div className="insights-grid">
        <section className="card insights-card">
          <h2>Hours worked</h2>
          <p className="insights-note">Each week, from finished visits, split as payroll splits them. This week is so far.</p>
          <ColumnChart
            caption="Week"
            data={hoursData}
            series={[{ key: 'hours', label: 'Hours', colour: VIZ.blue }]}
            format={hoursFmt}
          />
        </section>

        <section className="card insights-card">
          <h2>Visits</h2>
          <p className="insights-note">Each week, done and missed. This week is so far.</p>
          <ColumnChart
            caption="Week"
            data={visitsData}
            series={[
              { key: 'completed', label: 'Completed', colour: VIZ.blue },
              { key: 'missed', label: 'Missed', colour: VIZ.red },
            ]}
            format={(v) => Math.round(v).toLocaleString()}
          />
        </section>

        <section className="card insights-card">
          <h2>Clients by hours</h2>
          <p className="insights-note">Booked length of finished visits, last 4 weeks.</p>
          {topClients.length === 0 ? (
            <EmptyState compact icon={BarChart3} title="No finished visits in the last 4 weeks" />
          ) : (
            <>
              <RankedBars
                rows={topClients.map((c) => ({ key: c.id, label: c.name, value: c.hours, note: `${c.visits} visit${c.visits === 1 ? '' : 's'}` }))}
                format={(v) => `${hoursFmt(v)}h`}
              />
              {otherClients.length > 0 && (
                <p className="insights-note" style={{ margin: '10px 0 0' }}>
                  + {otherClients.length} more client{otherClients.length === 1 ? '' : 's'}, {hoursFmt(otherClients.reduce((s, c) => s + c.hours, 0))}h between them
                </p>
              )}
            </>
          )}
        </section>

        <section className="card insights-card">
          <h2>Arriving on time</h2>
          <p className="insights-note">Clocked in within 5 minutes of the start, last 4 weeks. Staff with {MIN_CLOCKINS} or more clock-ins.</p>
          {onTimeRows.length === 0 ? (
            <EmptyState compact icon={BarChart3} title="Not enough clock-ins yet" />
          ) : (
            <MeterList rows={onTimeRows.map((p) => ({ key: p.id, label: p.name, value: p.rate, figure: `${p.onTime} of ${p.total} · ${pct(p.rate)}` }))} />
          )}
        </section>
      </div>
    </div>
  );
}
