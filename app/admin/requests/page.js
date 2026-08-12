'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

function holidayHoursUsed(cleanerId, timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.cleaner_id === cleanerId && t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
}

export default function AdminRequests() {
  const router = useRouter();
  const [section, setSection] = useState('requests'); // requests | timeoff
  const [loading, setLoading] = useState(true);
  const [holidayBalances, setHolidayBalances] = useState({}); // cleanerId -> accrued hours

  // kit top-up / issue requests
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('open'); // open | resolved | all
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');

  // time off requests
  const [timeOff, setTimeOff] = useState([]);
  const [timeOffFilter, setTimeOffFilter] = useState('pending'); // pending | approved | declined | all
  const [decidingId, setDecidingId] = useState(null);
  const [decidingStatus, setDecidingStatus] = useState(null);
  const [adminNote, setAdminNote] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: requestsData }, { data: timeOffData }, { data: cleanerProfiles }, { data: jobsData }] = await Promise.all([
      supabase
        .from('staff_requests')
        .select('id, type, description, status, created_at, resolved_at, resolution_note, cleaner_id, profiles(full_name), jobs(scheduled_at, properties(address))')
        .order('created_at', { ascending: false }),
      supabase
        .from('time_off_requests')
        .select('id, type, start_date, end_date, hours, reason, status, admin_note, created_at, cleaner_id, profiles(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, holiday_adjustment_hours').eq('role', 'cleaner'),
      supabase.from('jobs').select('cleaner_id, status, duration_minutes').not('cleaner_id', 'is', null),
    ]);

    const balanceMap = {};
    (cleanerProfiles || []).forEach((p) => {
      const worked = (jobsData || [])
        .filter((j) => j.cleaner_id === p.id && j.status === 'completed')
        .reduce((sum, j) => sum + (j.duration_minutes || 0), 0) / 60;
      balanceMap[p.id] = worked * HOLIDAY_ACCRUAL_RATE + (p.holiday_adjustment_hours || 0);
    });
    setHolidayBalances(balanceMap);
    setRequests(requestsData || []);
    setTimeOff(timeOffData || []);
    setLoading(false);
  };

  const startResolve = (id) => {
    setResolvingId(id);
    setResolutionNote('');
  };

  const confirmResolve = async (id) => {
    const target = requests.find((r) => r.id === id);
    const { data } = await supabase
      .from('staff_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_note: resolutionNote.trim() || null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note')
      .single();

    if (data) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
      if (target?.cleaner_id) {
        notify({ type: 'request_resolved', cleanerId: target.cleaner_id, description: target.description, note: data.resolution_note });
      }
    }
    setResolvingId(null);
  };

  const reopen = async (id) => {
    const { data } = await supabase
      .from('staff_requests')
      .update({ status: 'open', resolved_at: null, resolution_note: null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note')
      .single();

    if (data) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    }
  };

  const startDecide = (id, status) => {
    setDecidingId(id);
    setDecidingStatus(status);
    setAdminNote('');
  };

  const confirmDecide = async (id) => {
    const target = timeOff.find((t) => t.id === id);
    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('time_off_requests')
      .update({ status: decidingStatus, admin_note: adminNote.trim() || null, decided_by: session.user.id, decided_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status, admin_note')
      .single();

    if (data) {
      setTimeOff((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
      if (target?.cleaner_id) {
        notify({
          type: 'time_off_decided',
          cleanerId: target.cleaner_id,
          status: data.status,
          startDate: target.start_date,
          endDate: target.end_date,
          note: data.admin_note,
        });
      }
    }
    setDecidingId(null);
  };

  const filteredRequests = requests.filter((r) => filter === 'all' || r.status === filter);
  const openCount = requests.filter((r) => r.status === 'open').length;

  const filteredTimeOff = timeOff.filter((t) => timeOffFilter === 'all' || t.status === timeOffFilter);
  const pendingCount = timeOff.filter((t) => t.status === 'pending').length;

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Requests</h1>
          <p className="page-subtitle">Kit top-ups, issues, and time off requested by staff</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={section === 'requests' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('requests')}>
            Kit &amp; Issues ({openCount})
          </button>
          <button className={section === 'timeoff' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('timeoff')}>
            Time Off ({pendingCount})
          </button>
        </div>
      </div>

      {section === 'requests' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>Open</button>
            <button className={filter === 'resolved' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('resolved')}>Resolved</button>
            <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
          </div>

          {filteredRequests.length === 0 && <p className="empty-state">Nothing here.</p>}

          <div className="job-list">
            {filteredRequests.map((r) => (
              <div key={r.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h2>{r.type === 'kit_topup' ? 'Kit Top-up' : 'Issue'}</h2>
                    <p style={{ fontSize: 14, margin: '4px 0' }}>{r.description}</p>
                    <p className="job-time">
                      {r.profiles?.full_name || 'Unknown cleaner'}
                      {r.jobs?.properties?.address && ` · ${r.jobs.properties.address}`}
                      {' · '}{new Date(r.created_at).toLocaleString()}
                    </p>
                    <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
                    {r.status === 'resolved' && r.resolution_note && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>"{r.resolution_note}"</p>
                    )}
                  </div>
                  {r.status === 'resolved' ? (
                    <button className="btn-secondary" onClick={() => reopen(r.id)} style={{ height: 'fit-content' }}>Reopen</button>
                  ) : (
                    <button className="btn-secondary" onClick={() => startResolve(r.id)} style={{ height: 'fit-content' }}>Mark Resolved</button>
                  )}
                </div>

                {resolvingId === r.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                    <label>Resolution note (optional)</label>
                    <textarea
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="e.g. Dropped off new supplies at the van this morning"
                      rows={2}
                      autoFocus
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={() => setResolvingId(null)}>Cancel</button>
                      <button className="btn-primary" onClick={() => confirmResolve(r.id)}>Confirm Resolved</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {section === 'timeoff' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className={timeOffFilter === 'pending' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTimeOffFilter('pending')}>Pending</button>
            <button className={timeOffFilter === 'approved' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTimeOffFilter('approved')}>Approved</button>
            <button className={timeOffFilter === 'declined' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTimeOffFilter('declined')}>Declined</button>
            <button className={timeOffFilter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTimeOffFilter('all')}>All</button>
          </div>

          {filteredTimeOff.length === 0 && <p className="empty-state">Nothing here.</p>}

          <div className="job-list">
            {filteredTimeOff.map((t) => (
              <div key={t.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h2>{t.type === 'holiday' ? 'Holiday' : 'Unavailable'}</h2>
                    <p style={{ fontSize: 14, margin: '4px 0' }}>
                      {new Date(t.start_date).toLocaleDateString()} – {new Date(t.end_date).toLocaleDateString()}
                      {t.type === 'holiday' && t.hours ? ` · ${t.hours}h requested` : ''}
                    </p>
                    {t.reason && <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 4px' }}>{t.reason}</p>}
                    <p className="job-time">
                      {t.profiles?.full_name || 'Unknown cleaner'} · {new Date(t.created_at).toLocaleString()}
                      {t.type === 'holiday' && holidayBalances[t.cleaner_id] !== undefined && (
                        ` · ${(holidayBalances[t.cleaner_id] - holidayHoursUsed(t.cleaner_id, timeOff)).toFixed(1)}h remaining`
                      )}
                    </p>
                    <span className={`badge ${t.status === 'approved' ? 'completed' : t.status === 'declined' ? 'missed' : 'scheduled'}`}>{t.status}</span>
                    {t.status !== 'pending' && t.admin_note && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>"{t.admin_note}"</p>
                    )}
                  </div>
                  {t.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8, height: 'fit-content' }}>
                      <button className="btn-secondary" onClick={() => startDecide(t.id, 'declined')}>Decline</button>
                      <button className="btn-primary" onClick={() => startDecide(t.id, 'approved')}>Approve</button>
                    </div>
                  )}
                </div>

                {decidingId === t.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                    <label>{decidingStatus === 'approved' ? 'Approve' : 'Decline'} — note (optional)</label>
                    <textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder={decidingStatus === 'approved' ? "e.g. Enjoy your holiday!" : "e.g. Can't cover this week, please pick another date"}
                      rows={2}
                      autoFocus
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={() => setDecidingId(null)}>Cancel</button>
                      <button className="btn-primary" onClick={() => confirmDecide(t.id)}>
                        Confirm {decidingStatus === 'approved' ? 'Approval' : 'Decline'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
