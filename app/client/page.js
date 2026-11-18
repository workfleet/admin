'use client';

import { PageSkeleton } from '../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { siteStatusFor, visitsToShow } from '../../lib/siteStatus';
import ClientSitePicker, { useClientSite, atSite, ALL_SITES } from '../components/ClientSitePicker';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, MessageSquareWarning, Star, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import BackButton from '../components/BackButton';
import SiteAccessNotes from '../components/SiteAccessNotes';
import ClientSiteRequestForm from '../components/ClientSiteRequestForm';

// "Wed 25 Nov, 14:00" - the year only when it isn't this one, no seconds.
function visitTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}

const WELCOME_KEY = 'client-portal-welcomed-';

export default function ClientDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [userId, setUserId] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);

  const [allJobs, setAllJobs] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [lastMessage, setLastMessage] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openReschedules, setOpenReschedules] = useState(0);
  const [avgRating, setAvgRating] = useState(null);

  const [clientId, setClientId] = useState(null);
  const { sites, site, setSite } = useClientSite(clientId);

  // Visits, cut down to the site picked (or all of them). Requests, pauses,
  // messages and ratings belong to the client as a whole, not a site.
  const { upcoming, recent, todayVisits, cleansThisMonth } = useMemo(() => {
    const jobs = allJobs.filter((j) => atSite(j, site));
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const byJob = {};
    jobs.forEach((j) => { byJob[j.id] = j.checkins || []; });
    return {
      // From today on: a booked visit from an earlier day that never
      // started isn't "next".
      upcoming: jobs
        .filter((j) => j.status === 'scheduled' && new Date(j.scheduled_at) >= startOfToday)
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
        .slice(0, 5),
      recent: jobs.filter((j) => j.status === 'completed').slice(0, 5),
      // Today's visits, live. The check-in rows come back on each job, so
      // the status line is computed from what the cleaner's phone last said.
      todayVisits: visitsToShow(jobs, byJob).map((j) => ({ job: j, status: siteStatusFor(j, j.checkins || []) })),
      cleansThisMonth: jobs.filter((j) => j.status === 'completed' && new Date(j.scheduled_at) >= startOfMonth).length,
    };
  }, [allJobs, site]);

  const [myRequests, setMyRequests] = useState([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const [myPauses, setMyPauses] = useState([]);
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [pauseStart, setPauseStart] = useState('');
  const [pauseEnd, setPauseEnd] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [submittingPause, setSubmittingPause] = useState(false);
  // 'extra_work' | 'supplies' while one of those forms is open (0148).
  const [siteForm, setSiteForm] = useState(null);
  const [sentNote, setSentNote] = useState('');
  const [quotesWaiting, setQuotesWaiting] = useState(0);

  useEffect(() => {
    load();
    // "Is anyone at my house?" should answer itself. One reload a minute
    // while the tab is on screen keeps the visit line and the updates
    // current without a live channel.
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id, full_name').eq('id', session.user.id).single();
    if (!profile?.client_id) { setLoading(false); return; }
    const clientId = profile.client_id;
    setClientId(clientId);
    setUserId(session.user.id);
    setFirstName((profile.full_name || '').trim().split(/\s+/)[0] || '');

    // Shown once per login on this device, until they close it.
    try { setShowWelcome(!window.localStorage.getItem(WELCOME_KEY + session.user.id)); } catch { setShowWelcome(false); }

    const { data: clientRow } = await supabase.from('clients').select('name').eq('id', clientId).single();
    setClientName(clientRow?.name || '');

    const [
      { data: jobs },
      { data: messages },
      { data: reschedules },
      { data: ratings },
      { data: requests },
      { data: pauses },
    ] = await Promise.all([
      supabase.from('jobs')
        .select('id, property_id, scheduled_at, status, duration_minutes, properties(address), job_assignments(profiles(full_name)), checkins(id, cleaner_id, checked_in_at, checked_out_at, profiles(full_name))')
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

    setAllJobs(jobs || []);

    // What the app has told this client lately - arrivals, departures,
    // replies - the same bell entries that reach their phone.
    const { data: notes } = await supabase
      .from('notifications')
      .select('id, message, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setUpdates(notes || []);
    setMyRequests(requests || []);
    setMyPauses(pauses || []);
    const openRequestCount = (requests || []).filter((r) => r.status === 'open').length;
    const pendingPauseCount = (pauses || []).filter((p) => p.status === 'pending').length;
    setOpenReschedules((reschedules || []).length + openRequestCount + pendingPauseCount);

    const msg = (messages || [])[0];
    setLastMessage(msg || null);
    setUnreadCount(msg && msg.sender === 'admin' && !msg.read_by_client ? 1 : 0);

    // Quotes we've sent that still need an answer (0148). Quiet if the
    // function isn't there yet.
    const { data: myQuotes } = await supabase.rpc('client_quotes');
    setQuotesWaiting((myQuotes || []).filter((q) => q.status === 'sent').length);

    if ((ratings || []).length > 0) {
      setAvgRating(ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length);
    }

    setLoading(false);
  };

  const dismissWelcome = () => {
    setShowWelcome(false);
    try { window.localStorage.setItem(WELCOME_KEY + userId, '1'); } catch { /* shows again next time */ }
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
      setShowRequestForm(false);
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

  if (loading) return <PageSkeleton className="" variant="dashboard" rows={3} />;

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const names = (job) => {
    const list = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
    return list.length > 0 ? list.join(', ') : 'Cleaner to be confirmed';
  };
  // Only the requests still waiting, and answers from the last month, so
  // the card doesn't grow forever.
  const monthAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const recentRequests = myRequests.filter((r) => r.status === 'open' || new Date(r.created_at).getTime() >= monthAgo);
  const recentPauses = myPauses.filter((p) => p.status === 'pending' || new Date(p.end_date).getTime() >= Date.now());

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Welcome back{firstName ? `, ${firstName}` : ''}</h1>
          <p className="page-subtitle">{clientName ? `${clientName} · ` : ''}{today}</p>
        </div>
      </div>

      <ClientSitePicker sites={sites} site={site} setSite={setSite} />

      {showWelcome && (
        <div className="card client-welcome">
          <button type="button" className="client-welcome-close" onClick={dismissWelcome} aria-label="Close" title="Close">
            <X size={18} />
          </button>
          <h2>Welcome to your client portal</h2>
          <p>Everything about your cleans with CrewConnect, in one place:</p>
          <ul>
            <li><strong>Today</strong> shows when your cleaner arrives and leaves, live.</li>
            <li><Link href="/client/history">History</Link> lists what&rsquo;s booked and every clean so far - tap one for its report, photos, to move it or to rate it.</li>
            {sites && sites.length > 1 && <li>Pick a site at the top to see just that property.</li>}
            <li><Link href="/client/messages">Messages</Link> reach our office directly, and <Link href="/client/documents">Documents</Link> holds the paperwork we&rsquo;ve shared.</li>
            <li>Add door codes or key details for your cleaners in <Link href="/client/settings">Settings</Link>.</li>
          </ul>
          <button type="button" onClick={dismissWelcome}>Got it</button>
        </div>
      )}

      {quotesWaiting > 0 && (
        <Link href="/client/quotes" className="card client-quote-nudge">
          <strong>{quotesWaiting === 1 ? 'A quote is waiting for you' : `${quotesWaiting} quotes are waiting for you`}</strong>
          <span>Have a look and accept or decline &rarr;</span>
        </Link>
      )}

      {/* Live, from the cleaner's own check-in: on site since when, finished
          at what time, or not arrived yet. Refreshes on its own. Only when
          there's a visit today. */}
      {todayVisits.length > 0 && (
        <div className="card">
          <div className="dash-panel-header">
            <h2>Today</h2>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Live</span>
          </div>
          {todayVisits.map(({ job, status }) => (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{job.properties?.address}</div>
                <div className="dash-row-subtitle">
                  <span
                    className="dash-glance-dot"
                    style={{
                      display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                      background: status.state === 'on_site' ? 'var(--wf-verified)'
                        : status.state === 'finished' ? 'var(--wf-steel)'
                        : status.state === 'late' || status.state === 'past' || status.state === 'missed' ? 'var(--wf-overdue)'
                        : 'var(--wf-azure)',
                    }}
                  />
                  <strong>{status.label}</strong>{status.detail ? ` · ${status.detail}` : ''}
                </div>
              </div>
              <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'var(--wf-ash)' }}><CalendarClock size={18} color="var(--wf-steel)" /></div>
          </div>
          <div className="stat-number" style={{ fontSize: upcoming[0] ? 20 : 28 }}>
            {upcoming[0] ? new Date(upcoming[0].scheduled_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'None'}
          </div>
          <div className="stat-label">
            {upcoming[0] ? `Next clean, ${new Date(upcoming[0].scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Next clean'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'rgba(52, 199, 123, 0.16)' }}><CheckCircle2 size={18} color="var(--wf-verified-ink)" /></div>
          </div>
          <div className="stat-number">{cleansThisMonth}</div>
          <div className="stat-label">Cleans done this month</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: openReschedules > 0 ? 'rgba(216, 30, 52, 0.12)' : 'var(--wf-ash)' }}><MessageSquareWarning size={18} color={openReschedules > 0 ? 'var(--wf-overdue)' : 'var(--wf-steel)'} /></div>
          </div>
          <div className="stat-number">{openReschedules}</div>
          <div className="stat-label">Requests waiting for us</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: 'var(--wf-ash)' }}><Star size={18} color="var(--wf-steel)" /></div>
          </div>
          <div className="stat-number">{avgRating ? avgRating.toFixed(1) : '—'}</div>
          <div className="stat-label">{avgRating ? 'Your average rating' : 'Rate a clean from History'}</div>
        </div>
      </div>

      <div className="dash-grid-2">
        <div className="card">
          <div className="dash-panel-header">
            <h2>Coming up</h2>
            <Link href="/client/history" className="dash-panel-link">All visits &rarr;</Link>
          </div>
          {upcoming.length === 0 && <p className="empty-state">Nothing booked right now.</p>}
          {upcoming.map((job) => (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{site === ALL_SITES ? job.properties?.address : visitTime(job.scheduled_at)}</div>
                <div className="dash-row-subtitle">
                  {site === ALL_SITES ? `${visitTime(job.scheduled_at)} · ${names(job)}` : names(job)}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="card">
          <div className="dash-panel-header">
            <h2>Recent cleans</h2>
            <Link href="/client/history" className="dash-panel-link">All visits &rarr;</Link>
          </div>
          {recent.length === 0 && <p className="empty-state">No finished cleans yet.</p>}
          {recent.map((job) => (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{site === ALL_SITES ? job.properties?.address : visitTime(job.scheduled_at)}</div>
                <div className="dash-row-subtitle">
                  {site === ALL_SITES ? `${visitTime(job.scheduled_at)} · ${names(job)}` : names(job)}
                </div>
              </div>
              <span className="badge completed">done</span>
            </Link>
          ))}
        </div>
      </div>

      {site !== ALL_SITES && <SiteAccessNotes propertyId={site} />}

      <div className="card">
        <h2>Need anything?</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
          An extra job, a change to your clean, or a break while you&rsquo;re away. To move a single visit, open it from Coming up.
        </p>

        {sentNote && !showRequestForm && !showPauseForm && !siteForm && (
          <p style={{ fontSize: 13.5, color: 'var(--wf-verified-ink)', margin: '0 0 10px' }}>{sentNote}</p>
        )}

        {!showRequestForm && !showPauseForm && !siteForm && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { setSentNote(''); setShowRequestForm(true); }}>Send a request</button>
            <button type="button" className="btn-secondary" onClick={() => { setSentNote(''); setSiteForm('extra_work'); }} title="Ask for a deep clean, windows or other extra work - we'll send you a price">
              Ask for extra work
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setSentNote(''); setSiteForm('supplies'); }} title="Tell us what's running low at a site">
              Supplies running low
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setSentNote(''); setShowPauseForm(true); }} title="Ask us to pause your cleans for a period">
              Pause my cleans
            </button>
          </div>
        )}

        {siteForm && (
          <ClientSiteRequestForm
            key={siteForm}
            kind={siteForm}
            clientId={clientId}
            sites={sites}
            defaultSite={site !== ALL_SITES ? site : ''}
            onCancel={() => setSiteForm(null)}
            onSent={(row) => {
              setMyRequests((prev) => [row, ...prev]);
              setOpenReschedules((prev) => prev + 1);
              setSentNote(siteForm === 'supplies'
                ? "Thanks - we've got your supplies list and will bring them on the next visit."
                : "Thanks - we'll price that up and send you a quote to accept under Quotes.");
              setSiteForm(null);
            }}
          />
        )}

        {showRequestForm && (
          <form onSubmit={submitRequest}>
            <textarea
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              placeholder="e.g. Could you also do the windows this time?"
              rows={3}
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowRequestForm(false)}>Cancel</button>
              <button type="submit" disabled={submittingRequest || !requestText.trim()}>
                {submittingRequest ? 'Sending...' : 'Send request'}
              </button>
            </div>
          </form>
        )}

        {showPauseForm && (
          <form onSubmit={submitPause}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
              Going away, or having work done? We&rsquo;ll pause your cleans over these dates - no need to cancel.
            </p>
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
                {submittingPause ? 'Sending...' : 'Send request'}
              </button>
            </div>
          </form>
        )}

        {(recentRequests.length > 0 || recentPauses.length > 0) && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
            {recentRequests.map((r) => (
              <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5 }}>{r.description}</span>
                  <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status === 'resolved' ? 'done' : 'with us'}</span>
                </div>
                {r.status === 'resolved' && r.resolution_note && (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>"{r.resolution_note}"</div>
                )}
              </div>
            ))}
            {recentPauses.map((p) => (
              <div key={p.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5 }}>
                    Pause {new Date(p.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(p.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {p.reason && <span style={{ color: 'var(--muted)' }}> · {p.reason}</span>}
                  </span>
                  <span className={`badge ${p.status === 'approved' ? 'completed' : p.status === 'declined' ? 'missed' : 'scheduled'}`}>
                    {p.status === 'pending' ? 'with us' : p.status}
                  </span>
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
            <h2>Messages</h2>
            <Link href="/client/messages" className="dash-panel-link">Open &rarr;</Link>
          </div>
          {!lastMessage && <p className="empty-state">No messages yet. Send us one any time.</p>}
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

        <div className="card">
          <div className="dash-panel-header">
            <h2>Recent updates</h2>
          </div>
          {updates.length === 0 && <p className="empty-state">Arrivals, departures and replies will show here.</p>}
          {updates.map((n) => (
            <div key={n.id} className="dash-row dash-row-quiet">
              <div>
                <div style={{ fontSize: 13.5 }}>{n.message}</div>
                <div className="dash-row-subtitle">{visitTime(n.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
