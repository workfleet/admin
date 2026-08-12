'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AdminRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | resolved | all

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('staff_requests')
      .select('id, type, description, status, created_at, resolved_at, profiles(full_name), jobs(scheduled_at, properties(address))')
      .order('created_at', { ascending: false });

    setRequests(data || []);
    setLoading(false);
  };

  const setStatus = async (id, status) => {
    const { data } = await supabase
      .from('staff_requests')
      .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id, status, resolved_at')
      .single();

    if (data) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    }
  };

  const filteredRequests = requests.filter((r) => filter === 'all' || r.status === filter);
  const openCount = requests.filter((r) => r.status === 'open').length;

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Requests</h1>
          <p className="page-subtitle">Kit top-ups and issues reported by staff</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>
            Open ({openCount})
          </button>
          <button className={filter === 'resolved' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('resolved')}>
            Resolved
          </button>
          <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
      </div>

      {filteredRequests.length === 0 && <p className="empty-state">Nothing here.</p>}

      <div className="job-list">
        {filteredRequests.map((r) => (
          <div key={r.id} className="card job-card">
            <div>
              <h2>{r.type === 'kit_topup' ? 'Kit Top-up' : 'Issue'}</h2>
              <p style={{ fontSize: 14, margin: '4px 0' }}>{r.description}</p>
              <p className="job-time">
                {r.profiles?.full_name || 'Unknown cleaner'}
                {r.jobs?.properties?.address && ` · ${r.jobs.properties.address}`}
                {' · '}{new Date(r.created_at).toLocaleString()}
              </p>
              <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
            </div>
            <button
              className="btn-secondary"
              onClick={() => setStatus(r.id, r.status === 'resolved' ? 'open' : 'resolved')}
            >
              {r.status === 'resolved' ? 'Reopen' : 'Mark Resolved'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
