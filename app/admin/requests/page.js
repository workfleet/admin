'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AdminRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | resolved | all
  const [resolvingId, setResolvingId] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('staff_requests')
      .select('id, type, description, status, created_at, resolved_at, resolution_note, profiles(full_name), jobs(scheduled_at, properties(address))')
      .order('created_at', { ascending: false });

    setRequests(data || []);
    setLoading(false);
  };

  const startResolve = (id) => {
    setResolvingId(id);
    setResolutionNote('');
  };

  const confirmResolve = async (id) => {
    const { data } = await supabase
      .from('staff_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_note: resolutionNote.trim() || null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note')
      .single();

    if (data) {
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    }
    setResolvingId(null);
  };

  const reopen = async (id) => {
    const { data } = await supabase
      .from('staff_requests')
      .update({ status: 'open', resolved_at: null, resolution_note: null })
      .eq('id', id)
      .select('id, status, resolved_at, resolution_note')
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
          <div key={r.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2>{r.type === 'kit_topup' ? 'Kit Top-up' : 'Issue'}</h2>
                <p style={{ fontSize: 14, margin: '4px 0' }}>{r.description}</p>
                <p className="job-time">
                  {r.profiles?.full_name || 'Unknown cleaner'}
                  {r.jobs?.properties?.address && ` · ${r.jobs.properties.address}`}
                  {' · '}{new Date(r.created_at).toLocaleString()}
                </p>
                <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`}>{r.status}</span>
                {r.status === 'resolved' && r.resolution_note && (
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
                    "{r.resolution_note}"
                  </p>
                )}
              </div>
              {r.status === 'resolved' ? (
                <button className="btn-secondary" onClick={() => reopen(r.id)} style={{ height: 'fit-content' }}>Reopen</button>
              ) : (
                <button className="btn-secondary" onClick={() => startResolve(r.id)} style={{ height: 'fit-content' }}>
                  Mark Resolved
                </button>
              )}
            </div>

            {resolvingId === r.id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                <label>Resolution note (optional)</label>
                <textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="e.g. Dropped off new supplies at the van this morning"
                  rows={2}
                  autoFocus
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                    background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setResolvingId(null)}>Cancel</button>
                  <button className="btn-primary" onClick={() => confirmResolve(r.id)}>Confirm Resolved</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
