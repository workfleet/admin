'use client';

import EmptyState from '../components/EmptyState';
import { CheckCircle2 as EmptyIconCheck } from 'lucide-react';
import { PageSkeleton } from '../components/Skeleton';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronRight, CircleAlert, Package, Wrench, CalendarClock, BadgeCheck, FileText, Boxes, Plus, Check, FileBarChart, KeyRound, RefreshCw, Search, DoorOpen } from 'lucide-react';
import { openSearch } from '../components/SearchPalette';
import { supabase } from '../../lib/supabaseClient';
import { withoutTestAccounts } from '../../lib/testAccounts';
import { BOOKABLE_ROLES } from '../../lib/staffRoles';
import { getSessionWithRetry } from '../../lib/authGate';
import { getWorkAnniversaryYears } from '../../lib/workAnniversary';
import { needsReorder } from '../../lib/inventory';
import { localDateString } from '../../lib/localDate';
import { assignmentMinutes } from '../../lib/hoursWorked';
import WorkAnniversaryPopup from '../components/WorkAnniversaryPopup';
import { abbreviateName } from '../../lib/jobOverlap';
import { shortAddress, nameRepeatsStreet } from '../../lib/shortAddress';
import { overdueRooms, REFRESH_EVERY_DAYS } from '../../lib/roomRefresh';
import { tintFor, tintsByOrder } from '../../lib/avatarTint';

