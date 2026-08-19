'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import BackButton from '../../../components/BackButton';

const STATUS_LABELS = { scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', missed: 'Missed' };

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h}h `;
  if (m > 0) label += `${m}m`;
  return label.trim();
}

export default function JobHistory() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, duration_minutes, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))')
      .order('scheduled_at', { ascending: false })
      .limit(300);

    setJobs(data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (!q) return true;
      const staffNames = (job.job_assignments || []).map((a) => a.profiles?.full_name).join(' ');
      return [job.properties?.address, job.properties?.clients?.name, staffNames].some((v) => v?.toLowerCase().includes(q));
    });
  }, [jobs, search, statusFilter]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Job History</h1>
          <p className="page-subtitle">{jobs.length} job{jobs.length === 1 ? '' : 's'}, most recent 300</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address, client, or staff..."
          style={{ flex: 1, minWidth: 220, marginBottom: 0 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto', margin: 0 }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && <p className="empty-state">No jobs match.</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--hairline)' }}>
              <th style={{ padding: '8px 6px' }}>Date</th>
              <th style={{ padding: '8px 6px' }}>Client</th>
              <th style={{ padding: '8px 6px' }}>Address</th>
              <th style={{ padding: '8px 6px' }}>Staff</th>
              <th style={{ padding: '8px 6px' }}>Duration</th>
              <th style={{ padding: '8px 6px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => {
              const staffNames = (job.job_assignments || []).map((a) => a.profiles?.full_name || 'Unknown');
              return (
                <tr key={job.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                    {new Date(job.scheduled_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{job.properties?.clients?.name || '—'}</td>
                  <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>{job.properties?.address}</td>
                  <td style={{ padding: '8px 6px' }}>{staffNames.length > 0 ? staffNames.join(', ') : 'Unassigned'}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{formatDuration(job.duration_minutes || 120)}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                    <span className={`badge ${job.status}`}>{STATUS_LABELS[job.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
