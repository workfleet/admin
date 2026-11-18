'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';
import ClientSitePicker, { useClientSite, atSite, ALL_SITES } from '../../components/ClientSitePicker';

// "Wed 3 Mar 2027, 14:00" - no seconds.
function visitTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// How many of each list to show before "Show more". TKR has months of
// visits booked ahead, so the full list would bury past cleans again.
const UPCOMING_STEP = 5;
const PAST_STEP = 20;

// Still to happen: booked or under way, from today on. A booked visit from
// an earlier day that never got going belongs with the past ones.
function isComingUp(job, startOfToday) {
  if (job.status === 'in_progress') return true;
  return job.status === 'scheduled' && new Date(job.scheduled_at) >= startOfToday;
}

export default function ClientHistory() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState(null);
  const [upcomingShown, setUpcomingShown] = useState(UPCOMING_STEP);
  const [pastShown, setPastShown] = useState(PAST_STEP);
  const { sites, site, setSite } = useClientSite(clientId);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    supabase.from('profiles').select('client_id').eq('id', session.user.id).single()
      .then(({ data: profile }) => setClientId(profile?.client_id || null));

    const { data } = await supabase
      .from('jobs')
      .select('id, property_id, scheduled_at, status, properties(address), job_assignments(profiles(full_name))')
      .order('scheduled_at', { ascending: false });

    setJobs(data || []);
    setLoading(false);
  };

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const here = jobs.filter((j) => atSite(j, site));
    if (!q) return here;
    return here.filter((j) => (j.properties?.address || '').toLowerCase().includes(q));
  }, [jobs, search, site]);

  const { upcoming, past } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return {
      // Soonest first.
      upcoming: filteredJobs.filter((j) => isComingUp(j, startOfToday))
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
      // Most recent first (the query's order).
      past: filteredJobs.filter((j) => !isComingUp(j, startOfToday)),
    };
  }, [filteredJobs]);

  // A new site or search starts both lists short again.
  useEffect(() => { setUpcomingShown(UPCOMING_STEP); setPastShown(PAST_STEP); }, [site, search]);

  const row = (job) => {
    const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
    const when = visitTime(job.scheduled_at);
    const who = names.length > 0 ? names.join(', ') : 'Unassigned';
    return (
      <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
        <div>
          {/* One site: the date leads, since the address is the same on every row. */}
          <div className="dash-row-title">{site === ALL_SITES ? job.properties?.address : when}</div>
          <div className="dash-row-subtitle">
            {site === ALL_SITES ? `${when} · ${who}` : who}
          </div>
        </div>
        <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
      </Link>
    );
  };

  const more = (shown, total, step, setShown) => (shown < total ? (
    <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setShown(shown + step)}>
      Show more ({total - shown} more)
    </button>
  ) : null);

  if (loading) return <PageSkeleton className="" rows={3} />;

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>History</h1>
          <p className="page-subtitle">What's booked, and every clean so far</p>
        </div>
      </div>

      <ClientSitePicker sites={sites} site={site} setSite={setSite} />

      {/* With one site picked, searching addresses has nothing to find. */}
      {site === ALL_SITES && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address..."
          style={{
            width: '100%', padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
            background: 'white', fontSize: 14, fontFamily: 'inherit', marginBottom: 16,
          }}
        />
      )}

      {filteredJobs.length === 0 && <p className="empty-state">No jobs found.</p>}

      {filteredJobs.length > 0 && (
        <>
          <div className="card">
            <div className="dash-panel-header">
              <h2>Coming up</h2>
              {upcoming.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{upcoming.length} booked</span>}
            </div>
            {upcoming.length === 0 && <p className="empty-state">Nothing booked yet.</p>}
            {upcoming.slice(0, upcomingShown).map(row)}
            {more(upcomingShown, upcoming.length, 20, setUpcomingShown)}
          </div>

          <div className="card">
            <div className="dash-panel-header">
              <h2>Past cleans</h2>
            </div>
            {past.length === 0 && <p className="empty-state">No cleans yet.</p>}
            {past.slice(0, pastShown).map(row)}
            {more(pastShown, past.length, PAST_STEP, setPastShown)}
          </div>
        </>
      )}
    </div>
  );
}
