'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

function holidayDaysUsed(cleanerId, timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.cleaner_id === cleanerId && t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (new Date(t.end_date) - new Date(t.start_date)) / 86400000 + 1, 0);
}

export default function AdminCleaners() {
  const router = useRouter();
  const [cleaners, setCleaners] = useState([]);
  const [jobCounts, setJobCounts] = useState({});
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingAllowanceId, setEditingAllowanceId] = useState(null);
  const [allowanceInput, setAllowanceInput] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: cleanersData }, { data: jobsData }, { data: timeOffData }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at, active, holiday_allowance_days').eq('role', 'cleaner').order('created_at'),
      supabase.from('jobs').select('cleaner_id').not('cleaner_id', 'is', null),
      supabase.from('time_off_requests').select('cleaner_id, type, status, start_date, end_date'),
    ]);

    const counts = {};
    (jobsData || []).forEach((j) => { counts[j.cleaner_id] = (counts[j.cleaner_id] || 0) + 1; });

    setCleaners(cleanersData || []);
    setJobCounts(counts);
    setTimeOffRequests(timeOffData || []);
    setLoading(false);
  };

  const startEditAllowance = (cleaner) => {
    setEditingAllowanceId(cleaner.id);
    setAllowanceInput(String(cleaner.holiday_allowance_days));
  };

  const saveAllowance = async (cleanerId) => {
    const value = parseFloat(allowanceInput);
    if (isNaN(value) || value < 0) return;

    const { data } = await supabase
      .from('profiles').update({ holiday_allowance_days: value }).eq('id', cleanerId)
      .select('id, holiday_allowance_days').single();

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleanerId ? { ...c, holiday_allowance_days: data.holiday_allowance_days } : c)));
    }
    setEditingAllowanceId(null);
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
          const used = holidayDaysUsed(c.id, timeOffRequests);
          const remaining = c.holiday_allowance_days - used;
          const isEditingAllowance = editingAllowanceId === c.id;

          return (
            <div key={c.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2>{c.full_name || 'Unnamed cleaner'}</h2>
                  <p className="job-time">
                    Joined {new Date(c.created_at).toLocaleDateString()}
                    {' · '}{jobCounts[c.id] || 0} job{(jobCounts[c.id] || 0) === 1 ? '' : 's'} assigned
                  </p>
                  <p className="job-time">
                    Holiday: {remaining} of {c.holiday_allowance_days} day{c.holiday_allowance_days === 1 ? '' : 's'} remaining
                    {' '}
                    <button
                      className="btn-secondary"
                      onClick={() => (isEditingAllowance ? setEditingAllowanceId(null) : startEditAllowance(c))}
                      style={{ padding: '2px 10px', fontSize: 12, marginLeft: 4 }}
                    >
                      {isEditingAllowance ? 'Cancel' : 'Edit'}
                    </button>
                  </p>
                  {c.active === false && <span className="badge missed">deactivated</span>}
                </div>
                <button className="btn-secondary" onClick={() => toggleActive(c)} style={{ height: 'fit-content' }}>
                  {c.active === false ? 'Reactivate' : 'Deactivate'}
                </button>
              </div>

              {isEditingAllowance && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Annual allowance (days)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={allowanceInput}
                    onChange={(e) => setAllowanceInput(e.target.value)}
                    style={{ width: 80 }}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={() => saveAllowance(c.id)}>Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
