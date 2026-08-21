'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, Users, Building2, MapPin, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { getWorkAnniversaryYears } from '../../lib/workAnniversary';
import { needsReorder } from '../../lib/inventory';
import WorkAnniversaryPopup from '../components/WorkAnniversaryPopup';
import BackButton from '../components/BackButton';

function formatTimeRange(scheduledAt, durationMinutes) {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + (durationMinutes || 120) * 60000);
  const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fmt(start)} – ${fmt(end)}`;
}

// Sorted by urgency then date, a category with a lot of rows in it - a dozen
// expiring certs, say - fills every visible slot and hides everything else.
// Sort inside each kind as before, then deal the kinds out round-robin so the
// top of the list always spans what's actually going on. Kinds appear in the
// order their most pressing item would have come in the flat sort.
function interleaveByKind(items) {
  const byUrgencyThenDate = (a, b) => (b.urgent - a.urgent) || (new Date(a.at) - new Date(b.at));
  const groups = [];
  const groupIndex = new Map();
  items.slice().sort(byUrgencyThenDate).forEach((item) => {
    if (!groupIndex.has(item.kind)) {
      groupIndex.set(item.kind, groups.length);
      groups.push([]);
    }
    groups[groupIndex.get(item.kind)].push(item);
  });
  const out = [];
  for (let i = 0; groups.some((g) => g.length > i); i += 1) {
    groups.forEach((g) => { if (g[i]) out.push(g[i]); });
  }
  return out;
}

// Payroll weeks run Friday through the following Thursday (inclusive),
// matching the rota's actual weekly cycle - "This Week" is always
// recomputed from the current time, so it naturally resets right at
// 12am Friday without needing any separate reset step.
function getWeekRange(weekOffset) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToFriday = (day - 5 + 7) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diffToFriday + weekOffset * 7);
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

function HoursRing({ completedHours, totalHours }) {
  const pct = totalHours > 0 ? Math.min(completedHours / totalHours, 1) : 0;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <svg width={116} height={116} viewBox="0 0 116 116">
      <circle cx={58} cy={58} r={radius} fill="none" stroke="var(--hairline)" strokeWidth={10} />
      <circle
        cx={58} cy={58} r={radius} fill="none" stroke="var(--brand-primary)" strokeWidth={10}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 58 58)" style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
      <text x={58} y={54} textAnchor="middle" fontSize={20} fontWeight={800} fill="var(--ink)">
        {completedHours.toFixed(1)}
      </text>
      <text x={58} y={71} textAnchor="middle" fontSize={11} fill="var(--muted)">
        of {totalHours.toFixed(1)}h
      </text>
    </svg>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [greetingName, setGreetingName] = useState('');
  const [role, setRole] = useState(null);
  const [anniversary, setAnniversary] = useState(null);
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({ todaysJobs: 0, todaysCompleted: 0, staffWorking: 0, clients: 0, sites: 0, unassigned: 0 });
  const [todaysJobs, setTodaysJobs] = useState([]);
  const [upcomingJobs, setUpcomingJobs] = useState([]);
  const [attention, setAttention] = useState([]);
  const [detailItem, setDetailItem] = useState(null);
  const [staffGlance, setStaffGlance] = useState({ working: [], holiday: [], off: [], total: 0 });
  const [glanceDetail, setGlanceDetail] = useState(null);

  const [payrollPeriod, setPayrollPeriod] = useState('this_week');
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollRows, setPayrollRows] = useState([]);
  const [payrollTotals, setPayrollTotals] = useState({ completedHours: 0, totalHours: 0 });

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    // Payroll hours are admin-only, same as before this redesign - wait
    // until we know the caller's own role before deciding whether to load
    // it at all, since supervisors shouldn't see it even loading.
    if (role === 'admin') loadPayroll();
  }, [payrollPeriod, role]);

  const loadPayroll = async () => {
    setPayrollLoading(true);
    const { start, end } = PAYROLL_PERIODS[payrollPeriod].range();

    const { data: allRows } = await supabase
      .from('job_assignments')
      .select('cleaner_id, profiles(full_name), jobs!inner(id, duration_minutes, status, scheduled_at)')
      .gte('jobs.scheduled_at', start.toISOString())
      .lt('jobs.scheduled_at', end.toISOString());

    // A job's duration is split evenly across everyone assigned to it, so
    // a 2-hour job with 2 people counts as 1 hour each - not 2 hours each.
    const assigneeCounts = {};
    (allRows || []).forEach((row) => {
      assigneeCounts[row.jobs.id] = (assigneeCounts[row.jobs.id] || 0) + 1;
    });

    const totals = {};
    let totalMinutes = 0;
    let completedMinutes = 0;
    (allRows || []).forEach((row) => {
      const shareMinutes = (row.jobs.duration_minutes || 0) / assigneeCounts[row.jobs.id];
      totalMinutes += shareMinutes;
      if (row.jobs.status === 'completed') {
        completedMinutes += shareMinutes;
        const key = row.cleaner_id;
        if (!totals[key]) totals[key] = { name: row.profiles?.full_name || 'Unknown', jobs: 0, minutes: 0 };
        totals[key].jobs += 1;
        totals[key].minutes += shareMinutes;
      }
    });

    setPayrollRows(Object.values(totals).sort((a, b) => b.minutes - a.minutes));
    setPayrollTotals({ completedHours: completedMinutes / 60, totalHours: totalMinutes / 60 });
    setPayrollLoading(false);
  };

  const loadDashboard = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: ownProfile } = await supabase.from('profiles').select('role, full_name, created_at').eq('id', session.user.id).single();
    setRole(ownProfile?.role || null);
    setGreetingName((ownProfile?.full_name || '').split(' ')[0] || 'there');
    const years = getWorkAnniversaryYears(ownProfile?.created_at);
    if (years) setAnniversary({ name: ownProfile.full_name || 'there', years });

    // Auto-marks overdue jobs missed/completed based on elapsed time,
    // same as the Rota page, so Today's Jobs stays consistent with it.
    await supabase.rpc('reconcile_job_statuses');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const in48h = new Date();
    in48h.setHours(in48h.getHours() + 48);
    const sevenDaysOut = new Date(endOfDay);
    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    const [
      { count: clientsCount },
      { count: sitesCount },
      { data: activeCleaners },
      { data: todaysJobsData },
      { data: nearTermJobs },
      { data: upcomingJobsData },
      { data: openRequests },
      { data: dueReminders },
      { data: openCheckins },
      { data: todaysTimeOff },
      { data: expiringCerts },
      { data: contractClients },
      { data: allProducts },
    ] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('properties').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('id, full_name').eq('role', 'cleaner').eq('active', true),
      supabase.from('jobs')
        .select('id, scheduled_at, status, duration_minutes, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))')
        .gte('scheduled_at', startOfDay.toISOString()).lt('scheduled_at', endOfDay.toISOString())
        .order('scheduled_at', { ascending: true }),
      supabase.from('jobs')
        .select('id, scheduled_at, properties(address), job_assignments(cleaner_id)')
        .gte('scheduled_at', new Date().toISOString()).lt('scheduled_at', in48h.toISOString())
        .neq('status', 'completed').neq('status', 'missed'),
      supabase.from('jobs')
        .select('id, scheduled_at, status, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))')
        .gte('scheduled_at', endOfDay.toISOString()).lt('scheduled_at', sevenDaysOut.toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(6),
      supabase.from('staff_requests')
        .select('id, type, description, created_at, profiles!staff_requests_cleaner_id_fkey(full_name), jobs(scheduled_at, properties(address))')
        .eq('status', 'open')
        .order('created_at', { ascending: true }),
      supabase.from('reminders')
        .select('id, client_id, staff_id, due_date, recurs_yearly, notes, clients(name), staff:profiles!reminders_staff_id_fkey(full_name)')
        .lte('due_date', new Date().toISOString().slice(0, 10))
        .order('due_date', { ascending: true }),
      supabase.from('checkins')
        .select('cleaner_id')
        .gte('checked_in_at', startOfDay.toISOString())
        .is('checked_out_at', null),
      supabase.from('time_off_requests')
        .select('cleaner_id')
        .eq('status', 'approved')
        .lte('start_date', startOfDay.toISOString().slice(0, 10))
        .gte('end_date', startOfDay.toISOString().slice(0, 10)),
      supabase.from('staff_certifications')
        .select('id, name, expiry_date, staff_id, profiles!staff_certifications_staff_id_fkey(full_name)')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', in30Days.toISOString().slice(0, 10)),
      supabase.from('clients')
        .select('id, name, contract_renewal_date, contract_notice_days')
        .not('contract_renewal_date', 'is', null),
      supabase.from('products').select('id, name, stock_level, reorder_threshold'),
    ]);

    const todaysCompleted = (todaysJobsData || []).filter((j) => j.status === 'completed').length;
    const todaysUnassigned = (todaysJobsData || []).filter((j) => (j.job_assignments || []).length === 0).length;

    setStats({
      todaysJobs: (todaysJobsData || []).length,
      todaysCompleted,
      staffWorking: (openCheckins || []).length,
      clients: clientsCount || 0,
      sites: sitesCount || 0,
      unassigned: todaysUnassigned,
    });
    setTodaysJobs(todaysJobsData || []);
    setUpcomingJobs(upcomingJobsData || []);

    const workingIds = new Set((openCheckins || []).map((c) => c.cleaner_id));
    const holidayIds = new Set((todaysTimeOff || []).map((t) => t.cleaner_id));
    const working = [], holiday = [], off = [];
    (activeCleaners || []).forEach((c) => {
      const name = c.full_name || 'Unknown';
      if (workingIds.has(c.id)) working.push(name);
      else if (holidayIds.has(c.id)) holiday.push(name);
      else off.push(name);
    });
    setStaffGlance({ working, holiday, off, total: (activeCleaners || []).length });

    const unassignedNearTerm = (nearTermJobs || []).filter((j) => (j.job_assignments || []).length === 0);
    const lowStock = (allProducts || []).filter(needsReorder);
    const outOfStock = lowStock.filter((p) => p.stock_level === 0);
    const attentionItems = [
      ...(openRequests || []).map((r) => ({
        id: `req-${r.id}`,
        kind: 'request',
        rawId: r.id,
        requestType: r.type,
        title: r.type === 'kit_topup' ? 'Kit top-up requested' : 'Issue reported',
        subtitle: `${r.description} · ${r.profiles?.full_name || 'A cleaner'}`,
        description: r.description,
        cleanerName: r.profiles?.full_name || 'A cleaner',
        jobAddress: r.jobs?.properties?.address || null,
        jobTime: r.jobs?.scheduled_at || null,
        urgent: false,
        at: r.created_at,
      })),
      ...(dueReminders || []).map((r) => {
        const isClient = !!r.client_id;
        const name = isClient ? r.clients?.name : r.staff?.full_name;
        return {
          id: `rem-${r.id}`,
          kind: 'reminder',
          rawId: r.id,
          recursYearly: r.recurs_yearly,
          title: isClient ? 'Client review due' : '1:1 review due',
          name: name || 'Unknown',
          href: isClient ? `/admin/clients/${r.client_id}` : `/admin/cleaners/${r.staff_id}`,
          subtitle: `due ${new Date(r.due_date).toLocaleDateString()}`,
          urgent: new Date(r.due_date) < startOfDay,
          at: r.due_date,
        };
      }),
      ...unassignedNearTerm.map((j) => ({
        id: `unassigned-${j.id}`,
        kind: 'unassigned',
        title: 'Job has no cleaner assigned',
        subtitle: `${j.properties?.address || 'Unknown property'} · ${new Date(j.scheduled_at).toLocaleString()}`,
        href: '/admin/rota',
        urgent: true,
        at: j.scheduled_at,
      })),
      ...(expiringCerts || []).map((c) => {
        const expired = new Date(c.expiry_date) < startOfDay;
        return {
          id: `cert-${c.id}`,
          kind: 'cert',
          title: expired ? 'Certification expired' : 'Certification expiring soon',
          subtitle: `${c.name} · ${c.profiles?.full_name || 'Unknown'} · ${expired ? 'expired' : 'expires'} ${new Date(c.expiry_date).toLocaleDateString()}`,
          href: `/admin/cleaners/${c.staff_id}`,
          urgent: expired,
          at: c.expiry_date,
        };
      }),
      ...(contractClients || [])
        .filter((c) => {
          const noticeStart = new Date(c.contract_renewal_date);
          noticeStart.setDate(noticeStart.getDate() - (c.contract_notice_days || 0));
          return new Date() >= noticeStart;
        })
        .map((c) => ({
          id: `contract-${c.id}`,
          kind: 'contract',
          title: 'Contract renewal due',
          subtitle: `${c.name} · renews ${new Date(c.contract_renewal_date).toLocaleDateString()}`,
          href: `/admin/clients/${c.id}`,
          urgent: new Date(c.contract_renewal_date) < startOfDay,
          at: c.contract_renewal_date,
        })),
      // One row for the lot. Listed individually these crowd out every other
      // kind of item, and the fix for all of them is the same trip to Inventory.
      ...(lowStock.length > 0 ? [{
        id: 'stock-low',
        kind: 'stock',
        title: lowStock.length === 1
          ? 'Low stock'
          : `${lowStock.length} items low on stock`,
        subtitle: lowStock.length === 1
          ? `${lowStock[0].name} · ${lowStock[0].stock_level} left (reorder at ${lowStock[0].reorder_threshold})`
          : [
              // Only worth calling out when it's some of them - if every item
              // is at zero the count just repeats the title.
              outOfStock.length > 0 && outOfStock.length < lowStock.length
                ? `${outOfStock.length} out of stock`
                : null,
              lowStock.slice(0, 3).map((p) => p.name).join(', ')
                + (lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ''),
            ].filter(Boolean).join(' · '),
        href: '/admin/inventory',
        urgent: outOfStock.length > 0,
        at: new Date().toISOString(),
      }] : []),
    ];
    setAttention(interleaveByKind(attentionItems));

    setLoading(false);
  };

  const completeTodo = async (rawId) => {
    setAttention((prev) => prev.filter((a) => a.id !== `req-${rawId}`));
    const { data: { session } } = await supabase.auth.getSession();
    await supabase
      .from('staff_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: session.user.id })
      .eq('id', rawId);
  };

  const completeReminder = async (item) => {
    setAttention((prev) => prev.filter((a) => a.id !== item.id));
    if (item.recursYearly) {
      const next = new Date(item.at);
      next.setFullYear(next.getFullYear() + 1);
      const nextDate = next.toISOString().slice(0, 10);
      await supabase.from('reminders').update({ due_date: nextDate }).eq('id', item.rawId);
    } else {
      await supabase.from('reminders').delete().eq('id', item.rawId);
    }
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page-inner">
      <BackButton />
      {anniversary && <WorkAnniversaryPopup name={anniversary.name} years={anniversary.years} />}
      <div className="page-header-row">
        <div>
          <h1>{timeGreeting}, {greetingName}</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'var(--wf-ash)' }}><ClipboardList size={18} color="var(--wf-steel)" /></div>
          </div>
          <div className="stat-number">{stats.todaysJobs}</div>
          <div className="stat-label">Today's jobs</div>
          <div className="stat-sublabel">{stats.todaysCompleted} completed</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'rgba(52, 199, 123, 0.16)' }}><Users size={18} color="var(--wf-verified-ink)" /></div>
          </div>
          <div className="stat-number">{stats.staffWorking}</div>
          <div className="stat-label">Working now</div>
          <div className="stat-sublabel" />
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'var(--wf-ash)' }}><Building2 size={18} color="var(--wf-steel)" /></div>
          </div>
          <div className="stat-number">{stats.clients}</div>
          <div className="stat-label">Clients</div>
          <div className="stat-sublabel" />
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'var(--wf-ash)' }}><MapPin size={18} color="var(--wf-steel)" /></div>
          </div>
          <div className="stat-number">{stats.sites}</div>
          <div className="stat-label">Sites</div>
          <div className="stat-sublabel" />
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: stats.unassigned > 0 ? 'rgba(216, 30, 52, 0.12)' : 'var(--wf-ash)' }}>
              <UserX size={18} color={stats.unassigned > 0 ? 'var(--wf-overdue)' : 'var(--wf-steel)'} />
            </div>
          </div>
          <div className="stat-number">{stats.unassigned}</div>
          <div className="stat-label">Unassigned</div>
          <div className="stat-sublabel">today</div>
        </div>
      </div>

      <div className="dash-grid-2">
        <div className="card">
          <div className="dash-panel-header">
            <h2>Today's Jobs</h2>
            <Link href="/admin/rota" className="dash-panel-link">View full schedule &rarr;</Link>
          </div>
          <div className="dash-panel-list">
            {todaysJobs.length === 0 && <p className="empty-state">No jobs scheduled today.</p>}
            {todaysJobs.map((job) => {
              const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
              const unassigned = names.length === 0;
              return (
                <div key={job.id} className="dash-row" onClick={() => router.push('/admin/rota')}>
                  <div>
                    <div className="dash-row-title">{job.properties?.clients?.name || job.properties?.address}</div>
                    <div className="dash-row-subtitle">
                      {formatTimeRange(job.scheduled_at, job.duration_minutes)} · {unassigned ? 'Unassigned' : names.join(', ')}
                    </div>
                  </div>
                  <span className={`badge ${unassigned ? 'missed' : job.status}`}>
                    {unassigned ? 'Assign Cleaner' : job.status.replace('_', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="dash-panel-header">
            <h2>Needs Attention</h2>
          </div>
          <div className="dash-panel-list">
            {attention.length === 0 && <p className="empty-state">Nothing needs attention right now.</p>}
            {attention.slice(0, 6).map((item) => {
              if (item.kind === 'request') {
                return (
                  <div key={item.id} className="dash-row" onClick={() => setDetailItem(item)}>
                    <input
                      type="checkbox"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => completeTodo(item.rawId)}
                      style={{ width: 18, height: 18, marginRight: 10, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div className="dash-row-title">{item.title}</div>
                      <div className="dash-row-subtitle">{item.subtitle}</div>
                    </div>
                  </div>
                );
              }
              if (item.kind === 'reminder') {
                return (
                  <div key={item.id} className="dash-row" style={{ cursor: 'default' }}>
                    <div>
                      <div className="dash-row-title" style={item.urgent ? { color: 'var(--wf-overdue)' } : undefined}>
                        {item.title} — <Link href={item.href} style={{ color: 'var(--brand-link)', textDecoration: 'none' }}>{item.name}</Link>
                      </div>
                      <div className="dash-row-subtitle">{item.subtitle}</div>
                    </div>
                    <button className="btn-secondary" onClick={() => completeReminder(item)} title="Mark this reminder done and clear it off your dashboard">Done</button>
                  </div>
                );
              }
              return (
                <Link key={item.id} href={item.href} className="dash-row">
                  <div>
                    <div className="dash-row-title" style={item.urgent ? { color: 'var(--wf-overdue)' } : undefined}>{item.title}</div>
                    <div className="dash-row-subtitle">{item.subtitle}</div>
                  </div>
                </Link>
              );
            })}
          </div>
          {attention.length > 6 && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '8px 0 0' }}>+{attention.length - 6} more</p>
          )}
        </div>
      </div>

      <div className="dash-grid-3" style={role === 'admin' ? undefined : { gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {role === 'admin' && (
          <div className="card">
            <div className="dash-panel-header">
              <h2>Staff Hours</h2>
              <select
                value={payrollPeriod}
                onChange={(e) => setPayrollPeriod(e.target.value)}
                style={{ width: 'auto', margin: 0, padding: '6px 10px', fontSize: 13 }}
              >
                {Object.entries(PAYROLL_PERIODS).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 12px' }}>
              <HoursRing completedHours={payrollTotals.completedHours} totalHours={payrollTotals.totalHours} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', marginBottom: payrollRows.length > 0 ? 12 : 0 }}>
              <div><strong style={{ display: 'block', color: 'var(--ink)', fontSize: 14 }}>{payrollTotals.completedHours.toFixed(1)}h</strong>Completed</div>
              <div><strong style={{ display: 'block', color: 'var(--ink)', fontSize: 14 }}>{payrollTotals.totalHours.toFixed(1)}h</strong>Scheduled</div>
              <div><strong style={{ display: 'block', color: 'var(--ink)', fontSize: 14 }}>{Math.max(payrollTotals.totalHours - payrollTotals.completedHours, 0).toFixed(1)}h</strong>Remaining</div>
            </div>
            {!payrollLoading && payrollRows.slice(0, 4).map((r) => (
              <div key={r.name} className="dash-row" style={{ cursor: 'default', padding: '6px 0' }}>
                <span style={{ fontSize: 13 }}>{r.name}</span>
                <strong style={{ fontSize: 13 }}>{(r.minutes / 60).toFixed(1)}h</strong>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="dash-panel-header">
            <h2>Staff at a Glance</h2>
          </div>
          <div
            className="dash-glance-row"
            style={{ cursor: staffGlance.working.length > 0 ? 'pointer' : 'default' }}
            onClick={() => staffGlance.working.length > 0 && setGlanceDetail({ title: 'Working now', names: staffGlance.working })}
          >
            <span className="dash-glance-dot" style={{ background: 'var(--wf-verified)' }} />
            <strong>{staffGlance.working.length}</strong> Working now
          </div>
          <div
            className="dash-glance-row"
            style={{ cursor: staffGlance.holiday.length > 0 ? 'pointer' : 'default' }}
            onClick={() => staffGlance.holiday.length > 0 && setGlanceDetail({ title: 'On holiday / leave', names: staffGlance.holiday })}
          >
            <span className="dash-glance-dot" style={{ background: 'var(--wf-steel)' }} />
            <strong>{staffGlance.holiday.length}</strong> On holiday / leave
          </div>
          <div
            className="dash-glance-row"
            style={{ cursor: staffGlance.off.length > 0 ? 'pointer' : 'default' }}
            onClick={() => staffGlance.off.length > 0 && setGlanceDetail({ title: 'Not working today', names: staffGlance.off })}
          >
            <span className="dash-glance-dot" style={{ background: 'var(--wf-steel)' }} />
            <strong>{staffGlance.off.length}</strong> Not working today
          </div>
          <Link href="/admin/cleaners" className="dash-panel-link" style={{ display: 'inline-block', alignSelf: 'flex-start', marginTop: 8 }}>
            View staff &rarr;
          </Link>
        </div>

        <div className="card">
          <div className="dash-panel-header">
            <h2>Upcoming Jobs</h2>
            <Link href="/admin/rota" className="dash-panel-link">View calendar &rarr;</Link>
          </div>
          <div className="dash-panel-list">
            {upcomingJobs.length === 0 && <p className="empty-state">Nothing scheduled in the next week.</p>}
            {upcomingJobs.map((job) => {
              const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
              const unassigned = names.length === 0;
              return (
                <div key={job.id} className="dash-row" onClick={() => router.push('/admin/rota')}>
                  <div>
                    <div className="dash-row-title">{job.properties?.clients?.name || job.properties?.address}</div>
                    <div className="dash-row-subtitle">
                      {new Date(job.scheduled_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' · '}{new Date(job.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                  </div>
                  <span className={`badge ${unassigned ? 'missed' : 'scheduled'}`}>
                    {unassigned ? 'Needs Cleaner' : 'Scheduled'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {detailItem && (
        <div className="job-modal-overlay" onClick={() => setDetailItem(null)}>
          <div className="card job-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dash-panel-header">
              <h2>{detailItem.title}</h2>
              <button type="button" className="job-form-close" onClick={() => setDetailItem(null)}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>
              {detailItem.requestType === 'kit_topup' ? 'Kit top-up' : 'Issue'} · {detailItem.cleanerName}
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
              Requested {new Date(detailItem.at).toLocaleString()}
            </p>
            <div className="card" style={{ background: 'var(--wf-ash)', boxShadow: 'none', margin: '0 0 16px' }}>
              <p style={{ fontSize: 14.5, margin: 0, lineHeight: 1.5 }}>{detailItem.description}</p>
            </div>
            {detailItem.jobAddress && (
              <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 16px' }}>
                Related job: {detailItem.jobAddress}
                {detailItem.jobTime && ` · ${new Date(detailItem.jobTime).toLocaleString()}`}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setDetailItem(null)}>Close</button>
              <button
                type="button"
                onClick={() => { completeTodo(detailItem.rawId); setDetailItem(null); }}
                title="Tick this off your to-do list"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        </div>
      )}

      {glanceDetail && (
        <div className="confirm-overlay" onClick={() => setGlanceDetail(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{glanceDetail.title}</h2>
            <p style={{ margin: '0 0 4px' }}>{glanceDetail.names.length} cleaner{glanceDetail.names.length === 1 ? '' : 's'}</p>
            <div style={{ margin: '12px 0 20px' }}>
              {glanceDetail.names.map((name) => (
                <div key={name} style={{ fontSize: 14.5, padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>{name}</div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setGlanceDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
