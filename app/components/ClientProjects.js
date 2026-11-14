'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { kindLabel, statusLabel, isOpenStatus } from '../../lib/projects';

// The projects linked to one client, on that client's page. Shows nothing
// when there are none - or when 0137 hasn't been run yet - so the client
// page never looks broken because of it.
export default function ClientProjects({ clientId }) {
  const [projects, setProjects] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, kind, status, due_date')
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (!cancelled) setProjects(error ? [] : data || []);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!projects || projects.length === 0) return null;

  const open = projects.filter((p) => isOpenStatus(p.status));
  const closed = projects.filter((p) => !isOpenStatus(p.status));

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="pj-section-head">
        <h2>Projects</h2>
        <Link href="/admin/projects" className="pj-text-btn">All projects</Link>
      </div>
      <ul className="client-projects-list">
        {[...open, ...closed].map((p) => (
          <li key={p.id}>
            <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
            <span className="pj-muted">
              {kindLabel(p.kind)} · <span className={`pj-status is-${p.status}`}>{statusLabel(p.status)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
