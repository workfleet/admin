'use client';

import { PageSkeleton } from '../../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { isTraining, jobHeadline, TRAINING_JOB_COLUMNS } from '../../../../lib/training';
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
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    // Only what has already happened. Jobs still to come belong on the rota,
    // and because this list is the most recent 300 by date they otherwise sat
    // at the top and pushed the actual history off the end of it.
    const { data } = await supabase
      .from('jobs')
      .select(`id, scheduled_at, status, duration_minutes, ${TRAINING_JOB_COLUMNS}, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))`)
      .lte('scheduled_at', new Date().toISOString())
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
      return [job.properties?.address, job.properties?.clients?.name, job.training_title, job.training_location, staffNames].some((v) => v?.toLowerCase().includes(q));
    });
  }, [jobs, search, statusFilter]);

  if (loading) return <PageSkeleton variant="table" />;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Job History</h1>
          <p className="page-subtitle">{jobs.length} past job{jobs.length === 1 ? '' : 's'}, most recent 300</p>
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

      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Address</th>
              <th>Staff</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((job) => {
              const staffNames = (job.job_assignments || []).map((a) => a.profiles?.full_name || 'Unknown');
              return (
                <tr key={job.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(job.scheduled_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td>{isTraining(job) ? 'Training' : job.properties?.clients?.name || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{isTraining(job) ? jobHeadline(job) : job.properties?.address}</td>
                  <td>{staffNames.length > 0 ? staffNames.join(', ') : 'Unassigned'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDuration(job.duration_minutes || 120)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
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
