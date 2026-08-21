'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { toCSV, downloadCSV } from '../../../lib/csv';
import BackButton from '../../components/BackButton';

function getWeekRange(weekOffset) {
  const now = new Date();
  const day = now.getDay();
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

const PERIODS = {
  all: { label: 'All time', range: () => null },
  this_week: { label: 'This Week', range: () => getWeekRange(0) },
  last_week: { label: 'Last Week', range: () => getWeekRange(-1) },
  this_month: { label: 'This Month', range: () => getMonthRange(0) },
  last_month: { label: 'Last Month', range: () => getMonthRange(-1) },
};

async function loadClients() {
  const [{ data: clients }, { data: props }] = await Promise.all([
    supabase.from('clients').select('id, name, contact_name, email, phone, billing_address, industry, notes').order('name'),
    supabase.from('properties').select('client_id'),
  ]);
  const counts = {};
  (props || []).forEach((p) => { counts[p.client_id] = (counts[p.client_id] || 0) + 1; });

  return {
    columns: [
      { key: 'name', label: 'Client' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'billing_address', label: 'Billing Address' },
      { key: 'industry', label: 'Industry' },
      { key: 'properties', label: 'Properties' },
      { key: 'notes', label: 'Notes' },
    ],
    rows: (clients || []).map((c) => ({
      name: c.name, contact_name: c.contact_name || '', email: c.email || '', phone: c.phone || '',
      billing_address: c.billing_address || '', industry: c.industry || '', properties: counts[c.id] || 0, notes: c.notes || '',
    })),
  };
}

async function loadStaff() {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, active, created_at, holiday_adjustment_hours')
    .neq('role', 'client')
    .order('full_name');

  return {
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'active', label: 'Active' },
      { key: 'joined', label: 'Joined' },
      { key: 'holiday_adjustment', label: 'Holiday Adjustment (h)' },
    ],
    rows: (data || []).map((p) => ({
      name: p.full_name || 'Unknown', role: p.role, active: p.active ? 'Yes' : 'No',
      joined: new Date(p.created_at).toLocaleDateString(), holiday_adjustment: p.holiday_adjustment_hours ?? 0,
    })),
  };
}

async function loadHours(range) {
  let query = supabase
    .from('job_assignments')
    .select('cleaner_id, profiles(full_name), jobs!inner(id, duration_minutes, status, scheduled_at)')
    .eq('jobs.status', 'completed');
  if (range) query = query.gte('jobs.scheduled_at', range.start.toISOString()).lt('jobs.scheduled_at', range.end.toISOString());
  const { data } = await query;

  // A job's duration is split evenly across everyone assigned to it, so a
  // 2-hour job with 2 people counts as 1 hour each - not 2 hours each.
  const assigneeCounts = {};
  (data || []).forEach((row) => { assigneeCounts[row.jobs.id] = (assigneeCounts[row.jobs.id] || 0) + 1; });

  const totals = {};
  (data || []).forEach((row) => {
    const key = row.cleaner_id;
    if (!totals[key]) totals[key] = { name: row.profiles?.full_name || 'Unknown', jobs: 0, minutes: 0 };
    totals[key].jobs += 1;
    totals[key].minutes += (row.jobs.duration_minutes || 0) / assigneeCounts[row.jobs.id];
  });

  return {
    columns: [
      { key: 'name', label: 'Cleaner' },
      { key: 'jobs', label: 'Jobs Completed' },
      { key: 'hours', label: 'Hours' },
    ],
    rows: Object.values(totals)
      .map((t) => ({ name: t.name, jobs: t.jobs, hours: (t.minutes / 60).toFixed(2) }))
      .sort((a, b) => b.hours - a.hours),
  };
}

async function loadJobs(range) {
  let query = supabase
    .from('jobs')
    .select('id, scheduled_at, status, duration_minutes, properties(address, clients(name)), job_assignments(profiles(full_name))')
    .order('scheduled_at', { ascending: false })
    .limit(1000);
  if (range) query = query.gte('scheduled_at', range.start.toISOString()).lt('scheduled_at', range.end.toISOString());
  const { data } = await query;

  return {
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'client', label: 'Client' },
      { key: 'address', label: 'Address' },
      { key: 'status', label: 'Status' },
      { key: 'duration', label: 'Duration (min)' },
      { key: 'cleaners', label: 'Cleaner(s)' },
    ],
    rows: (data || []).map((j) => ({
      date: new Date(j.scheduled_at).toLocaleString(),
      client: j.properties?.clients?.name || '',
      address: j.properties?.address || '',
      status: j.status,
      duration: j.duration_minutes || '',
      cleaners: (j.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean).join('; ') || 'Unassigned',
    })),
  };
}

