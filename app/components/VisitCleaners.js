'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// "Your cleaner" on a client's visit: first name, their photo if they've
// agreed to clients seeing it, and whether they hold an in-date DBS check.
// From client_visit_cleaners() (0148), which checks the visit is the
// caller's and only lets a yes/no out of the certifications.
export default function VisitCleaners({ jobId, status }) {
  const [cleaners, setCleaners] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('client_visit_cleaners', { p_job_id: jobId });
      if (cancelled || error) { if (!cancelled) setCleaners([]); return; }
      const withPhotos = await Promise.all((data || []).map(async (c) => {
        if (!c.photo_path) return c;
        const { data: signed } = await supabase.storage.from('staff-photos').createSignedUrl(c.photo_path, 3600);
        return { ...c, photoUrl: signed?.signedUrl || null };
      }));
      if (!cancelled) setCleaners(withPhotos);
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  if (!cleaners || cleaners.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>{status === 'completed' ? 'Who cleaned' : status === 'missed' ? 'Who was booked' : cleaners.length === 1 ? 'Your cleaner' : 'Your cleaners'}</h2>
      <div className="visit-cleaners">
        {cleaners.map((c) => (
          <div key={c.cleaner_id} className="visit-cleaner">
            {c.photoUrl
              ? <img src={c.photoUrl} alt={c.first_name || 'Your cleaner'} className="visit-cleaner-photo" />
              : <div className="visit-cleaner-photo visit-cleaner-photo-empty" aria-hidden="true"><User size={26} /></div>}
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{c.first_name || 'Your cleaner'}</div>
              {c.dbs_checked && (
                <div className="visit-cleaner-dbs"><ShieldCheck size={14} aria-hidden="true" /> DBS checked</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
