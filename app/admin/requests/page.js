'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

function holidayHoursUsed(cleanerId, timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.cleaner_id === cleanerId && t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
}

export default function AdminRequests() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [section, setSection] = useState('requests'); // requests | timeoff | extensions | reschedules
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

  // time extension requests
  const [extensions, setExtensions] = useState([]);
  const [extensionFilter, setExtensionFilter] = useState('pending'); // pending | decided | all
  const [decidingExtensionId, setDecidingExtensionId] = useState(null);
  const [decidingExtensionAction, setDecidingExtensionAction] = useState(null); // approved | declined | alternative_suggested
  const [extensionAdminNote, setExtensionAdminNote] = useState('');
  const [altDate, setAltDate] = useState('');
  const [altHour, setAltHour] = useState('09');
  const [altMinute, setAltMinute] = useState('00');
  const [altDuration, setAltDuration] = useState(120);

  // client reschedule requests
  const [reschedules, setReschedules] = useState([]);
  const [rescheduleFilter, setRescheduleFilter] = useState('pending'); // pending | decided | all
  const [decidingRescheduleId, setDecidingRescheduleId] = useState(null);
  const [rescheduleAdminNote, setRescheduleAdminNote] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: requestsData }, { data: timeOffData }, { data: cleanerProfiles }, { data: assignmentsData }, { data: extensionsData }, { data: reschedulesData }] = await Promise.all([
      supabase
        .from('staff_requests')
        .select('id, type, description, status, created_at, resolved_at, resolution_note, resolved_by, cleaner_id, profiles!staff_requests_cleaner_id_fkey(full_name), resolver:profiles!staff_requests_resolved_by_fkey(full_name), jobs(scheduled_at, properties(address))')
        .order('created_at', { ascending: false }),
      supabase
        .from('time_off_requests')
        .select('id, type, start_date, end_date, hours, reason, status, admin_note, created_at, cleaner_id, decided_by, profiles!time_off_requests_cleaner_id_fkey(full_name), decider:profiles!time_off_requests_decided_by_fkey(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, holiday_adjustment_hours').eq('role', 'cleaner'),
      supabase.from('job_assignments').select('cleaner_id, jobs(id, status, duration_minutes)'),
      supabase
        .from('time_extension_requests')
        .select('id, job_id, requested_minutes, reason, status, admin_note, suggested_scheduled_at, suggested_duration_minutes, created_at, cleaner_id, decided_by, profiles!time_extension_requests_cleaner_id_fkey(full_name), decider:profiles!time_extension_requests_decided_by_fkey(full_name), jobs(scheduled_at, duration_minutes, properties(address))')
        .order('created_at', { ascending: false }),
      supabase
        .from('reschedule_requests')
        .select('id, job_id, requested_scheduled_at, reason, status, admin_note, created_at, client_id, clients(name), decider:profiles!reschedule_requests_decided_by_fkey(full_name), jobs(scheduled_at, duration_minutes, status, properties(address), job_assignments(cleaner_id, profiles(full_name)))')
        .order('created_at', { ascending: false }),
    ]);

    // A job's duration is split evenly across everyone assigned to it.
    const assigneeCounts = {};
    (assignmentsData || []).forEach((row) => {
      if (!row.jobs) return;
      assigneeCounts[row.jobs.id] = (assigneeCounts[row.jobs.id] || 0) + 1;
    });

    const balanceMap = {};
    (cleanerProfiles || []).forEach((p) => {
      const worked = (assignmentsData || [])
        .filter((row) => row.cleaner_id === p.id && row.jobs?.status === 'completed')
        .reduce((sum, row) => sum + (row.jobs.duration_minutes || 0) / (assigneeCounts[row.jobs.id] || 1), 0) / 60;
      balanceMap[p.id] = worked * HOLIDAY_ACCRUAL_RATE + (p.holiday_adjustment_hours || 0);
    });
    setHolidayBalances(balanceMap);
    setRequests(requestsData || []);
    setTimeOff(timeOffData || []);
    setExtensions(extensionsData || []);
    setReschedules(reschedulesData || []);
    setLoading(false);
  };

  const startResolve = (id) => {
    setResolvingId(id);
    setResolutionNote('');
  };

  const confirmResolve = async (id) => {
    const target = requests.find((r) => r.id === id);
    const { data: { session } } = await supabase.auth.getSession();
    const { data } = await supabase
      .from('staff_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: session.user.id, resolution_note: resolutionNote.trim() || null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note, resolved_by, resolver:profiles!staff_requests_resolved_by_fkey(full_name)')
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
      .update({ status: 'open', resolved_at: null, resolution_note: null, resolved_by: null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note, resolved_by, resolver:profiles!staff_requests_resolved_by_fkey(full_name)')
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

    if (decidingStatus === 'approved' && target?.cleaner_id) {
      const dayAfterEnd = new Date(target.end_date);
      dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);

      const { data: existingAssignments } = await supabase
        .from('job_assignments')
        .select('jobs!inner(id, scheduled_at, properties(address))')
        .eq('cleaner_id', target.cleaner_id)
        .gte('jobs.scheduled_at', new Date(target.start_date).toISOString())
        .lt('jobs.scheduled_at', dayAfterEnd.toISOString());

      const existingJobs = (existingAssignments || []).map((row) => row.jobs).filter(Boolean);

      if (existingJobs.length > 0) {
        const proceed = await confirm(
          `${target.profiles?.full_name || 'This cleaner'} already has ${existingJobs.length} job${existingJobs.length === 1 ? '' : 's'} scheduled during this period (first: ${existingJobs[0].properties?.address} on ${new Date(existingJobs[0].scheduled_at).toLocaleDateString()}). Approve anyway?`,
          { title: 'Scheduling conflict', confirmLabel: 'Approve anyway' }
        );
        if (!proceed) return;
      }
    }

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('time_off_requests')
      .update({ status: decidingStatus, admin_note: adminNote.trim() || null, decided_by: session.user.id, decided_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status, admin_note, decided_by, decider:profiles!time_off_requests_decided_by_fkey(full_name)')
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

  const startDecideExtension = (id, action) => {
    setDecidingExtensionId(id);
    setDecidingExtensionAction(action);
    setExtensionAdminNote('');
    const target = extensions.find((r) => r.id === id);
    const d = target?.jobs?.scheduled_at ? new Date(target.jobs.scheduled_at) : new Date();
    setAltDate(d.toISOString().slice(0, 10));
    setAltHour(String(d.getHours()).padStart(2, '0'));
    setAltMinute(String(d.getMinutes() - (d.getMinutes() % 15)).padStart(2, '0'));
    setAltDuration(target?.jobs?.duration_minutes || 120);
  };

  const confirmDecideExtension = async (id) => {
    const target = extensions.find((r) => r.id === id);
    if (!target) return;

    const updates = {
      status: decidingExtensionAction,
      admin_note: extensionAdminNote.trim() || null,
    };

    if (decidingExtensionAction === 'alternative_suggested') {
      updates.suggested_scheduled_at = new Date(`${altDate}T${altHour}:${altMinute}`).toISOString();
      updates.suggested_duration_minutes = altDuration;
    }

    const { data: { session } } = await supabase.auth.getSession();
    updates.decided_by = session.user.id;
    updates.decided_at = new Date().toISOString();

    const { data } = await supabase
      .from('time_extension_requests')
      .update(updates)
      .eq('id', id)
      .select('id, status, admin_note, suggested_scheduled_at, suggested_duration_minutes, decided_by, decider:profiles!time_extension_requests_decided_by_fkey(full_name)')
      .single();

    if (!data) { setDecidingExtensionId(null); return; }

    // Approving actually extends the job - not just marking the request
    // approved - by adding the requested minutes onto its current duration.
    if (decidingExtensionAction === 'approved') {
      const newDuration = (target.jobs?.duration_minutes || 0) + target.requested_minutes;
      await supabase.from('jobs').update({ duration_minutes: newDuration }).eq('id', target.job_id);
    }

    setExtensions((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));

    notify({
      type: 'time_extension_decided',
      cleanerId: target.cleaner_id,
      status: data.status,
      address: target.jobs?.properties?.address,
      requestedMinutes: target.requested_minutes,
      suggestedScheduledAt: data.suggested_scheduled_at,
      suggestedDuration: data.suggested_duration_minutes,
      note: data.admin_note,
    });

    setDecidingExtensionId(null);
  };

  const startDecideReschedule = (id) => {
    setDecidingRescheduleId(id);
    setRescheduleAdminNote('');
  };

  const confirmDecideReschedule = async (id, status) => {
    const target = reschedules.find((r) => r.id === id);
    if (!target) return;

    if (status === 'approved') {
      const assignedCleanerIds = (target.jobs?.job_assignments || []).map((a) => a.cleaner_id);
      if (assignedCleanerIds.length > 0) {
        const newStart = new Date(target.requested_scheduled_at);
        const newEnd = new Date(newStart.getTime() + (target.jobs?.duration_minutes || 120) * 60000);
        const { data: otherAssignments } = await supabase
          .from('job_assignments')
          .select('jobs!inner(id, scheduled_at, duration_minutes, properties(address))')
          .in('cleaner_id', assignedCleanerIds)
          .neq('jobs.id', target.job_id);

        const conflict = (otherAssignments || [])
          .map((a) => a.jobs)
          .find((j) => {
            const jStart = new Date(j.scheduled_at);
            const jEnd = new Date(jStart.getTime() + (j.duration_minutes || 120) * 60000);
            return newStart < jEnd && jStart < newEnd;
          });

        if (conflict) {
          const proceed = await confirm(
            `The assigned cleaner already has a job at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Approve anyway?`,
            { title: 'Scheduling conflict', confirmLabel: 'Approve anyway' }
          );
          if (!proceed) return;
        }
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const { data } = await supabase
      .from('reschedule_requests')
      .update({
        status,
        admin_note: rescheduleAdminNote.trim() || null,
        decided_by: session.user.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, admin_note, decided_by, decider:profiles!reschedule_requests_decided_by_fkey(full_name)')
      .single();

    if (!data) { setDecidingRescheduleId(null); return; }

    if (status === 'approved') {
      await supabase.from('jobs').update({ scheduled_at: target.requested_scheduled_at }).eq('id', target.job_id);
    }

    setReschedules((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    toast.success(status === 'approved' ? 'Reschedule approved and job updated.' : 'Reschedule declined.');
    setDecidingRescheduleId(null);
  };

  const filteredReschedules = reschedules.filter((r) => {
    if (rescheduleFilter === 'all') return true;
    if (rescheduleFilter === 'pending') return r.status === 'pending';
    return r.status !== 'pending';
  });
  const pendingRescheduleCount = reschedules.filter((r) => r.status === 'pending').length;

  const filteredRequests = requests.filter((r) => filter === 'all' || r.status === filter);
  const openCount = requests.filter((r) => r.status === 'open').length;

  const filteredTimeOff = timeOff.filter((t) => timeOffFilter === 'all' || t.status === timeOffFilter);
  const pendingCount = timeOff.filter((t) => t.status === 'pending').length;

  const filteredExtensions = extensions.filter((r) => extensionFilter === 'all' || (extensionFilter === 'decided' ? r.status !== 'pending' : r.status === extensionFilter));
  const pendingExtensionCount = extensions.filter((r) => r.status === 'pending').length;

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Requests</h1>
          <p className="page-subtitle">Kit top-ups, issues, time off, and extra time requested by staff</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={section === 'requests' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('requests')}>
            Kit &amp; Issues ({openCount})
          </button>
          <button className={section === 'timeoff' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('timeoff')}>
            Time Off ({pendingCount})
          </button>
          <button className={section === 'extensions' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('extensions')}>
            Time Extensions ({pendingExtensionCount})
          </button>
          <button className={section === 'reschedules' ? 'btn-primary' : 'btn-secondary'} onClick={() => setSection('reschedules')}>
            Reschedules ({pendingRescheduleCount})
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
                    {r.status === 'resolved' && (
                      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                        Resolved by {r.resolver?.full_name || 'Unknown'}{r.resolved_at && ` · ${new Date(r.resolved_at).toLocaleString()}`}
                      </p>
                    )}
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
                    {t.status !== 'pending' && (
                      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                        {t.status === 'approved' ? 'Approved' : 'Declined'} by {t.decider?.full_name || 'Unknown'}
                      </p>
                    )}
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

      {section === 'extensions' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className={extensionFilter === 'pending' ? 'btn-primary' : 'btn-secondary'} onClick={() => setExtensionFilter('pending')}>Pending</button>
            <button className={extensionFilter === 'decided' ? 'btn-primary' : 'btn-secondary'} onClick={() => setExtensionFilter('decided')}>Decided</button>
            <button className={extensionFilter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setExtensionFilter('all')}>All</button>
          </div>

          {filteredExtensions.length === 0 && <p className="empty-state">Nothing here.</p>}

          <div className="job-list">
            {filteredExtensions.map((r) => (
              <div key={r.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h2>+{r.requested_minutes} minutes</h2>
                    <p style={{ fontSize: 14, margin: '4px 0' }}>
                      {r.jobs?.properties?.address || 'Job no longer exists'}
                      {r.jobs?.scheduled_at && ` · currently ${r.jobs.duration_minutes} min, starts ${new Date(r.jobs.scheduled_at).toLocaleString()}`}
                    </p>
                    {r.reason && <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 4px' }}>{r.reason}</p>}
                    <p className="job-time">
                      {r.profiles?.full_name || 'Unknown cleaner'} · {new Date(r.created_at).toLocaleString()}
                    </p>
                    <span className={`badge ${r.status === 'approved' ? 'completed' : r.status === 'declined' ? 'missed' : r.status === 'alternative_suggested' ? 'in_progress' : 'scheduled'}`}>
                      {r.status === 'alternative_suggested' ? 'alternative suggested' : r.status}
                    </span>
                    {r.status === 'alternative_suggested' && r.suggested_scheduled_at && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                        Suggested: {new Date(r.suggested_scheduled_at).toLocaleString()} · {r.suggested_duration_minutes} min
                      </p>
                    )}
                    {r.status !== 'pending' && (
                      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                        Decided by {r.decider?.full_name || 'Unknown'}
                      </p>
                    )}
                    {r.status !== 'pending' && r.admin_note && (
                      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>"{r.admin_note}"</p>
                    )}
                  </div>
                  {r.status === 'pending' && r.jobs && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, height: 'fit-content', justifyContent: 'flex-end' }}>
                      <button className="btn-secondary" onClick={() => startDecideExtension(r.id, 'declined')}>Decline</button>
                      <button className="btn-secondary" onClick={() => startDecideExtension(r.id, 'alternative_suggested')}>Suggest Alternative</button>
                      <button className="btn-primary" onClick={() => startDecideExtension(r.id, 'approved')}>Approve</button>
                    </div>
                  )}
                </div>

                {decidingExtensionId === r.id && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                    {decidingExtensionAction === 'alternative_suggested' && (
                      <div className="field-row" style={{ marginBottom: 10 }}>
                        <div className="field">
                          <label className="field-label">New date &amp; time</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input type="date" value={altDate} onChange={(e) => setAltDate(e.target.value)} style={{ marginBottom: 0 }} />
                            <select value={altHour} onChange={(e) => setAltHour(e.target.value)} style={{ marginBottom: 0 }}>
                              {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map((h) => (
                                <option key={h} value={h}>{h}:00</option>
                              ))}
                            </select>
                            <select value={altMinute} onChange={(e) => setAltMinute(e.target.value)} style={{ marginBottom: 0 }}>
                              {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>:{m}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="field">
                          <label className="field-label">Duration (min)</label>
                          <input type="number" min="15" step="15" value={altDuration} onChange={(e) => setAltDuration(Number(e.target.value))} />
                        </div>
                      </div>
                    )}
                    <label>
                      {decidingExtensionAction === 'approved' ? 'Approve' : decidingExtensionAction === 'declined' ? 'Decline' : 'Suggest alternative'} — note (optional)
                    </label>
                    <textarea
                      value={extensionAdminNote}
                      onChange={(e) => setExtensionAdminNote(e.target.value)}
                      placeholder={decidingExtensionAction === 'approved' ? 'e.g. No problem, take the time you need' : "e.g. Can't extend today, but here's another slot"}
                      rows={2}
                      autoFocus
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={() => setDecidingExtensionId(null)}>Cancel</button>
                      <button className="btn-primary" onClick={() => confirmDecideExtension(r.id)}>
                        Confirm {decidingExtensionAction === 'approved' ? 'Approval' : decidingExtensionAction === 'declined' ? 'Decline' : 'Suggestion'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {section === 'reschedules' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className={rescheduleFilter === 'pending' ? 'btn-primary' : 'btn-secondary'} onClick={() => setRescheduleFilter('pending')}>Pending</button>
            <button className={rescheduleFilter === 'decided' ? 'btn-primary' : 'btn-secondary'} onClick={() => setRescheduleFilter('decided')}>Decided</button>
            <button className={rescheduleFilter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setRescheduleFilter('all')}>All</button>
          </div>

          {filteredReschedules.length === 0 && <p className="empty-state">Nothing here.</p>}

          <div className="job-list">
            {filteredReschedules.map((r) => {
              const cleanerNames = (r.jobs?.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
              return (
                <div key={r.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <h2>{r.clients?.name || 'Unknown client'}</h2>
                      <p style={{ fontSize: 14, margin: '4px 0' }}>
                        {r.jobs?.properties?.address}
                        {r.jobs?.scheduled_at && ` · currently ${new Date(r.jobs.scheduled_at).toLocaleString()}`}
                      </p>
                      <p style={{ fontSize: 14, margin: '0 0 4px', fontWeight: 600 }}>
                        Requested: {new Date(r.requested_scheduled_at).toLocaleString()}
                      </p>
                      {r.reason && <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 4px' }}>{r.reason}</p>}
                      <p className="job-time">
                        {cleanerNames.length > 0 ? cleanerNames.join(', ') : 'Unassigned'} · {new Date(r.created_at).toLocaleString()}
                      </p>
                      <span className={`badge ${r.status === 'approved' ? 'completed' : r.status === 'declined' ? 'missed' : 'scheduled'}`}>{r.status}</span>
                      {r.status !== 'pending' && (
                        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                          Decided by {r.decider?.full_name || 'Unknown'}
                        </p>
                      )}
                      {r.status !== 'pending' && r.admin_note && (
                        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>"{r.admin_note}"</p>
                      )}
                    </div>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8, height: 'fit-content' }}>
                        <button className="btn-secondary" onClick={() => startDecideReschedule(r.id)}>Decline</button>
                        <button className="btn-primary" onClick={() => startDecideReschedule(r.id)}>Approve</button>
                      </div>
                    )}
                  </div>

                  {decidingRescheduleId === r.id && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                      <label>Note (optional)</label>
                      <textarea
                        value={rescheduleAdminNote}
                        onChange={(e) => setRescheduleAdminNote(e.target.value)}
                        placeholder="e.g. No problem, we've moved it"
                        rows={2}
                        autoFocus
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-secondary" onClick={() => setDecidingRescheduleId(null)}>Cancel</button>
                        <button className="btn-secondary" onClick={() => confirmDecideReschedule(r.id, 'declined')}>Confirm Decline</button>
                        <button className="btn-primary" onClick={() => confirmDecideReschedule(r.id, 'approved')}>Confirm Approval</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
