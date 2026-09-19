'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';

const TABLE_LABELS = {
  jobs: 'Job',
  job_assignments: 'Cleaner on job',
  job_series: 'Recurring series',
  properties: 'Property',
  clients: 'Client',
};

const ACTION_LABELS = { insert: 'Added', update: 'Moved', delete: 'Deleted' };

// Where a change came from, read off the request that carried it. The
// service key means a server route or a script rather than someone in the
// app; a cascade is a row that went because its parent did.
function describeHow(entry, batchSize) {
  if (entry.cascade) return 'Removed with its parent';
  if (entry.actor_role === 'service_role') return 'Server / script';
  if (!entry.request_method) return 'Database job';
  if (batchSize > 1) return `One of ${batchSize} in the same action`;
  return 'In the app';
}

export default function AuditLog() {
  const router = useRouter();
  const [entries, setEntries] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const [{ data: rows }, { data: profiles }] = await Promise.all([
      supabase
        .from('audit_log')
        .select('id, at, actor_id, actor_role, table_name, action, row_id, summary, request_method, request_path, tx, cascade')
        .order('at', { ascending: false })
        .limit(1000),
      supabase.from('profiles').select('id, full_name'),
    ]);

    setEntries(rows || []);
    setNames(Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name])));
    setLoading(false);
  };

  // Everything one click did shares a transaction id; the count is what
  // tells a single delete from a whole series going at once.
  const batchSizes = useMemo(() => {
    const sizes = {};
    for (const e of entries) sizes[e.tx] = (sizes[e.tx] || 0) + 1;
    return sizes;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (!q) return true;
      const who = e.actor_id ? names[e.actor_id] : '';
      return [e.summary, who, TABLE_LABELS[e.table_name]].some((v) => v?.toLowerCase().includes(q));
    });
  }, [entries, search, actionFilter, names]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Change Log</h1>
          <p className="page-subtitle">
            Every job, cleaner assignment, series, property and client added, moved or deleted - most recent 1000
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address, client, cleaner or who made the change..."
          style={{ flex: 1, minWidth: 220, marginBottom: 0 }}
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ width: 'auto', margin: 0 }}>
          <option value="all">All changes</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {entries.length === 0 && (
        <p className="empty-state">Nothing recorded yet. Changes made from now on will show here.</p>
      )}
      {entries.length > 0 && filtered.length === 0 && <p className="empty-state">No changes match.</p>}

      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--hairline)' }}>
                <th style={{ padding: '8px 6px' }}>When</th>
                <th style={{ padding: '8px 6px' }}>Who</th>
                <th style={{ padding: '8px 6px' }}>What</th>
                <th style={{ padding: '8px 6px' }}>Details</th>
                <th style={{ padding: '8px 6px' }}>How</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const who = e.actor_id ? (names[e.actor_id] || 'Unknown login') : (e.actor_role === 'service_role' ? 'System' : '—');
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{who}</td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      <span className={`badge ${e.action === 'delete' ? 'missed' : e.action === 'update' ? 'in_progress' : 'completed'}`}>
                        {ACTION_LABELS[e.action]}
                      </span>
                      {' '}{TABLE_LABELS[e.table_name] || e.table_name}
                    </td>
                    <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>{e.summary}</td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{describeHow(e, batchSizes[e.tx])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
