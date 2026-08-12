'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

function hoursWorked(cleanerId, jobs) {
  return jobs
    .filter((j) => j.cleaner_id === cleanerId && j.status === 'completed')
    .reduce((sum, j) => sum + (j.duration_minutes || 0), 0) / 60;
}

function holidayHoursUsed(cleanerId, timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.cleaner_id === cleanerId && t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
}

export default function AdminCleaners() {
  const router = useRouter();
  const [cleaners, setCleaners] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);
  const [adjustmentInput, setAdjustmentInput] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: cleanersData }, { data: jobsData }, { data: timeOffData }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at, active, holiday_adjustment_hours').eq('role', 'cleaner').order('created_at'),
      supabase.from('jobs').select('cleaner_id, status, duration_minutes').not('cleaner_id', 'is', null),
      supabase.from('time_off_requests').select('cleaner_id, type, status, hours'),
    ]);

    setCleaners(cleanersData || []);
    setJobs(jobsData || []);
    setTimeOffRequests(timeOffData || []);
    setLoading(false);
  };

  const startEditAdjustment = (cleaner) => {
    setEditingAdjustmentId(cleaner.id);
    setAdjustmentInput(String(cleaner.holiday_adjustment_hours));
  };

  const saveAdjustment = async (cleanerId) => {
    const value = parseFloat(adjustmentInput);
    if (isNaN(value)) return;

    const { data } = await supabase
      .from('profiles').update({ holiday_adjustment_hours: value }).eq('id', cleanerId)
      .select('id, holiday_adjustment_hours').single();

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleanerId ? { ...c, holiday_adjustment_hours: data.holiday_adjustment_hours } : c)));
    }
    setEditingAdjustmentId(null);
  };

  const toggleActive = async (cleaner) => {
    const nextActive = !cleaner.active;
    if (!nextActive && !confirm(`Deactivate ${cleaner.full_name || 'this cleaner'}? They won't be able to log in until reactivated.`)) return;

    const { data } = await supabase
      .from('profiles').update({ active: nextActive }).eq('id', cleaner.id)
      .select('id, active').single();

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleaner.id ? { ...c, active: data.active } : c)));
    }
  };

  const jobCount = (cleanerId) => jobs.filter((j) => j.cleaner_id === cleanerId).length;

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Cleaners</h1>
          <p className="page-subtitle">{cleaners.length} cleaner{cleaners.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <p className="empty-state" style={{ marginTop: -8 }}>
        New cleaners are added by having them sign up in the app — every new sign-up starts as a cleaner automatically.
      </p>

      {cleaners.length === 0 && <p className="empty-state">No cleaners yet.</p>}

      <div className="job-list">
        {cleaners.map((c) => {
          const worked = hoursWorked(c.id, jobs);
          const accrued = worked * HOLIDAY_ACCRUAL_RATE + (c.holiday_adjustment_hours || 0);
          const used = holidayHoursUsed(c.id, timeOffRequests);
          const remaining = accrued - used;
          const isEditingAdjustment = editingAdjustmentId === c.id;

          return (
            <div key={c.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2>{c.full_name || 'Unnamed cleaner'}</h2>
                  <p className="job-time">
                    Joined {new Date(c.created_at).toLocaleDateString()}
                    {' · '}{jobCount(c.id)} job{jobCount(c.id) === 1 ? '' : 's'} assigned
                  </p>
                  <p className="job-time">
                    Holiday: {remaining.toFixed(1)} of {accrued.toFixed(1)} hours remaining
                    {' '}(12.07% of {worked.toFixed(1)}h worked
                    {c.holiday_adjustment_hours ? `, ${c.holiday_adjustment_hours > 0 ? '+' : ''}${c.holiday_adjustment_hours}h adjustment` : ''})
                    {' '}
                    <button
                      className="btn-secondary"
                      onClick={() => (isEditingAdjustment ? setEditingAdjustmentId(null) : startEditAdjustment(c))}
                      style={{ padding: '2px 10px', fontSize: 12, marginLeft: 4 }}
                    >
                      {isEditingAdjustment ? 'Cancel' : 'Adjust'}
                    </button>
                  </p>
                  {c.active === false && <span className="badge missed">deactivated</span>}
                </div>
                <button className="btn-secondary" onClick={() => toggleActive(c)} style={{ height: 'fit-content' }}>
                  {c.active === false ? 'Reactivate' : 'Deactivate'}
                </button>
              </div>

              {isEditingAdjustment && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Manual adjustment (hours, +/-)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={adjustmentInput}
                    onChange={(e) => setAdjustmentInput(e.target.value)}
                    style={{ width: 80 }}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={() => saveAdjustment(c.id)}>Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