async function loadQuotes() {
  const { data } = await supabase
    .from('quotes')
    .select('id, description, price, status, valid_until, created_at, prospect_name, clients(name)')
    .order('created_at', { ascending: false });

  return {
    columns: [
      { key: 'client', label: 'Client' },
      { key: 'description', label: 'Description' },
      { key: 'price', label: 'Price' },
      { key: 'status', label: 'Status' },
      { key: 'valid_until', label: 'Valid Until' },
      { key: 'created', label: 'Created' },
    ],
    rows: (data || []).map((q) => ({
      client: q.clients?.name || q.prospect_name || 'Unknown',
      description: q.description,
      price: `£${Number(q.price).toFixed(2)}`,
      status: q.status,
      valid_until: q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '',
      created: new Date(q.created_at).toLocaleDateString(),
    })),
  };
}

async function loadProperties() {
  const { data } = await supabase.from('properties').select('id, address, notes, clients(name)').order('address');

  return {
    columns: [
      { key: 'address', label: 'Address' },
      { key: 'client', label: 'Client' },
      { key: 'notes', label: 'Notes' },
    ],
    rows: (data || []).map((p) => ({ address: p.address, client: p.clients?.name || 'Unknown', notes: p.notes || '' })),
  };
}

async function loadTimeOff() {
  const { data } = await supabase
    .from('time_off_requests')
    .select('id, type, start_date, end_date, hours, reason, status, profiles!time_off_requests_cleaner_id_fkey(full_name)')
    .order('start_date', { ascending: false });

  return {
    columns: [
      { key: 'cleaner', label: 'Cleaner' },
      { key: 'type', label: 'Type' },
      { key: 'start', label: 'Start' },
      { key: 'end', label: 'End' },
      { key: 'hours', label: 'Hours' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
    ],
    rows: (data || []).map((t) => ({
      cleaner: t.profiles?.full_name || 'Unknown', type: t.type, start: t.start_date, end: t.end_date,
      hours: t.hours ?? '', status: t.status, reason: t.reason || '',
    })),
  };
}

const REPORT_TYPES = [
  { id: 'clients', label: 'Clients', load: loadClients, hasPeriod: false },
  { id: 'staff', label: 'Staff', load: loadStaff, hasPeriod: false },
  { id: 'hours', label: 'Hours Worked', load: loadHours, hasPeriod: true },
  { id: 'jobs', label: 'Jobs History', load: loadJobs, hasPeriod: true },
  { id: 'quotes', label: 'Quotes', load: loadQuotes, hasPeriod: false },
  { id: 'properties', label: 'Properties', load: loadProperties, hasPeriod: false },
  { id: 'timeoff', label: 'Time Off', load: loadTimeOff, hasPeriod: false },
];

export default function AdminDataReports() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [reportId, setReportId] = useState('clients');
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);

  const reportDef = REPORT_TYPES.find((r) => r.id === reportId);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) loadReport();
  }, [ready, reportId, period]);

  const loadReport = async () => {
    setLoading(true);
    const range = reportDef.hasPeriod ? PERIODS[period].range() : null;
    const result = await reportDef.load(range);
    setColumns(result.columns);
    setRows(result.rows);
    setLoading(false);
  };

  const handleDownload = () => {
    const csv = toCSV(columns, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`${reportId}-report-${stamp}.csv`, csv);
  };

  if (!ready) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Data Reports</h1>
          <p className="page-subtitle">Pull data for clients, staff, hours, jobs, and more</p>
        </div>
        <button className="btn-secondary" onClick={handleDownload} disabled={loading || rows.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Download the rows below as a spreadsheet file">
          <Download size={16} /> Download CSV
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {REPORT_TYPES.map((r) => (
          <button key={r.id} className={reportId === r.id ? 'btn-primary' : 'btn-secondary'} onClick={() => setReportId(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      {reportDef.hasPeriod && (
        <div style={{ marginBottom: 16 }}>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 'auto' }}>
            {Object.entries(PERIODS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {loading && <p className="empty-state">Loading...</p>}
      {!loading && rows.length === 0 && <p className="empty-state">No data for this report.</p>}

      {!loading && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ textAlign: 'left', padding: '12px 14px', borderBottom: '2px solid var(--hairline)', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  {columns.map((c) => (
                    <td key={c.key} style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{row[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>{rows.length} row{rows.length === 1 ? '' : 's'}</p>
    </div>
  );
}
