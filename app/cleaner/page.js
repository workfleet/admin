'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function CleanerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

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

    setJobs(jobsData || []);
    setNotifications(notifData || []);
    setLoading(false);
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
    </div>
  );
}
