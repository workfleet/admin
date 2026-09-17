'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X, Clock, CalendarDays, TreePalm, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { purgeOldNotifications } from '../../lib/notifications';
import { getWorkAnniversaryYears } from '../../lib/workAnniversary';
import WorkAnniversaryPopup from '../components/WorkAnniversaryPopup';
import ShiftCoverCard from '../components/ShiftCoverCard';
import KeyHoldingsCard from '../components/KeyHoldingsCard';
import BackButton from '../components/BackButton';
import { KIT_PRODUCTS } from '../../lib/kitProducts';
import { HOLIDAY_ACCRUAL_RATE, assignedJob, fetchAssigneeCounts, hoursWorked, formatHours } from '../../lib/hoursWorked';
import {
  greetingFor, firstNameOf, splitJobsForHome, hoursThisWeek, hoursLeftThisWeek,
  jobsCompletedThisMonth, daySummary,
} from '../../lib/homeSummary';

function clock(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function statusWord(status) {
  return status.replace('_', ' ');
}

export default function CleanerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anniversary, setAnniversary] = useState(null);
  const [userId, setUserId] = useState(null);
  const [firstName, setFirstName] = useState('there');
  const [assigneeCounts, setAssigneeCounts] = useState({});
  const [holidayRemaining, setHolidayRemaining] = useState(0);

  const [requestType, setRequestType] = useState(null); // null | 'kit_topup' | 'issue'
  const [requestJobId, setRequestJobId] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherProductText, setOtherProductText] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const { data: ownProfile } = await supabase
      .from('profiles').select('full_name, created_at').eq('id', session.user.id).single();
    const years = getWorkAnniversaryYears(ownProfile?.created_at);
    if (years) setAnniversary({ name: ownProfile.full_name || 'there', years });
    setFirstName(firstNameOf(ownProfile?.full_name));

    // The same rows the rota and hours pages read, so the figures on the
    // tiles below agree with what those pages say.
    const [{ data: assignmentRows }, { data: timeOffData }, { data: privateData }] = await Promise.all([
      supabase
        .from('job_assignments')
        .select('paid_minutes, jobs(id, scheduled_at, status, duration_minutes, properties(address))')
        .eq('cleaner_id', session.user.id),
      supabase
        .from('time_off_requests')
        .select('type, hours, status')
        .eq('cleaner_id', session.user.id),
      supabase.from('profile_private').select('holiday_adjustment_hours').eq('profile_id', session.user.id).maybeSingle(),
    ]);

    const jobsData = (assignmentRows || [])
      .map(assignedJob)
      .filter(Boolean)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    const counts = await fetchAssigneeCounts(jobsData.map((j) => j.id));

    // Same sum as the rota's Time Off card: accrued plus any adjustment,
    // less what has been approved. Pending requests are not taken off here -
    // this tile answers "how much holiday have I got", not "how much can I
    // still ask for".
    const used = (timeOffData || [])
      .filter((t) => t.type === 'holiday' && t.status === 'approved')
      .reduce((sum, t) => sum + (t.hours || 0), 0);
    const accrued = hoursWorked(jobsData, counts) * HOLIDAY_ACCRUAL_RATE + (privateData?.holiday_adjustment_hours ?? 0);
    setHolidayRemaining(Math.max(0, accrued - used));
    setAssigneeCounts(counts);

    await purgeOldNotifications(session.user.id);

    const { data: notifData } = await supabase
      .from('notifications')
      .select('id, message, read, created_at')
      .eq('user_id', session.user.id)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: requestsData } = await supabase
      .from('staff_requests')
      .select('id, type, description, status, created_at, resolution_note')
      .order('created_at', { ascending: false })
      .limit(10);

    setJobs(jobsData || []);
    setNotifications(notifData || []);
    setMyRequests(requestsData || []);
    setLoading(false);
  };

  const dismissNotification = async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  };

  const openRequestForm = (type) => {
    setRequestType(requestType === type ? null : type);
    setRequestJobId('');
    setRequestDescription('');
    setSelectedProducts([]);
    setOtherChecked(false);
    setOtherProductText('');
  };

  const toggleProduct = (product) => {
    setSelectedProducts((prev) =>
      prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]
    );
  };

  const submitRequest = async (e) => {
    e.preventDefault();

    let description;
    if (requestType === 'kit_topup') {
      const items = [...selectedProducts];
      if (otherChecked && otherProductText.trim()) items.push(otherProductText.trim());
      if (items.length === 0) return;
      description = items.join(', ');
    } else {
      if (!requestDescription.trim()) return;
      description = requestDescription.trim();
    }

    setSubmittingRequest(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('staff_requests')
      .insert({
        cleaner_id: session.user.id,
        job_id: requestJobId || null,
        type: requestType,
        description,
      })
      .select('id, type, description, status, created_at, resolution_note')
      .single();

    setSubmittingRequest(false);
    if (data) {
      setMyRequests((prev) => [data, ...prev]);
      setRequestType(null);
      setRequestDescription('');
      setRequestJobId('');
      setSelectedProducts([]);
      setOtherChecked(false);
      setOtherProductText('');
    }
  };

  if (loading) return <div className="container">Loading...</div>;

  const now = new Date();
  const day = splitJobsForHome(jobs, now);
  const isToday = (value) => new Date(value).toDateString() === now.toDateString();
  const weekHours = hoursThisWeek(jobs, assigneeCounts, now);
  const weekLeft = hoursLeftThisWeek(jobs, assigneeCounts, now);
  const monthJobs = jobsCompletedThisMonth(jobs, now);

  return (
    <div className="container">
      <BackButton />
      {anniversary && <WorkAnniversaryPopup name={anniversary.name} years={anniversary.years} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 style={{ margin: 0 }}>{greetingFor(now)}, {firstName}</h1>
          <p style={{ fontSize: 15, color: 'var(--muted)', margin: '4px 0 0' }}>{daySummary(day, now)}</p>
        </div>
        <div style={{ display: 'flex', gap: 14, flexShrink: 0, paddingTop: 6 }}>
          <Link href="/cleaner/hours" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-link)', textDecoration: 'none' }}>
            My Hours
          </Link>
          <Link href="/cleaner/notifications" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-link)', textDecoration: 'none' }}>
            Notifications
          </Link>
        </div>
      </div>

      {/* The job they are on right now goes ahead of everything, in the
          verified green the rest of the app uses for "clocked in". */}
      {day.current && (
        <Link
          href={`/cleaner/jobs/${day.current.id}`}
          className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: 'var(--wf-verified-bg)', borderColor: 'var(--wf-verified)', marginTop: 16 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--wf-verified-text)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
                Clocked in
              </p>
              <h2 style={{ margin: 0 }}>{day.current.properties?.address}</h2>
              <p style={{ fontSize: 14, margin: '4px 0 0', color: 'var(--muted)' }}>Booked for {clock(day.current.scheduled_at)}</p>
            </div>
            <ChevronRight size={22} style={{ color: 'var(--wf-verified-text)', flexShrink: 0 }} />
          </div>
        </Link>
      )}

      {/* Up next: the one job they need to get to, big enough to tap from a
          van seat. Followed by the rest of today so a done morning still
          reads as done. */}
      {day.upNext && (
        <div className="card" style={{ marginTop: day.current ? 0 : 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Up next</h2>
            {!isToday(day.upNext.scheduled_at) && (
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {new Date(day.upNext.scheduled_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <MapPin size={20} style={{ color: 'var(--brand-link)', flexShrink: 0, marginTop: 3 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{day.upNext.properties?.address}</p>
              <p style={{ fontSize: 14, color: 'var(--muted)', margin: '2px 0 0' }}>
                {clock(day.upNext.scheduled_at)}
                {day.upNext.duration_minutes ? ` · ${formatHours(day.upNext.duration_minutes / 60)}` : ''}
              </p>
            </div>
          </div>
          <Link href={`/cleaner/jobs/${day.upNext.id}`} style={{ display: 'block', marginTop: 12 }}>
            <button type="button" style={{ width: '100%' }}>Open job</button>
          </Link>
        </div>
      )}

      {day.today.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Today</h2>
            <Link href="/cleaner/rota" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-link)', textDecoration: 'none' }}>
              Full rota →
            </Link>
          </div>
          {day.today.map((j) => (
            <div
              key={j.id}
              className="task-row"
              onClick={() => router.push(`/cleaner/jobs/${j.id}`)}
              style={{ cursor: 'pointer', gap: 10, opacity: j.status === 'completed' ? 0.7 : 1 }}
            >
              <span style={{ fontFamily: 'var(--wf-data)', fontVariantNumeric: 'tabular-nums', fontSize: 13.5, fontWeight: 600, width: 62, flexShrink: 0 }}>
                {clock(j.scheduled_at)}
              </span>
              <span style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.properties?.address}
              </span>
              <span className={`badge ${j.status}`}>{statusWord(j.status)}</span>
            </div>
          ))}
        </div>
      )}

      {!day.upNext && day.today.length === 0 && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
          <CalendarDays size={28} style={{ color: 'var(--muted)', marginBottom: 6 }} />
          <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>No upcoming jobs on your rota yet.</p>
          <Link href="/cleaner/rota" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-link)', textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>
            See your rota →
          </Link>
        </div>
      )}

      {/* Three figures they'd otherwise go to Hours and Rota for. Same tiled
          icon style as the hours page so the two read as one app. Hours and
          jobs link to the hours page; holiday to the rota, where it's booked. */}
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Link href="/cleaner/hours" className="stat-card stat-hours" style={{ padding: '12px 12px' }} title="Hours from completed jobs this week, Monday to Sunday">
          <div className="stat-card-top" style={{ marginBottom: 6 }}>
            <div className="stat-card-icon" style={{ width: 30, height: 30 }}><Clock size={16} /></div>
          </div>
          <div className="stat-number" style={{ fontSize: 22 }}>{formatHours(weekHours)}</div>
          <div className="stat-label">This week</div>
          <div className="stat-sublabel" style={{ fontSize: 12 }}>{weekLeft > 0 ? `${formatHours(weekLeft)} to go` : 'nothing more booked'}</div>
        </Link>
        <Link href="/cleaner/rota" className="stat-card" style={{ padding: '12px 12px' }} title="Holiday hours accrued and not yet taken - request time off on the rota">
          <div className="stat-card-top" style={{ marginBottom: 6 }}>
            <div className="stat-card-icon" style={{ width: 30, height: 30 }}><TreePalm size={16} /></div>
          </div>
          <div className="stat-number" style={{ fontSize: 22 }}>{formatHours(holidayRemaining)}</div>
          <div className="stat-label">Holiday left</div>
          <div className="stat-sublabel" style={{ fontSize: 12 }}>request on rota</div>
        </Link>
        <Link href="/cleaner/hours" className="stat-card stat-jobs" style={{ padding: '12px 12px' }} title="Jobs you've completed this calendar month">
          <div className="stat-card-top" style={{ marginBottom: 6 }}>
            <div className="stat-card-icon" style={{ width: 30, height: 30 }}><CalendarDays size={16} /></div>
          </div>
          <div className="stat-number" style={{ fontSize: 22 }}>{monthJobs}</div>
          <div className="stat-label">Jobs done</div>
          <div className="stat-sublabel" style={{ fontSize: 12 }}>{now.toLocaleDateString(undefined, { month: 'long' })}</div>
        </Link>
      </div>

      {notifications.length > 0 && (
        <div className="card" style={{ background: 'var(--wf-ash)' }}>
          <h2>Notifications</h2>
          {notifications.map((n) => (
            <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, margin: '4px 0' }}>
              <p style={{ fontSize: 14, margin: 0 }}>{n.message}</p>
              <button
                type="button"
                className="dismiss-btn"
                onClick={() => dismissNotification(n.id)}
                aria-label="Dismiss notification" title="Dismiss this — it stays in your history for 30 days"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ShiftCoverCard userId={userId} onChange={loadData} />

      <KeyHoldingsCard userId={userId} />

      <div className="card">
        <h2>Need something?</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: requestType ? 14 : 0 }}>
          <button
            type="button"
            className={requestType === 'kit_topup' ? '' : 'btn-secondary'}
            onClick={() => openRequestForm('kit_topup')}
            style={{ flex: 1 }}
          >
            Request Kit Top-up
          </button>
          <button
            type="button"
            className={requestType === 'issue' ? '' : 'btn-secondary'}
            onClick={() => openRequestForm('issue')}
            style={{ flex: 1 }}
          >
            Report an Issue
          </button>
        </div>

        {requestType && (
          <form onSubmit={submitRequest}>
            {jobs.length > 0 && (
              <>
                <label>Related job (optional)</label>
                <select value={requestJobId} onChange={(e) => setRequestJobId(e.target.value)}>
                  <option value="">Not job-specific</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.properties?.address} — {new Date(j.scheduled_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </>
            )}
            {requestType === 'kit_topup' ? (
              <>
                <label>What do you need? (tick everything you're low on)</label>
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px',
                    marginBottom: 10, maxHeight: 260, overflowY: 'auto',
                    border: '1px solid var(--hairline)', borderRadius: 10, padding: '10px 12px', background: 'var(--wf-ash)',
                  }}
                >
                  {KIT_PRODUCTS.map((product) => (
                    <label key={product} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400, padding: '4px 0' }}>
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(product)}
                        onChange={() => toggleProduct(product)}
                        style={{ width: 'auto' }}
                      />
                      {product}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400, padding: '4px 0', gridColumn: '1 / -1' }}>
                    <input
                      type="checkbox"
                      checked={otherChecked}
                      onChange={(e) => setOtherChecked(e.target.checked)}
                      style={{ width: 'auto' }}
                    />
                    Other
                  </label>
                </div>
                {otherChecked && (
                  <input
                    value={otherProductText}
                    onChange={(e) => setOtherProductText(e.target.value)}
                    placeholder="What else do you need?"
                    style={{ marginBottom: 10 }}
                  />
                )}
              </>
            ) : (
              <>
                <label>What's the issue?</label>
                <textarea
                  value={requestDescription}
                  onChange={(e) => setRequestDescription(e.target.value)}
                  placeholder="e.g. Hoover on the van is broken"
                  rows={3}
                  required
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                    background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
                  }}
                />
              </>
            )}
            <button type="submit" disabled={submittingRequest} style={{ width: '100%' }}>
              {submittingRequest ? 'Sending...' : 'Send Request'}
            </button>
          </form>
        )}
      </div>

      {myRequests.length > 0 && (
        <div className="card">
          <h2>Your recent requests</h2>
          {myRequests.map((r) => (
            <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {r.type === 'kit_topup' ? 'Kit top-up' : 'Issue'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{r.description}</div>
                </div>
                <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
              </div>
              {r.status === 'resolved' && r.resolution_note && (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>
                  "{r.resolution_note}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
