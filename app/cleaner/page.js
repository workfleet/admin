'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function CleanerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const [requestType, setRequestType] = useState(null); // null | 'kit_topup' | 'issue'
  const [requestJobId, setRequestJobId] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/');
      return;
    }

    const { data: jobsData } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address)')
      .eq('cleaner_id', session.user.id)
      .order('scheduled_at', { ascending: true });

    const { data: notifData } = await supabase
      .from('notifications')
      .select('id, message, read, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: requestsData } = await supabase
      .from('staff_requests')
      .select('id, type, description, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    setJobs(jobsData || []);
    setNotifications(notifData || []);
    setMyRequests(requestsData || []);
    setLoading(false);
  };

  const openRequestForm = (type) => {
    setRequestType(requestType === type ? null : type);
    setRequestJobId('');
    setRequestDescription('');
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!requestDescription.trim()) return;
    setSubmittingRequest(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('staff_requests')
      .insert({
        cleaner_id: session.user.id,
        job_id: requestJobId || null,
        type: requestType,
        description: requestDescription.trim(),
      })
      .select('id, type, description, status, created_at')
      .single();

    setSubmittingRequest(false);
    if (data) {
      setMyRequests((prev) => [data, ...prev]);
      setRequestType(null);
      setRequestDescription('');
      setRequestJobId('');
    }
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>My Jobs</h1>

      {notifications.length > 0 && (
        <div className="card" style={{ background: '#fffbeb' }}>
          <h2>Notifications</h2>
          {notifications.map((n) => (
            <p key={n.id} style={{ fontSize: 14, margin: '4px 0' }}>{n.message}</p>
          ))}
        </div>
      )}

      {jobs.length === 0 && <p>No jobs scheduled yet.</p>}

      {jobs.map((job) => (
        <div
          key={job.id}
          className="card"
          onClick={() => router.push(`/cleaner/jobs/${job.id}`)}
          style={{ cursor: 'pointer' }}
        >
          <h2>{job.properties?.address}</h2>
          <p style={{ margin: '4px 0', fontSize: 14 }}>
            {new Date(job.scheduled_at).toLocaleString()}
          </p>
          <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
        </div>
      ))}

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
            <label>{requestType === 'kit_topup' ? 'What do you need?' : "What's the issue?"}</label>
            <textarea
              value={requestDescription}
              onChange={(e) => setRequestDescription(e.target.value)}
              placeholder={requestType === 'kit_topup' ? 'e.g. Out of glass cleaner and microfibre cloths' : 'e.g. Hoover on the van is broken'}
              rows={3}
              required
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
              }}
            />
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
            <div key={r.id} className="task-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.type === 'kit_topup' ? 'Kit top-up' : 'Issue'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{r.description}</div>
              </div>
              <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
