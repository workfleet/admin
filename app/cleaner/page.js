'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { purgeOldNotifications } from '../../lib/notifications';
import { getWorkAnniversaryYears } from '../../lib/workAnniversary';
import WorkAnniversaryPopup from '../components/WorkAnniversaryPopup';
import ShiftCoverCard from '../components/ShiftCoverCard';
import KeyHoldingsCard from '../components/KeyHoldingsCard';
import BackButton from '../components/BackButton';
import { KIT_PRODUCTS } from '../../lib/kitProducts';

export default function CleanerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anniversary, setAnniversary] = useState(null);
  const [userId, setUserId] = useState(null);

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

    const { data: assignmentRows } = await supabase
      .from('job_assignments')
      .select('jobs(id, scheduled_at, status, properties(address))')
      .eq('cleaner_id', session.user.id);

    const jobsData = (assignmentRows || [])
      .map((row) => row.jobs)
      .filter(Boolean)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

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

  return (
    <div className="container">
      <BackButton />
      {anniversary && <WorkAnniversaryPopup name={anniversary.name} years={anniversary.years} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Home</h1>
        <Link href="/cleaner/notifications" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-link)', textDecoration: 'none' }}>
          Notifications
        </Link>
      </div>

      {notifications.length > 0 && (
        <div className="card" style={{ background: '#fffbeb' }}>
          <h2>Notifications</h2>
          {notifications.map((n) => (
            <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, margin: '4px 0' }}>
              <p style={{ fontSize: 14, margin: 0 }}>{n.message}</p>
              <button
                type="button"
                className="dismiss-btn"
                onClick={() => dismissNotification(n.id)}
                aria-label="Dismiss notification"
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
                    border: '1px solid var(--hairline)', borderRadius: 10, padding: '10px 12px', background: '#f8fafc',
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
                    background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
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
