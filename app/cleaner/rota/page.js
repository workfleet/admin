'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

function groupByDate(jobs) {
  const groups = {};
  jobs.forEach((j) => {
    const key = new Date(j.scheduled_at).toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  });
  return groups;
}

function DayGroup({ date, jobs, router, dim }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
        {new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      {jobs.map((job) => (
        <div
          key={job.id}
          className="card"
          onClick={() => router.push(`/cleaner/jobs/${job.id}`)}
          style={{ cursor: 'pointer', opacity: dim ? 0.7 : 1 }}
        >
          <h2>{job.properties?.address}</h2>
          <p style={{ margin: '4px 0', fontSize: 14 }}>
            {new Date(job.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

const EMPTY_FORM = { type: 'holiday', startDate: '', endDate: '', hours: '', reason: '' };
const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

function hoursWorked(jobs) {
  return jobs.filter((j) => j.status === 'completed').reduce((sum, j) => sum + (j.duration_minutes || 0), 0) / 60;
}

function holidayHoursUsed(timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
}

export default function CleanerRota() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [adjustmentHours, setAdjustmentHours] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: jobsData }, { data: timeOffData }, { data: profileData }] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, scheduled_at, status, duration_minutes, properties(address)')
        .eq('cleaner_id', session.user.id)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('time_off_requests')
        .select('id, type, start_date, end_date, hours, reason, status, admin_note, created_at')
        .order('start_date', { ascending: false }),
      supabase.from('profiles').select('holiday_adjustment_hours').eq('id', session.user.id).single(),
    ]);

    setJobs(jobsData || []);
    setTimeOff(timeOffData || []);
    setAdjustmentHours(profileData?.holiday_adjustment_hours ?? 0);
    setLoading(false);
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!form.startDate || !form.endDate) return;
    if (form.endDate < form.startDate) { alert('End date must be on or after the start date.'); return; }
    if (form.type === 'holiday' && (!form.hours || Number(form.hours) <= 0)) { alert('Enter how many hours of holiday you\'re requesting.'); return; }
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('time_off_requests')
      .insert({
        cleaner_id: session.user.id,
        type: form.type,
        start_date: form.startDate,
        end_date: form.endDate,
        hours: form.type === 'holiday' ? Number(form.hours) : null,
        reason: form.reason.trim() || null,
      })
      .select('id, type, start_date, end_date, hours, reason, status, admin_note, created_at')
      .single();

    setSubmitting(false);
    if (data) {
      setTimeOff((prev) => [data, ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);

      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
      notify({
        type: 'time_off_requested',
        cleanerName: profile?.full_name || 'A cleaner',
        requestType: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        hours: form.type === 'holiday' ? Number(form.hours) : null,
      });
    }
  };

  if (loading) return <div className="container">Loading...</div>;

  const upcoming = jobs.filter((j) => j.status !== 'completed');
  const past = jobs.filter((j) => j.status === 'completed');
  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(past);

  const worked = hoursWorked(jobs);
  const accrued = worked * HOLIDAY_ACCRUAL_RATE + adjustmentHours;
  const used = holidayHoursUsed(timeOff);
  const remaining = accrued - used;

  return (
    <div className="container">
      <h1>My Rota</h1>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Time Off</h2>
          <button className="btn-secondary" onClick={() => { setShowForm((s) => !s); setForm(EMPTY_FORM); }}>
            {showForm ? 'Cancel' : '+ Request'}
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
          {remaining.toFixed(1)} of {accrued.toFixed(1)} holiday hours remaining
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
          Accrued at 12.07% of hours worked ({worked.toFixed(1)}h so far{adjustmentHours ? `, plus a ${adjustmentHours}h adjustment` : ''})
        </p>

        {showForm && (
          <form onSubmit={submitRequest} style={{ marginTop: 12 }}>
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="holiday">Holiday</option>
              <option value="unavailable">Unavailable</option>
            </select>

            <div className="field-row">
              <div className="field">
                <label className="field-label">From</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="field">
                <label className="field-label">To</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} required />
              </div>
            </div>

            {form.type === 'holiday' && (
              <>
                <label>Hours requested</label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                  placeholder="e.g. 16"
                  required
                />
              </>
            )}

            <label>Reason (optional)</label>
            <input
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Family holiday, medical appointment"
            />

            <button type="submit" disabled={submitting} style={{ marginTop: 8 }}>
              {submitting ? 'Sending...' : 'Submit Request'}
            </button>
          </form>
        )}

        {!showForm && timeOff.length === 0 && <p className="empty-state">No time off requested.</p>}

        {!showForm && timeOff.map((t) => (
          <div key={t.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {t.type === 'holiday' ? 'Holiday' : 'Unavailable'} · {new Date(t.start_date).toLocaleDateString()} – {new Date(t.end_date).toLocaleDateString()}
                  {t.type === 'holiday' && t.hours ? ` · ${t.hours}h` : ''}
                </div>
                {t.reason && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t.reason}</div>}
              </div>
              <span className={`badge ${t.status === 'approved' ? 'completed' : t.status === 'declined' ? 'missed' : 'scheduled'}`}>{t.status}</span>
            </div>
            {t.admin_note && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>"{t.admin_note}"</div>
            )}
          </div>
        ))}
      </div>

      {jobs.length === 0 && <p className="empty-state">No jobs scheduled.</p>}

      {Object.entries(upcomingGroups).map(([date, dayJobs]) => (
        <DayGroup key={date} date={date} jobs={dayJobs} router={router} />
      ))}

      {past.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, marginBottom: 4 }}>History</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
            {past.length} job{past.length === 1 ? '' : 's'} completed · {worked.toFixed(1)}h worked
          </p>
          {Object.entries(pastGroups).map(([date, dayJobs]) => (
            <DayGroup key={date} date={date} jobs={dayJobs} router={router} dim />
          ))}
        </>
      )}
    </div>
  );
}