function initialsOf(fullName) {
  return String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function clockOf(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// "just now" / "4 min ago" / "at 14:05" for the dashboard's last update.
function updatedAgo(at) {
  if (!at) return 'just now';
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `at ${clockOf(at)}`;
}

// Where each kind of item sits in Needs attention. A job with nobody on it
// is the only thing here that goes wrong today if it waits; stock is the
// one thing that can always wait for tomorrow, so it never jumps the queue
// however low it runs.
function attentionRank(item) {
  if (item.kind === 'unassigned') return 0;
  if (item.kind === 'stock') return 4;
  if (item.urgent) return 1;
  if (item.kind === 'request') return 2;
  return 3;
}

// How far through a job is, 0 to 1, for the bar under an on-site job.
function progressThrough(job, now) {
  const start = new Date(job.scheduled_at).getTime();
  const length = (job.duration_minutes || 120) * 60000;
  return Math.min(Math.max((now - start) / length, 0), 1);
}

// "1h 37m" until something starts, or how late it is.
function describeGap(ms) {
  const mins = Math.max(Math.round(ms / 60000), 0);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// The street, and whose it is. The client's name alone can't tell TKR's
// twenty-odd houses apart, and the address alone doesn't say whose it is.
function jobWhere(job) {
  const client = job.properties?.clients?.name;
  const street = shortAddress(job.properties?.address);
  // "The Eagle, Swansea" for The Eagle would only say its name twice.
  const sameAsName = client && street && nameRepeatsStreet(client, street);
  return { title: client || street || 'Unknown client', street: client && street && !sameAsName ? street : null };
}

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
  this_week: { label: 'This week', range: () => getWeekRange(0) },
  last_week: { label: 'Last week', range: () => getWeekRange(-1) },
  this_month: { label: 'This month', range: () => getMonthRange(0) },
  last_month: { label: 'Last month', range: () => getMonthRange(-1) },
};

function HoursRing({ completedHours, totalHours }) {
  const pct = totalHours > 0 ? Math.min(completedHours / totalHours, 1) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <svg width={132} height={132} viewBox="0 0 132 132">
      <circle cx={66} cy={66} r={radius} fill="none" stroke="var(--wf-ash)" strokeWidth={12} />
      <circle
        cx={66} cy={66} r={radius} fill="none" stroke="var(--wf-coral)" strokeWidth={12}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 66 66)" style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
      <text
        x={66} y={64} textAnchor="middle" fill="var(--ink)"
        fontFamily="var(--wf-data)" fontSize={26} fontWeight={600}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {completedHours.toFixed(1)}
      </text>
      <text
        x={66} y={82} textAnchor="middle" fill="var(--muted)"
        fontFamily="var(--wf-data)" fontSize={12}
      >
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

  const [stats, setStats] = useState({ todaysJobs: 0, todaysCompleted: 0, staffWorking: 0, openRequests: 0, jobHours: 0, unassigned: 0 });
  const [todaysJobs, setTodaysJobs] = useState([]);
  const [upcomingJobs, setUpcomingJobs] = useState([]);
  const [attention, setAttention] = useState([]);
  const [detailItem, setDetailItem] = useState(null);
  const [staffGlance, setStaffGlance] = useState({ working: [], holiday: [], off: [], total: 0 });
  const [onSiteNow, setOnSiteNow] = useState([]);
  const [glanceDetail, setGlanceDetail] = useState(null);
  // When each on-site job was clocked into, by job id.
  const [checkinByJob, setCheckinByJob] = useState({});
  const [tomorrow, setTomorrow] = useState(null);
  const [teamTints, setTeamTints] = useState(new Map());
  const [noAccessSites, setNoAccessSites] = useState([]);
  const [showNoAccess, setShowNoAccess] = useState(false);
  const [roomsOverdue, setRoomsOverdue] = useState([]);
  const [showRoomsOverdue, setShowRoomsOverdue] = useState(false);

  const [payrollPeriod, setPayrollPeriod] = useState('this_week');
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollRows, setPayrollRows] = useState([]);
  const [payrollTotals, setPayrollTotals] = useState({ completedHours: 0, totalHours: 0, missedHours: 0, pendingClaims: 0 });

  // When the figures were last fetched, so "Nobody clocked in" can be
  // trusted - and a tick to keep "Updated 3 min ago" honest between loads.
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);
  const refreshingRef = useRef(false);
  const updatedAtRef = useRef(null);
  useEffect(() => { updatedAtRef.current = updatedAt; }, [updatedAt]);

  useEffect(() => {
    loadDashboard();
  }, []);

  // Keep the dashboard current without a reload: every two minutes while
  // the tab is in front, and straight away on coming back to it after a
  // while away. Skipped while hidden, so a tab left open overnight costs
  // nothing.
  useEffect(() => {
    const REFRESH_MS = 2 * 60 * 1000;
    const stale = () => !updatedAtRef.current || Date.now() - updatedAtRef.current.getTime() > 60 * 1000;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (document.visibilityState === 'visible' && updatedAtRef.current && Date.now() - updatedAtRef.current.getTime() >= REFRESH_MS) refresh();
    }, 30 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible' && stale()) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const refresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await loadDashboard({ refresh: true });
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Payroll hours are admin-only, same as before this redesign - wait
    // until we know the caller's own role before deciding whether to load
    // it at all, since supervisors shouldn't see it even loading.
    if (role === 'admin') loadPayroll();
  }, [payrollPeriod, role]);

  const loadPayroll = async () => {
    setPayrollLoading(true);
    const { start, end } = PAYROLL_PERIODS[payrollPeriod].range();

    // The period's hours and the claims waiting on a decision, side by side.
    // Claims are separate on purpose: these are hours somebody has already
    // put their hand up for, and the only thing between them and payroll is
    // an admin clicking.
    const [{ data: allRows }, { count: pendingClaims }] = await Promise.all([
      supabase
        .from('job_assignments')
        .select('cleaner_id, paid_minutes, profiles(full_name), jobs!inner(id, duration_minutes, status, scheduled_at)')
        .gte('jobs.scheduled_at', start.toISOString())
        .lt('jobs.scheduled_at', end.toISOString()),
      supabase
        .from('missed_clockin_claims')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]);

    // A job's duration is split evenly across everyone assigned to it, so
    // a 2-hour job with 2 people counts as 1 hour each - not 2 hours each -
    // unless the office has set that person's minutes for the job (0094).
    const assigneeCounts = {};
    (allRows || []).forEach((row) => {
      assigneeCounts[row.jobs.id] = (assigneeCounts[row.jobs.id] || 0) + 1;
    });

    const totals = {};
    let totalMinutes = 0;
    let completedMinutes = 0;
    // Hours in this period that nobody clocked into. They sit inside
    // "Scheduled" and never move to "Completed", so before this they showed
    // up as "Remaining" - which reads as work still to come, right up until
    // the period is a fortnight in the past and it plainly isn't.
    let missedMinutes = 0;
    (allRows || []).forEach((row) => {
      const shareMinutes = assignmentMinutes(row, assigneeCounts);
      totalMinutes += shareMinutes;
      if (row.jobs.status === 'missed') missedMinutes += shareMinutes;
      if (row.jobs.status === 'completed') {
        completedMinutes += shareMinutes;
        const key = row.cleaner_id;
        if (!totals[key]) totals[key] = { name: row.profiles?.full_name || 'Unknown', jobs: 0, minutes: 0 };
        totals[key].jobs += 1;
        totals[key].minutes += shareMinutes;
      }
    });

    setPayrollRows(Object.values(totals).sort((a, b) => b.minutes - a.minutes));
    setPayrollTotals({
      completedHours: completedMinutes / 60,
      totalHours: totalMinutes / 60,
      missedHours: missedMinutes / 60,
      pendingClaims: pendingClaims || 0,
    });
    setPayrollLoading(false);
  };

  // refresh: the quiet re-load every couple of minutes - same figures, no
  // anniversary pop-up again, and no bounce to login if a token blips. The
  // sweeps below still run each time: they are idempotent, and pg_cron was
  // found not to be firing the clock-in nudge (2026-10-06), so a dashboard
  // left open is what keeps nudges going out on time.
  // Rooms and communal areas at tracked properties (0150) not done for a
  // fortnight. On its own, after the rest of the page: before 0150 is run
  // the rooms column doesn't exist and this just shows nothing.
  const loadRoomsOverdue = async () => {
    const { data: houses, error } = await supabase
      .from('properties')
      .select('id, address, client_id, rooms, rooms_tracked_since, clients(name)')
      .not('rooms_tracked_since', 'is', null);
    if (error || !houses || houses.length === 0) { setRoomsOverdue([]); return; }
    // Back far enough for each room's last refresh, forward far enough to
    // see what's already booked - a room booked in time isn't overdue.
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const until = new Date(Date.now() + 42 * 86400000).toISOString();
    const { data: visits, error: visitsError } = await supabase
      .from('jobs')
      .select('id, property_id, scheduled_at, status, room_refreshes')
      .in('property_id', houses.map((h) => h.id))
      .in('status', ['scheduled', 'completed', 'in_progress'])
      .gte('scheduled_at', since)
      .lt('scheduled_at', until);
    if (visitsError) return;
    const byId = new Map(houses.map((h) => [h.id, h]));
    setRoomsOverdue(overdueRooms({ properties: houses, jobs: visits || [], today: localDateString(new Date()) })
      .map((o) => ({ ...o, clientId: byId.get(o.propertyId)?.client_id, clientName: byId.get(o.propertyId)?.clients?.name }))
      .sort((a, b) => b.items.length - a.items.length));
  };

  const loadDashboard = async ({ refresh = false } = {}) => {
    const session = await getSessionWithRetry();
    if (!session) { if (!refresh) router.push('/'); return; }

    // Who is looking, and the status tidy-up, side by side: neither needs
    // the other. The tidy-up auto-marks overdue jobs missed/completed based
    // on elapsed time, same as the Rota page, so Today's Jobs stays
    // consistent with it - it still finishes before the jobs are read below.
    const [{ data: ownProfile }] = await Promise.all([
      supabase.from('profiles').select('role, full_name, created_at').eq('id', session.user.id).single(),
      supabase.rpc('reconcile_job_statuses'),
    ]);
    setRole(ownProfile?.role || null);
    setGreetingName((ownProfile?.full_name || '').split(' ')[0] || 'there');
    const years = getWorkAnniversaryYears(ownProfile?.created_at);
    if (years && !refresh) setAnniversary({ name: ownProfile.full_name || 'there', years });

    // Nudge anyone who's started a shift without clocking in.
    //
    // No longer the only thing that runs the sweep. This used to be it -
    // which meant nudges went out only while an admin had the dashboard open,
    // and on a morning when nobody was at a desk the cleaner standing in the
    // building got nothing. Migration 0112 moved the schedule into the
    // database, where pg_cron fires the same route every fifteen minutes
    // whether or not anyone is looking at a screen.
    //
    // Kept anyway, because an admin opening the dashboard is a free excuse to
    // sweep now rather than up to fifteen minutes from now, and the route is
    // idempotent per job (jobs.clockin_nudge_sent_at) so both firing costs
    // nothing. Same lazy-sweep reasoning as reconcile_job_statuses above.
    fetch('/api/admin/clockin-nudge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {}); // best-effort: never hold up the dashboard for it

    // Accident-book reminders (HSE deadlines, reports left open). Also on
    // the daily cron; sent once each, so both firing costs nothing.
    fetch('/api/admin/incident-reminders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const in48h = new Date();
    in48h.setHours(in48h.getHours() + 48);
    const endOfTomorrow = new Date(endOfDay);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    const sevenDaysOut = new Date(endOfDay);
    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    const [
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
      { data: tomorrowsJobs },
      { data: tomorrowsTimeOff },
      { data: weeksJobs },
    ] = await Promise.all([
      // In name order, so avatar colours are handed out the same way the
      // rota hands them out and a person is one colour on both pages.
      supabase.from('profiles').select('id, full_name').in('role', BOOKABLE_ROLES).eq('active', true).order('full_name'),
      supabase.from('jobs')
        .select('id, scheduled_at, status, duration_minutes, hours_review_needed, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))')
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
        .lte('due_date', localDateString(new Date()))
        .order('due_date', { ascending: true }),
      // Not just how many are on site but who and where - the same row
      // answers the "Working now" figure and the list underneath it.
      supabase.from('checkins')
        .select('cleaner_id, job_id, checked_in_at, profiles(full_name), jobs(properties(address, clients(name)))')
        .gte('checked_in_at', startOfDay.toISOString())
        .is('checked_out_at', null),
      supabase.from('time_off_requests')
        .select('cleaner_id')
        .eq('status', 'approved')
        .lte('start_date', localDateString(startOfDay))
        .gte('end_date', localDateString(startOfDay)),
      supabase.from('staff_certifications')
        .select('id, name, expiry_date, staff_id, profiles!staff_certifications_staff_id_fkey(full_name)')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', localDateString(in30Days)),
      supabase.from('clients')
        .select('id, name, contract_renewal_date, contract_notice_days')
        .not('contract_renewal_date', 'is', null),
      supabase.from('products').select('id, name, stock_level, reorder_threshold'),
      supabase.from('jobs')
        .select('id, scheduled_at, duration_minutes, status, job_assignments(cleaner_id)')
        .gte('scheduled_at', endOfDay.toISOString()).lt('scheduled_at', endOfTomorrow.toISOString())
        .order('scheduled_at', { ascending: true }),
      supabase.from('time_off_requests')
        .select('cleaner_id, type, profiles!time_off_requests_cleaner_id_fkey(full_name)')
        .eq('status', 'approved')
        .lte('start_date', localDateString(endOfDay))
        .gte('end_date', localDateString(endOfDay)),
      // The week's jobs, only to find sites staff will reach with no codes.
      supabase.from('jobs')
        .select('property_id, properties(client_id, address, access_details, client_access_notes, clients(name))')
        .gte('scheduled_at', startOfDay.toISOString()).lt('scheduled_at', sevenDaysOut.toISOString())
        .neq('status', 'completed').neq('status', 'missed'),
    ]);

    // One line per site, not per job - the fix is one Access box per site.
    const noCodes = {};
    (weeksJobs || []).forEach((j) => {
      const p = j.properties;
      if (!p || p.access_details || p.client_access_notes) return;
      if (!noCodes[j.property_id]) noCodes[j.property_id] = { id: j.property_id, clientId: p.client_id, name: p.clients?.name || 'Unknown client', address: p.address, jobs: 0 };
      noCodes[j.property_id].jobs += 1;
    });
    setNoAccessSites(Object.values(noCodes).sort((a, b) => b.jobs - a.jobs));
    loadRoomsOverdue();

    const todaysCompleted = (todaysJobsData || []).filter((j) => j.status === 'completed').length;
    const todaysUnassigned = (todaysJobsData || []).filter((j) => (j.job_assignments || []).length === 0).length;

    // Total length of the day's work, not staff-hours - a job with two cleaners
    // on it is still one slot in the day. Staff Hours below does the splitting.
    //
    // Missed jobs are left out: counting them reports hours of work on a day
    // that work didn't happen. The 120 default is the one used everywhere a
    // job has no duration set, so it reads as the same two hours here as it
    // does on the rota rather than silently contributing nothing.
    const jobHours = (todaysJobsData || [])
      .filter((j) => j.status !== 'missed')
      .reduce((mins, j) => mins + (j.duration_minutes || 120), 0) / 60;

    setStats({
      todaysJobs: (todaysJobsData || []).length,
      todaysCompleted,
      staffWorking: (openCheckins || []).length,
      openRequests: (openRequests || []).length,
      jobHours,
      unassigned: todaysUnassigned,
    });
    setTodaysJobs(todaysJobsData || []);
    setUpcomingJobs(upcomingJobsData || []);

    const workingIds = new Set((openCheckins || []).map((c) => c.cleaner_id));
    const holidayIds = new Set((todaysTimeOff || []).map((t) => t.cleaner_id));
    const working = [], holiday = [], off = [];
    withoutTestAccounts(activeCleaners).forEach((c) => {
      const name = c.full_name || 'Unknown';
      if (workingIds.has(c.id)) working.push(name);
      else if (holidayIds.has(c.id)) holiday.push(name);
      else off.push(name);
    });
    setStaffGlance({ working, holiday, off, total: withoutTestAccounts(activeCleaners).length });
    setTeamTints(tintsByOrder(withoutTestAccounts(activeCleaners).map((c) => c.id)));

    const firstCheckin = {};
    (openCheckins || []).forEach((c) => {
      if (c.job_id && (!firstCheckin[c.job_id] || c.checked_in_at < firstCheckin[c.job_id])) firstCheckin[c.job_id] = c.checked_in_at;
    });
    setCheckinByJob(firstCheckin);

    const tomorrowList = (tomorrowsJobs || []).filter((j) => j.status !== 'missed');
    const lastEnd = tomorrowList.reduce((latest, j) => Math.max(latest, new Date(j.scheduled_at).getTime() + (j.duration_minutes || 120) * 60000), 0);
    setTomorrow({
      date: endOfDay,
      count: tomorrowList.length,
      hours: tomorrowList.reduce((mins, j) => mins + (j.duration_minutes || 120), 0) / 60,
      unassigned: tomorrowList.filter((j) => (j.job_assignments || []).length === 0).length,
      first: tomorrowList[0]?.scheduled_at || null,
      lastEnd: lastEnd ? new Date(lastEnd) : null,
      away: (tomorrowsTimeOff || []).map((t) => t.profiles?.full_name || 'Someone'),
    });

    setOnSiteNow((openCheckins || []).map((c) => ({
      id: c.cleaner_id,
      jobId: c.job_id,
      name: c.profiles?.full_name || 'Unknown',
      place: c.jobs?.properties?.clients?.name || c.jobs?.properties?.address || 'a job',
      since: c.checked_in_at,
    })));

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
      ...(unassignedNearTerm.length > 0 ? [{
        id: 'unassigned',
        kind: 'unassigned',
        title: unassignedNearTerm.length === 1
          ? 'A job needs a cleaner'
          : `${unassignedNearTerm.length} jobs need a cleaner`,
        subtitle: unassignedNearTerm
          .slice(0, 2)
          .map((j) => `${shortAddress(j.properties?.address) || 'Unknown property'} ${new Date(j.scheduled_at).toLocaleDateString(undefined, { weekday: 'short' })} ${clockOf(j.scheduled_at)}`)
          .join(' · ') + (unassignedNearTerm.length > 2 ? ` +${unassignedNearTerm.length - 2} more` : ''),
        href: unassignedNearTerm.length === 1 ? `/admin/rota?job=${unassignedNearTerm[0].id}` : '/admin/rota',
        urgent: true,
        at: unassignedNearTerm[0].scheduled_at,
      }] : []),
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
    // Urgent first, then the round-robin. Interleaving alone can bury a
    // job with nobody on it under a list of certificates that expire next
    // month, purely because certificates are their own kind.
    // Array#sort is stable, so each half keeps its interleaved order.
    setAttention(
      interleaveByKind(attentionItems).sort((a, b) => attentionRank(a) - attentionRank(b))
    );

    setUpdatedAt(new Date());
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

  if (loading) return <PageSkeleton variant="dashboard" />;

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const now = Date.now();
  // A shift that clocked out well short of its booking is held at
  // in_progress for the office to confirm (0079), so status alone can't say
  // who is on site. Held and nobody clocked back in means they've gone.
  const heldJobs = todaysJobs.filter((j) => j.status === 'in_progress' && j.hours_review_needed && !checkinByJob[j.id]);
  const onSiteJobs = todaysJobs.filter((j) => j.status === 'in_progress' && !heldJobs.includes(j));
  const missedJobs = todaysJobs.filter((j) => j.status === 'missed');
  const doneJobs = todaysJobs.filter((j) => j.status === 'completed');
  const comingUp = todaysJobs.filter((j) => j.status === 'scheduled');
  // The next people due on today who haven't started: everyone on the
  // earliest job still to come.
  const nextJob = comingUp.find((j) => new Date(j.scheduled_at).getTime() > now && (j.job_assignments || []).length > 0);
  const nextNames = nextJob ? (nextJob.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean) : [];
  const namesOf = (job) => (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
  const listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  const attentionIcon = (item) => {
    if (item.kind === 'unassigned') return <CircleAlert size={17} />;
    if (item.kind === 'request') return item.requestType === 'kit_topup' ? <Package size={17} /> : <Wrench size={17} />;
    if (item.kind === 'reminder') return <CalendarClock size={17} />;
    if (item.kind === 'cert') return <BadgeCheck size={17} />;
    if (item.kind === 'contract') return <FileText size={17} />;
    return <Boxes size={17} />;
  };
  const attentionTone = (item) => {
    if (item.kind === 'unassigned' || (item.urgent && item.kind !== 'stock')) return 'is-urgent';
    if (item.kind === 'stock') return 'is-stock';
    return '';
  };

  // Needs attention, in order: red items (a job with nobody on it, an
  // expired certificate...) first, then the amber access-code warning,
  // then everything else, each part keeping its own order.
  const shownAttention = attention.slice(0, 6);
  const redAttention = shownAttention.filter((item) => attentionTone(item) === 'is-urgent');
  const otherAttention = shownAttention.filter((item) => attentionTone(item) !== 'is-urgent');

  const renderAttentionItem = (item) => {
    const tone = attentionTone(item);
    const icon = <span className={`dash-att-icon ${tone}`}>{attentionIcon(item)}</span>;
    if (item.kind === 'request') {
      const kit = item.requestType === 'kit_topup';
      return (
        <div key={item.id} className="dash-att" onClick={() => setDetailItem(item)}>
          {icon}
          <div className="dash-att-main">
            <div className="dash-att-title">{kit ? 'Kit top-up' : 'Issue reported'} · {item.cleanerName}</div>
            <div className="dash-att-sub">{item.description}</div>
          </div>
          <button
            type="button"
            className="pill-btn is-small"
            onClick={(e) => { e.stopPropagation(); completeTodo(item.rawId); }}
            title={kit ? 'The kit has gone out - clear it off the list' : 'Dealt with - clear it off the list'}
          >
            {kit ? 'Mark sent' : 'Resolved'}
          </button>
        </div>
      );
    }
    if (item.kind === 'reminder') {
      return (
        <div key={item.id} className="dash-att" style={{ cursor: 'default' }}>
          {icon}
          <div className="dash-att-main">
            <div className={`dash-att-title ${tone}`}>
              {item.title} · <Link href={item.href} className="dash-row-name">{item.name}</Link>
            </div>
            <div className="dash-att-sub">{item.subtitle}</div>
          </div>
          <button type="button" className="pill-btn is-small" onClick={() => completeReminder(item)} title="Mark this reminder done and clear it off your dashboard">Done</button>
        </div>
      );
    }
    const action = item.kind === 'unassigned' ? 'Find cover' : item.kind === 'stock' ? 'Order list' : null;
    return (
      <Link key={item.id} href={item.href} className="dash-att">
        {icon}
        <div className="dash-att-main">
          <div className={`dash-att-title ${tone}`}>{item.title}</div>
          <div className="dash-att-sub">{item.subtitle}</div>
        </div>
        {action
          ? <span className={`pill-btn is-small${item.kind === 'unassigned' ? ' is-urgent' : ''}`}>{action}</span>
          : <ChevronRight size={16} className="dash-att-chevron" aria-hidden />}
      </Link>
    );
  };

  // Sites with jobs this week and no door or key-safe codes. Was a red
  // banner across the top of the page every day - it is a housekeeping job,
  // not an emergency, so it is an amber item here that opens the list of
  // sites.
  const accessItem = noAccessSites.length > 0 && (
    <div className="dash-att-group">
      <button type="button" className="dash-att is-toggle" onClick={() => setShowNoAccess((v) => !v)} aria-expanded={showNoAccess}>
        <span className="dash-att-icon is-warn"><KeyRound size={17} /></span>
        <div className="dash-att-main">
          <div className="dash-att-title">No access codes for {noAccessSites.length} site{noAccessSites.length === 1 ? '' : 's'}</div>
          <div className="dash-att-sub">
            {noAccessSites.reduce((n, site) => n + site.jobs, 0)} jobs in the next 7 days · staff will see no codes there
          </div>
        </div>
        {showNoAccess ? <ChevronDown size={16} className="dash-att-chevron" aria-hidden /> : <ChevronRight size={16} className="dash-att-chevron" aria-hidden />}
      </button>
      {showNoAccess && (
        <ul className="dash-att-list">
          {noAccessSites.map((site) => (
            <li key={site.id}>
              <Link href={`/admin/clients/${site.clientId}`} title="Open the client, then press Access on this site">
                {site.name}
              </Link>
              {' '}<span>{shortAddress(site.address)} · {site.jobs} job{site.jobs === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // Tracked HMOs (0150) where a room or the communal areas haven't been done
  // for a fortnight - what TKR are owed, caught before they notice.
  const roomsItem = roomsOverdue.length > 0 && (
    <div className="dash-att-group">
      <button type="button" className="dash-att is-toggle" onClick={() => setShowRoomsOverdue((v) => !v)} aria-expanded={showRoomsOverdue}>
        <span className="dash-att-icon is-warn"><DoorOpen size={17} /></span>
        <div className="dash-att-main">
          <div className="dash-att-title">Communal areas not cleaned for {REFRESH_EVERY_DAYS} days at {roomsOverdue.length} site{roomsOverdue.length === 1 ? '' : 's'}</div>
          <div className="dash-att-sub">
            Nothing booked in time · book a visit from the client's Rooms tab
          </div>
        </div>
        {showRoomsOverdue ? <ChevronDown size={16} className="dash-att-chevron" aria-hidden /> : <ChevronRight size={16} className="dash-att-chevron" aria-hidden />}
      </button>
      {showRoomsOverdue && (
        <ul className="dash-att-list">
          {roomsOverdue.map((site) => (
            <li key={site.propertyId}>
              <Link href={`/admin/clients/${site.clientId}?tab=rooms`} title="Open the client's Rooms tab to book these">
                {shortAddress(site.address) || site.address}
              </Link>
              {' '}<span>
                {site.items.map((i) => `${i.label} (${i.last ? `${i.days} days` : 'not done yet'})`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const renderTodayJob = (job, state) => {
    const { title, street } = jobWhere(job);
    const names = namesOf(job);
    const start = new Date(job.scheduled_at).getTime();
    const end = start + (job.duration_minutes || 120) * 60000;
    const unassigned = names.length === 0;
    const late = state === 'next' && start < now;
    const detail = [street, unassigned ? 'nobody assigned' : names.join(', ')];
    if (state === 'onsite' && checkinByJob[job.id]) detail.push(`clocked in ${clockOf(checkinByJob[job.id])}`);
    if (state === 'onsite') detail.push(`until ${clockOf(new Date(end))}`);
    return (
      <div
        key={job.id}
        className={`dash-job is-${state}`}
        onClick={() => router.push(state === 'held' ? '/admin/requests?section=shortShifts' : `/admin/rota?job=${job.id}`)}
      >
        <span className="dash-job-time">{clockOf(job.scheduled_at)}</span>
        <div className="dash-job-main">
          <div className="dash-job-place">{title}</div>
          <div className="dash-job-sub">{detail.filter(Boolean).join(' · ')}</div>
          {state === 'onsite' && (
            <div className="dash-job-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(progressThrough(job, now) * 100)}%` }} />
            </div>
          )}
        </div>
        {unassigned && state === 'next' ? (
          <Link
            href={`/admin/rota?job=${job.id}`}
            className="pill-btn is-small is-urgent"
            onClick={(e) => e.stopPropagation()}
            title="Open this job and put someone on it"
          >
            Assign cleaner
          </Link>
        ) : (
          <span className={`dash-job-state is-${late ? 'late' : state}`}>
            <span className="dash-state-dot" />
            {state === 'onsite' ? 'On site'
              : state === 'held' ? 'Left early · check hours'
              : state === 'missed' ? 'Missed'
                : state === 'done' ? 'Done'
                : late ? `Not clocked in · ${describeGap(now - start)} late`
                  : `In ${describeGap(start - now)}`}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="page-inner dash">
      {anniversary && <WorkAnniversaryPopup name={anniversary.name} years={anniversary.years} />}
      <div className="dash-head">
        <div>
          <h1>{timeGreeting}, {greetingName}</h1>
          <p className="page-subtitle dash-updated">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            <button
              type="button"
              className="dash-refresh"
              onClick={refresh}
              disabled={refreshing}
              title="Fetch the latest now - it also updates by itself every two minutes"
            >
              <RefreshCw size={13} aria-hidden className={refreshing ? 'is-spinning' : ''} />
              {refreshing ? 'Updating…' : `Updated ${updatedAgo(updatedAt)}`}
            </button>
          </p>
        </div>
        <div className="dash-head-actions">
          <button type="button" className="dash-search" onClick={openSearch} title="Find a client, site, cleaner or page (Ctrl+K)">
            <Search size={15} aria-hidden />
            <span>Find a client, site or cleaner</span>
            <kbd>Ctrl K</kbd>
          </button>
          <Link href="/admin/reports" className="pill-btn" title="Today's numbers in full">
            <FileBarChart size={16} aria-hidden />
            Today's report
          </Link>
          <Link href="/admin/rota?new=1" className="pill-btn is-primary" title="Schedule a new job and assign staff to it">
            <Plus size={16} strokeWidth={2.4} aria-hidden />
            New job
          </Link>
        </div>
      </div>

      {/* Today's figures as four small tiles - two by two on a phone, so the
          jobs start after two rows rather than five lines. Each opens the
          page it comes from. */}
      <div className="dash-kpis">
        <Link href="/admin/rota" className="dash-kpi" title="Today's jobs and how many are done">
          <span className="dash-kpi-label">Jobs today</span>
          {stats.todaysJobs > 0 ? (
            <span className="dash-kpi-value">{stats.todaysCompleted}<small> of {stats.todaysJobs} done</small></span>
          ) : (
            <span className="dash-kpi-value">0<small> booked</small></span>
          )}
          <span className="dash-kpi-bar" aria-hidden="true">
            <span style={{ width: `${stats.todaysJobs > 0 ? Math.round((stats.todaysCompleted / stats.todaysJobs) * 100) : 0}%` }} />
          </span>
          {stats.unassigned > 0 ? (
            <span className="dash-kpi-note is-alert">{stats.unassigned} with no cleaner</span>
          ) : (
            <span className="dash-kpi-note is-good"><Check size={13} strokeWidth={2.6} aria-hidden /> Every job has a cleaner</span>
          )}
        </Link>
        <Link href="/admin/cleaners" className="dash-kpi" title="Staff clocked in right now">
          <span className="dash-kpi-label">Working now</span>
          {/* A figure with no denominator says nothing: one of two is a
              problem, one of twelve is a Tuesday. */}
          <span className="dash-kpi-value">{stats.staffWorking}<small> of {staffGlance.total} staff</small></span>
        </Link>
        <Link href="/admin/rota" className="dash-kpi" title="Total length of today's scheduled work">
          <span className="dash-kpi-label">Hours booked</span>
          <span className="dash-kpi-value">{Math.round(stats.jobHours * 10) / 10}<small> today</small></span>
        </Link>
        <Link href="/admin/requests" className="dash-kpi" title="Open kit top-ups, issues and time off">
          <span className="dash-kpi-label">Requests open</span>
          <span className="dash-kpi-value">{stats.openRequests}</span>
        </Link>
      </div>

      <div className="dash-layout">
        <div className="dash-col">
          <section className="dash-card">
            <div className="dash-card-head">
              <h2>Today</h2>
              <Link href="/admin/rota" className="dash-panel-link">Open the rota &rarr;</Link>
            </div>

            {todaysJobs.length === 0 && <p className="empty-state">No jobs scheduled today.</p>}

            {onSiteJobs.length > 0 && (
              <div className="dash-group">
                <div className="dash-group-label is-onsite">On site now</div>
                {onSiteJobs.map((job) => renderTodayJob(job, 'onsite'))}
              </div>
            )}

            {heldJobs.length > 0 && (
              <div className="dash-group">
                <div className="dash-group-label is-urgent">Hours to check</div>
                {heldJobs.map((job) => renderTodayJob(job, 'held'))}
              </div>
            )}

            {missedJobs.length > 0 && (
              <div className="dash-group">
                <div className="dash-group-label is-urgent">Missed</div>
                {missedJobs.map((job) => renderTodayJob(job, 'missed'))}
              </div>
            )}

            {todaysJobs.length > 0 && (
              <div className="dash-now" aria-label={`Now, ${clockOf(new Date())}`}>
                <span>{clockOf(new Date())}</span>
                <i />
              </div>
            )}

            {comingUp.length > 0 && (
              <div className="dash-group">
                <div className="dash-group-label">Coming up</div>
                {comingUp.map((job) => renderTodayJob(job, 'next'))}
              </div>
            )}
            {todaysJobs.length > 0 && comingUp.length === 0 && (
              <p className="dash-quiet">Nothing else is due on today.</p>
            )}

            {/* Finished work is the part of the day nobody needs to act on,
                so it folds away to one line. */}
            {doneJobs.length > 0 && (
              <details className="dash-done">
                <summary>
                  <span className="dash-state-dot is-done" />
                  <span><b>{doneJobs.length} done</b> · {doneJobs.map((j) => jobWhere(j).title).join(', ')}</span>
                  <ChevronDown size={15} aria-hidden className="dash-done-chevron" />
                </summary>
                {doneJobs.map((job) => renderTodayJob(job, 'done'))}
              </details>
            )}
          </section>

          {tomorrow && (
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Tomorrow</h2>
                <span className="dash-card-note">
                  {tomorrow.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </div>
              <div className="dash-tiles">
                <Link href="/admin/rota" className="dash-tile">
                  <b>{tomorrow.count}</b>
                  <span>{tomorrow.count === 1 ? 'job' : 'jobs'} · {Math.round(tomorrow.hours * 10) / 10}h</span>
                </Link>
                <Link href="/admin/rota" className={`dash-tile${tomorrow.unassigned > 0 ? ' is-urgent' : ' is-good'}`}>
                  <b>{tomorrow.unassigned > 0 ? tomorrow.unassigned : 'All'}</b>
                  <span>{tomorrow.unassigned > 0 ? 'need a cleaner' : 'have a cleaner'}</span>
                </Link>
                <button
                  type="button"
                  className={`dash-tile${tomorrow.away.length > 0 ? ' is-away' : ''}`}
                  onClick={() => tomorrow.away.length > 0 && setGlanceDetail({ title: 'Away tomorrow', names: tomorrow.away })}
                  style={{ cursor: tomorrow.away.length > 0 ? 'pointer' : 'default' }}
                >
                  <b>{tomorrow.away.length}</b>
                  <span>away</span>
                </button>
              </div>
              {tomorrow.first && (
                <p className="dash-quiet">
                  First job {clockOf(tomorrow.first)}
                  {tomorrow.lastEnd && ` · last finishes ${clockOf(tomorrow.lastEnd)}`}
                </p>
              )}
            </section>
          )}

          <section className="dash-card">
            <div className="dash-card-head">
              <h2>Later this week</h2>
              <Link href="/admin/rota" className="dash-panel-link">Rota &rarr;</Link>
            </div>
            {upcomingJobs.length === 0 && <p className="empty-state">Nothing scheduled in the next week.</p>}
            {upcomingJobs.map((job) => {
              const names = namesOf(job);
              const unassigned = names.length === 0;
              const { title, street } = jobWhere(job);
              return (
                <div key={job.id} className="dash-job is-later" onClick={() => router.push(`/admin/rota?job=${job.id}`)}>
                  <span className="dash-job-time">
                    {new Date(job.scheduled_at).toLocaleDateString(undefined, { weekday: 'short' })}
                    <small>{clockOf(job.scheduled_at)}</small>
                  </span>
                  <div className="dash-job-main">
                    <div className="dash-job-place">{title}</div>
                    <div className={`dash-job-sub${unassigned ? ' is-urgent' : ''}`}>
                      {[street, unassigned ? 'needs a cleaner' : abbreviateName(names[0])].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        <div className="dash-col">
          {/* First in this column, and first after the figures on a phone
              (order: -1 under 980px) - it is the list the office acts on. */}
          <section className="dash-card is-attention">
            <div className="dash-card-head">
              <h2>Needs attention</h2>
              {(attention.length > 0 || noAccessSites.length > 0 || roomsOverdue.length > 0) && <span className="dash-card-note">Most urgent first</span>}
            </div>
            {attention.length === 0 && noAccessSites.length === 0 && roomsOverdue.length === 0 && <EmptyState compact tone="good" icon={EmptyIconCheck} title="Nothing needs attention right now" />}
            {redAttention.map(renderAttentionItem)}
            {roomsItem}
            {accessItem}
            {otherAttention.map(renderAttentionItem)}
            {attention.length > 6 && (
              <Link href="/admin/requests" className="dash-panel-more">+{attention.length - 6} more &rarr;</Link>
            )}
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <h2>Who's on now</h2>
            </div>
            {onSiteNow.length === 0 && <p className="dash-quiet">Nobody is clocked in right now.</p>}
            {onSiteNow.map((person) => {
              const [bg, ink] = teamTints.get(person.id) || tintFor(person.id);
              return (
                <div key={person.id} className="dash-person-now">
                  <span className="dash-avatar is-on" style={{ background: bg, color: ink }}>{initialsOf(person.name)}</span>
                  <div className="dash-onsite-main">
                    <div className="dash-onsite-name">{person.name}</div>
                    <div className="dash-onsite-where">{person.place} · since {clockOf(person.since)}</div>
                  </div>
                </div>
              );
            })}
            {nextJob && (
              <div className="dash-next-up">
                <div className="dash-avatar-stack">
                  {(nextJob.job_assignments || []).slice(0, 4).map((a) => {
                    const [bg, ink] = teamTints.get(a.cleaner_id) || tintFor(a.cleaner_id);
                    return <span key={a.cleaner_id} className="dash-avatar" style={{ background: bg, color: ink }}>{initialsOf(a.profiles?.full_name)}</span>;
                  })}
                </div>
                <span>{listNames(nextNames)} {nextNames.length === 1 ? 'starts' : 'start'} at {clockOf(nextJob.scheduled_at)}</span>
              </div>
            )}
            <div className="dash-glance-line">
              <button type="button" onClick={() => staffGlance.holiday.length > 0 && setGlanceDetail({ title: 'On holiday / leave', names: staffGlance.holiday })} disabled={staffGlance.holiday.length === 0}>
                <span className="dash-glance-dot" style={{ background: 'var(--wf-azure)' }} />
                {staffGlance.holiday.length} on holiday
              </button>
              <button type="button" onClick={() => staffGlance.off.length > 0 && setGlanceDetail({ title: 'Not working today', names: staffGlance.off })} disabled={staffGlance.off.length === 0}>
                <span className="dash-glance-dot" style={{ background: 'var(--wf-steel)' }} />
                {staffGlance.off.length} not working today
              </button>
              <Link href="/admin/cleaners" className="dash-panel-link">Staff &rarr;</Link>
            </div>
          </section>

          {role === 'admin' && (
            <section className="dash-card">
              <div className="dash-card-head">
                <h2>Staff hours</h2>
                {/* Still a real <select> - it keeps the keyboard and the
                    platform's own picker on a phone. Only the chrome changes. */}
                <div className="dash-period">
                  <select value={payrollPeriod} onChange={(e) => setPayrollPeriod(e.target.value)}>
                    {Object.entries(PAYROLL_PERIODS).map(([key, p]) => (
                      <option key={key} value={key}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </div>
              </div>
              <div className="dash-ring">
                <HoursRing completedHours={payrollTotals.completedHours} totalHours={payrollTotals.totalHours} />
              </div>
              <div className="dash-splits">
                <div>
                  <strong>{payrollTotals.completedHours.toFixed(1)}h</strong>
                  <span>Completed</span>
                </div>
                <div>
                  <strong>{payrollTotals.totalHours.toFixed(1)}h</strong>
                  <span>Scheduled</span>
                </div>
                <div>
                  <strong>{Math.max(payrollTotals.totalHours - payrollTotals.completedHours, 0).toFixed(1)}h</strong>
                  <span>Remaining</span>
                </div>
              </div>
              {/* The figure that decides whether this panel is telling the
                  truth. Hours nobody clocked into are paid as zero, so a
                  period showing them is a period whose "Completed" total is
                  short by that much until someone deals with it. */}
              {!payrollLoading && (payrollTotals.missedHours > 0 || payrollTotals.pendingClaims > 0) && (
                <Link
                  href="/admin/requests"
                  className="dash-row"
                  style={{ textDecoration: 'none', color: 'inherit', borderTop: '1px solid var(--hairline)', marginTop: 8, paddingTop: 10 }}
                >
                  <span className="dash-person" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="dash-glance-dot" style={{ background: 'var(--wf-overdue)' }} />
                    {payrollTotals.missedHours > 0
                      ? 'Nobody clocked in'
                      : `${payrollTotals.pendingClaims} claim${payrollTotals.pendingClaims === 1 ? '' : 's'} to confirm`}
                  </span>
                  <strong className="dash-person-hours">
                    {payrollTotals.missedHours > 0 ? `${payrollTotals.missedHours.toFixed(1)}h` : 'Review'}
                  </strong>
                </Link>
              )}
              {!payrollLoading && payrollRows.slice(0, 4).map((r) => (
                <div key={r.name} className="dash-row dash-row-quiet">
                  <span className="dash-person">{r.name}</span>
                  <strong className="dash-person-hours">{(r.minutes / 60).toFixed(1)}h</strong>
                </div>
              ))}
              {/* These figures are live and keep moving. The payroll page is
                  where a period gets checked, locked, and handed to QuickBooks. */}
              <Link href="/admin/payroll" className="dash-panel-link dash-panel-foot">Close payroll &rarr;</Link>
            </section>
          )}
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
                Mark resolved
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
