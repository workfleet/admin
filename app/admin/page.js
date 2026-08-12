'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h}h `;
  if (m > 0) label += `${m}m`;
  return label.trim();
}

// UK payroll weeks run Monday-Sunday.
function getWeekRange(weekOffset) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + diffToMonday + weekOffset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function getMonthRange(monthOffset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);
  return { start, end };
}

const PAYROLL_PERIODS = {
  this_week: { label: 'This Week', range: () => getWeekRange(0) },
  last_week: { label: 'Last Week', range: () => getWeekRange(-1) },
  this_month: { label: 'This Month', range: () => getMonthRange(0) },
  last_month: { label: 'Last Month', range: () => getMonthRange(-1) },
};

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState({ clients: 0, properties: 0, cleaners: 0, jobsThisWeek: 0, unassigned: 0 });
  const [todaysJobs, setTodaysJobs] = useState([]);
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [payrollPeriod, setPayrollPeriod] = useState('this_week');
  const [payrollRows, setPayrollRows] = useState([]);
  const [payrollLoading, setPayrollLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadPayroll();
  }, [payrollPeriod]);

  const loadPayroll = async () => {
    setPayrollLoading(true);
    const { start, end } = PAYROLL_PERIODS[payrollPeriod].range();

    const { data } = await supabase
      .from('jobs')
      .select('cleaner_id, duration_minutes, profiles(full_name)')
      .eq('status', 'completed')
      .not('cleaner_id', 'is', null)
      .gte('scheduled_at', start.toISOString())
      .lt('scheduled_at', end.toISOString());

    const totals = {};
    (data || []).forEach((j) => {
      const key = j.cleaner_id;
      if (!totals[key]) totals[key] = { name: j.profiles?.full_name || 'Unknown', jobs: 0, minutes: 0 };
      totals[key].jobs += 1;
      totals[key].minutes += j.duration_minutes || 0;
    });

    const rows = Object.values(totals).sort((a, b) => b.minutes - a.minutes);
    setPayrollRows(rows);
    setPayrollLoading(false);
  };

  const loadDashboard = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: todoData } = await supabase
      .from('staff_requests')
      .select('id, type, description, created_at, profiles(full_name)')
      .eq('status', 'open')
      .order('created_at', { ascending: true });
    setTodos(todoData || []);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const endOfWeek = new Date(startOfDay);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [
      { count: clientsCount },
      { count: propertiesCount },
      { count: cleanersCount },
      { count: jobsThisWeekCount },
      { count: unassignedCount },
      { data: todaysJobsData },
    ] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('properties').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'cleaner'),
      supabase.from('jobs').select('*', { count: 'exact', head: true })
        .gte('scheduled_at', startOfDay.toISOString()).lt('scheduled_at', endOfWeek.toISOString()),
      supabase.from('jobs').select('*', { count: 'exact', head: true })
        .gte('scheduled_at', startOfDay.toISOString()).lt('scheduled_at', endOfWeek.toISOString())
        .is('cleaner_id', null),
      supabase.from('jobs')
        .select('id, scheduled_at, status, duration_minutes, properties(address), profiles(full_name)')
        .gte('scheduled_at', startOfDay.toISOString()).lt('scheduled_at', endOfDay.toISOString())
        .order('scheduled_at', { ascending: true }),
    ]);

    setStats({
      clients: clientsCount || 0,
      properties: propertiesCount || 0,
      cleaners: cleanersCount || 0,
      jobsThisWeek: jobsThisWeekCount || 0,
      unassigned: unassignedCount || 0,
    });
    setTodaysJobs(todaysJobsData || []);
    setLoading(false);
  };

  const completeTodo = async (id) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await supabase
      .from('staff_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', id);
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {todos.length > 0 && (
        <div className="card" style={{ background: '#fffbeb', marginBottom: 20 }}>
          <h2>To-Do ({todos.length})</h2>
          {todos.map((t) => (
            <label key={t.id} className="task-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                onChange={() => completeTodo(t.id)}
                style={{ width: 18, height: 18, marginRight: 10, flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 14 }}>
                <strong>{t.type === 'kit_topup' ? 'Kit Top-up' : 'Issue'}</strong> — {t.description}
                <br />
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                  {t.profiles?.full_name || 'A cleaner'} · {new Date(t.created_at).toLocaleString()}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-number">{stats.clients}</div>
          <div className="stat-label">Clients</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.properties}</div>
          <div className="stat-label">Properties</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.cleaners}</div>
          <div className="stat-label">Cleaners</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.jobsThisWeek}</div>
          <div className="stat-label">Jobs this week</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{stats.unassigned}</div>
          <div className="stat-label">Unassigned</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
          <h2 style={{ margin: 0 }}>Payroll — Hours Worked</h2>
          <select
            value={payrollPeriod}
            onChange={(e) => setPayrollPeriod(e.target.value)}
            style={{ width: 'auto', margin: 0 }}
          >
            {Object.entries(PAYROLL_PERIODS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>

        {payrollLoading && <p className="empty-state">Loading...</p>}

        {!payrollLoading && payrollRows.length === 0 && (
          <p className="empty-state">No completed jobs in this period.</p>
        )}

        {!payrollLoading && payrollRows.length > 0 && (
          <>
            {payrollRows.map((r) => (
              <div key={r.name} className="task-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>
                  {r.name}{' '}
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    · {r.jobs} job{r.jobs !== 1 ? 's' : ''}
                  </span>
                </span>
                <strong style={{ fontSize: 14 }}>{(r.minutes / 60).toFixed(1)}h</strong>
              </div>
            ))}
            <div
              className="task-row"
              style={{ justifyContent: 'space-between', borderTop: '2px solid var(--hairline)', borderBottom: 'none', marginTop: 2, paddingTop: 12 }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>Total</span>
              <strong style={{ fontSize: 14 }}>
                {(payrollRows.reduce((sum, r) => sum + r.minutes, 0) / 60).toFixed(1)}h
              </strong>
            </div>
          </>
        )}
      </div>

      <h2>Today's Jobs</h2>
      {todaysJobs.length === 0 && <p className="empty-state">No jobs scheduled today.</p>}
      <div className="job-list">
        {todaysJobs.map((job) => (
          <div key={job.id} className="card job-card">
            <div>
              <h2>{job.properties?.address}</h2>
              <p className="job-time">
                {new Date(job.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {' · '}{formatDuration(job.duration_minutes || 120)}
                {' · '}{job.profiles?.full_name || 'Unassigned'}
              </p>
              <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
