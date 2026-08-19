'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, MessageSquareWarning, Star } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import BackButton from '../components/BackButton';

export default function ClientDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');

  const [upcoming, setUpcoming] = useState([]);
  const [recent, setRecent] = useState([]);
  const [lastMessage, setLastMessage] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openReschedules, setOpenReschedules] = useState(0);
  const [cleansThisMonth, setCleansThisMonth] = useState(0);
  const [avgRating, setAvgRating] = useState(null);

  const [clientId, setClientId] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [requestText, setRequestText] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const [myPauses, setMyPauses] = useState([]);
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [pauseStart, setPauseStart] = useState('');
  const [pauseEnd, setPauseEnd] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [submittingPause, setSubmittingPause] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    if (!profile?.client_id) { setLoading(false); return; }
    const clientId = profile.client_id;
    setClientId(clientId);

    const { data: clientRow } = await supabase.from('clients').select('name').eq('id', clientId).single();
    setClientName(clientRow?.name || 'there');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      { data: jobs },
      { data: messages },
      { data: reschedules },
      { data: ratings },
      { data: requests },
      { data: pauses },
    ] = await Promise.all([
      supabase.from('jobs')
        .select('id, scheduled_at, status, properties(address), job_assignments(profiles(full_name))')
        .order('scheduled_at', { ascending: false }),
      supabase.from('client_messages')
        .select('id, sender, body, created_at, read_by_client')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase.from('reschedule_requests').select('id').eq('client_id', clientId).eq('status', 'pending'),
      supabase.from('job_ratings').select('rating').eq('client_id', clientId),
      supabase.from('client_requests')
        .select('id, description, status, resolution_note, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      supabase.from('client_pause_requests')
        .select('id, start_date, end_date, reason, status, admin_note, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
    ]);

    const allJobs = jobs || [];
    const upcomingJobs = allJobs
      .filter((j) => j.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, 5);
    const recentJobs = allJobs.filter((j) => j.status === 'completed').slice(0, 5);
    const completedThisMonth = allJobs.filter((j) => j.status === 'completed' && new Date(j.scheduled_at) >= startOfMonth).length;

    setUpcoming(upcomingJobs);
    setRecent(recentJobs);
    setCleansThisMonth(completedThisMonth);
    setMyRequests(requests || []);
    setMyPauses(pauses || []);
    const openRequestCount = (requests || []).filter((r) => r.status === 'open').length;
    const pendingPauseCount = (pauses || []).filter((p) => p.status === 'pending').length;
    setOpenReschedules((reschedules || []).length + openRequestCount + pendingPauseCount);

    const { data: { user } } = await supabase.auth.getUser();
    const msg = (messages || [])[0];
    setLastMessage(msg || null);
    setUnreadCount(msg && msg.sender === 'admin' && !msg.read_by_client ? 1 : 0);

    if ((ratings || []).length > 0) {
      setAvgRating(ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length);
    }

    setLoading(false);
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!requestText.trim() || !clientId) return;
    setSubmittingRequest(true);

    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from('client_requests')
      .insert({ client_id: clientId, description: requestText.trim(), created_by: session.user.id })
      .select('id, description, status, resolution_note, created_at')
      .single();

    setSubmittingRequest(false);
    if (!error && data) {
      setMyRequests((prev) => [data, ...prev]);
      setOpenReschedules((prev) => prev + 1);
      setRequestText('');
    }
  };

  const submitPause = async (e) => {
    e.preventDefault();
    if (!clientId || !pauseStart || !pauseEnd) return;
    setSubmittingPause(true);

    const { data, error } = await supabase
      .from('client_pause_requests')
      .insert({ client_id: clientId, start_date: pauseStart, end_date: pauseEnd, reason: pauseReason.trim() || null })
      .select('id, start_date, end_date, reason, status, admin_note, created_at')
      .single();

    setSubmittingPause(false);
    if (!error && data) {
      setMyPauses((prev) => [data, ...prev]);
      setOpenReschedules((prev) => prev + 1);
      setShowPauseForm(false);
      setPauseStart('');
      setPauseEnd('');
      setPauseReason('');
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Welcome back{clientName ? `, ${clientName}` : ''}</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#dbeafe' }}><CalendarClock size={18} color="#1e40af" /></div>
          </div>
          <div className="stat-number" style={{ fontSize: upcoming[0] ? 20 : 28 }}>
            {upcoming[0] ? new Date(upcoming[0].scheduled_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'None'}
          </div>
          <div className="stat-label">Next Clean</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#dcfce7' }}><CheckCircle2 size={18} color="#166534" /></div>
          </div>
          <div className="stat-number">{cleansThisMonth}</div>
          <div className="stat-label">Cleans This Month</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: openReschedules > 0 ? '#fef3c7' : '#f1f5f9' }}><MessageSquareWarning size={18} color={openReschedules > 0 ? '#92400e' : '#64748b'} /></div>
          </div>
          <div className="stat-number">{openReschedules}</div>
          <div className="stat-label">Open Requests</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#fef3c7' }}><Star size={18} color="#b45309" /></div>
          </div>
          <div className="stat-number">{avgRating ? avgRating.toFixed(1) : '—'}</div>
          <div className="stat-label">Average Rating Given</div>
        </div>
      </div>

      <div className="card">
        <h2>Need Something?</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
          Anything you'd like us to know - an extra job, a change to your clean, anything at all.
        </p>
        <form onSubmit={submitRequest}>
          <textarea
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            placeholder="e.g. Could you also do the windows this time?"
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
              background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
            }}
          />
          <button type="submit" disabled={submittingRequest || !requestText.trim()}>
            {submittingRequest ? 'Sending...' : 'Send Request'}
          </button>
        </form>

        {myRequests.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
            {myRequests.map((r) => (
              <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5 }}>{r.description}</span>
                  <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
                </div>
                {r.status === 'resolved' && r.resolution_note && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>"{r.resolution_note}"</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="dash-panel-header">
          <h2>Pause My Cleans</h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
          Going away, or having work done? Ask us to pause your cleans over a date range - no need to cancel altogether.
        </p>

        {showPauseForm ? (
          <form onSubmit={submitPause}>
            <div className="field-row">
              <div className="field">
                <label className="field-label">From</label>
                <input type="date" value={pauseStart} onChange={(e) => setPauseStart(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-label">To</label>
                <input type="date" value={pauseEnd} onChange={(e) => setPauseEnd(e.target.value)} required />
              </div>
            </div>
            <input
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Reason (optional)"
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowPauseForm(false)}>Cancel</button>
              <button type="submit" disabled={submittingPause}>
                {submittingPause ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setShowPauseForm(true)}>
            + Request a Pause
          </button>
        )}

        {myPauses.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
            {myPauses.map((p) => (
              <div key={p.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5 }}>
                    {new Date(p.start_date).toLocaleDateString()} – {new Date(p.end_date).toLocaleDateString()}
                    {p.reason && <span style={{ color: 'var(--muted)' }}> · {p.reason}</span>}
                  </span>
                  <span className={`badge ${p.status === 'approved' ? 'completed' : p.status === 'declined' ? 'missed' : 'scheduled'}`}>{p.status}</span>
                </div>
                {p.status !== 'pending' && p.admin_note && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>"{p.admin_note}"</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-grid-2">
        <div className="card">
          <div className="dash-panel-header">
            <h2>Upcoming Visits</h2>
            <Link href="/client/history" className="dash-panel-link">View history &rarr;</Link>
          </div>
          {upcoming.length === 0 && <p className="empty-state">Nothing scheduled right now.</p>}
          {upcoming.map((job) => {
            const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
            return (
              <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
                <div>
                  <div className="dash-row-title">{job.properties?.address}</div>
                  <div className="dash-row-subtitle">
                    {new Date(job.scheduled_at).toLocaleString()} · {names.length > 0 ? names.join(', ') : 'Unassigned'}
                  </div>
                </div>
                <span className="badge scheduled">scheduled</span>
              </Link>
            );
          })}
        </div>

        <div className="card">
          <div className="dash-panel-header">
            <h2>Messages</h2>
            <Link href="/client/messages" className="dash-panel-link">Open &rarr;</Link>
          </div>
          {!lastMessage && <p className="empty-state">No messages yet - say hello!</p>}
          {lastMessage && (
            <Link href="/client/messages" className="dash-row">
              <div>
                <div className="dash-row-title">
                  {lastMessage.sender === 'client' ? 'You' : 'CrewConnect'}
                  {unreadCount > 0 && <span className="badge missed" style={{ marginLeft: 6 }}>new</span>}
                </div>
                <div className="dash-row-subtitle">{lastMessage.body}</div>
              </div>
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="dash-panel-header">
          <h2>Recent Activity</h2>
          <Link href="/client/history" className="dash-panel-link">View all &rarr;</Link>
        </div>
        {recent.length === 0 && <p className="empty-state">No completed cleans yet.</p>}
        {recent.map((job) => {
          const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
          return (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{job.properties?.address}</div>
                <div className="dash-row-subtitle">
                  {new Date(job.scheduled_at).toLocaleString()} · {names.length > 0 ? names.join(', ') : 'Unassigned'}
                </div>
              </div>
              <span className="badge completed">completed</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
