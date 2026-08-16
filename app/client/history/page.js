'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';

export default function ClientHistory() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address), job_assignments(profiles(full_name))')
      .order('scheduled_at', { ascending: false });

    setJobs(data || []);
    setLoading(false);
  };

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => (j.properties?.address || '').toLowerCase().includes(q));
  }, [jobs, search]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1>History</h1>
          <p className="page-subtitle">Every clean, scheduled and past</p>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by address..."
        style={{
          width: '100%', padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
          background: 'white', fontSize: 14, fontFamily: 'inherit', marginBottom: 16,
        }}
      />

      {filteredJobs.length === 0 && <p className="empty-state">No jobs found.</p>}

      <div className="card">
        {filteredJobs.map((job) => {
          const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
          return (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{job.properties?.address}</div>
                <div className="dash-row-subtitle">
                  {new Date(job.scheduled_at).toLocaleString()} · {names.length > 0 ? names.join(', ') : 'Unassigned'}
                </div>
              </div>
              <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
