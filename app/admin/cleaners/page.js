'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AdminCleaners() {
  const router = useRouter();
  const [cleaners, setCleaners] = useState([]);
  const [jobCounts, setJobCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: cleanersData } = await supabase
      .from('profiles')
      .select('id, full_name, created_at, active')
      .eq('role', 'cleaner')
      .order('created_at');

    const { data: jobsData } = await supabase
      .from('jobs')
      .select('cleaner_id')
      .not('cleaner_id', 'is', null);

    const counts = {};
    (jobsData || []).forEach((j) => { counts[j.cleaner_id] = (counts[j.cleaner_id] || 0) + 1; });

    setCleaners(cleanersData || []);
    setJobCounts(counts);
    setLoading(false);
  };

  const toggleActive = async (cleaner) => {
    const nextActive = !cleaner.active;
    if (!nextActive && !confirm(`Deactivate ${cleaner.full_name || 'this cleaner'}? They won't be able to log in until reactivated.`)) return;

    const { data } = await supabase
      .from('profiles').update({ active: nextActive }).eq('id', cleaner.id)
      .select('id, active').single();

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleaner.id ? { ...c, active: data.active } : c)));
    }
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Cleaners</h1>
          <p className="page-subtitle">{cleaners.length} cleaner{cleaners.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <p className="empty-state" style={{ marginTop: -8 }}>
        New cleaners are added by having them sign up in the app — every new sign-up starts as a cleaner automatically.
      </p>

      {cleaners.length === 0 && <p className="empty-state">No cleaners yet.</p>}

      <div className="job-list">
        {cleaners.map((c) => (
          <div key={c.id} className="card job-card">
            <div>
              <h2>{c.full_name || 'Unnamed cleaner'}</h2>
              <p className="job-time">
                Joined {new Date(c.created_at).toLocaleDateString()}
                {' · '}{jobCounts[c.id] || 0} job{(jobCounts[c.id] || 0) === 1 ? '' : 's'} assigned
              </p>
              {c.active === false && <span className="badge missed">deactivated</span>}
            </div>
            <button className="btn-secondary" onClick={() => toggleActive(c)}>
              {c.active === false ? 'Reactivate' : 'Deactivate'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
