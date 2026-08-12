'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

function groupByDate(jobs) {
  const groups = {};
  jobs.forEach((j) => {
    const key = new Date(j.scheduled_at).toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(j);
  });
  return groups;
}

function DayGroup({ date, jobs, router, dim }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>
        {new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      {jobs.map((job) => (
        <div
          key={job.id}
          className="card"
          onClick={() => router.push(`/cleaner/jobs/${job.id}`)}
          style={{ cursor: 'pointer', opacity: dim ? 0.7 : 1 }}
        >
          <h2>{job.properties?.address}</h2>
          <p style={{ margin: '4px 0', fontSize: 14 }}>
            {new Date(job.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

export default function CleanerRota() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, duration_minutes, properties(address)')
      .eq('cleaner_id', session.user.id)
      .order('scheduled_at', { ascending: true });

    setJobs(data || []);
    setLoading(false);
  };

  if (loading) return <div className="container">Loading...</div>;

  const upcoming = jobs.filter((j) => j.status !== 'completed');
  const past = jobs.filter((j) => j.status === 'completed');
  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(past);

  return (
    <div className="container">
      <h1>My Rota</h1>

      {jobs.length === 0 && <p className="empty-state">No jobs scheduled.</p>}

      {Object.entries(upcomingGroups).map(([date, dayJobs]) => (
        <DayGroup key={date} date={date} jobs={dayJobs} router={router} />
      ))}

      {past.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, marginBottom: 12 }}>Completed</h2>
          {Object.entries(pastGroups).map(([date, dayJobs]) => (
            <DayGroup key={date} date={date} jobs={dayJobs} router={router} dim />
          ))}
        </>
      )}
    </div>
  );
}
