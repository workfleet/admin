'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, MessageSquareWarning, Star } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function ClientDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');

  const [upcoming, setUpcoming] = useState([]);
  const [recent, setRecent] = useState([]);
  const [lastMessage, setLastMessage] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openReschedules, setOpenReschedules] = useState(0);
  const [cleansThisMonth, setCleansThisMonth] = useState(0);
  const [avgRating, setAvgRating] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    if (!profile?.client_id) { setLoading(false); return; }
    const clientId = profile.client_id;

    const { data: clientRow } = await supabase.from('clients').select('name').eq('id', clientId).single();
    setClientName(clientRow?.name || 'there');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      { data: jobs },
      { data: messages },
      { data: reschedules },
      { data: ratings },
    ] = await Promise.all([
      supabase.from('jobs')
        .select('id, scheduled_at, status, properties(address), job_assignments(profiles(full_name))')
        .order('scheduled_at', { ascending: false }),
      supabase.from('client_messages')
        .select('id, sender, body, created_at, read_by_client')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase.from('reschedule_requests').select('id').eq('client_id', clientId).eq('status', 'pending'),
      supabase.from('job_ratings').select('rating').eq('client_id', clientId),
    ]);

    const allJobs = jobs || [];
    const upcomingJobs = allJobs
      .filter((j) => j.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, 5);
    const recentJobs = allJobs.filter((j) => j.status === 'completed').slice(0, 5);
    const completedThisMonth = allJobs.filter((j) => j.status === 'completed' && new Date(j.scheduled_at) >= startOfMonth).length;

    setUpcoming(upcomingJobs);
    setRecent(recentJobs);
    setCleansThisMonth(completedThisMonth);
    setOpenReschedules((reschedules || []).length);

    const { data: { user } } = await supabase.auth.getUser();
    const msg = (messages || [])[0];
    setLastMessage(msg || null);
    setUnreadCount(msg && msg.sender === 'admin' && !msg.read_by_client ? 1 : 0);

    if ((ratings || []).length > 0) {
      setAvgRating(ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length);
    }

    setLoading(false);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1>Welcome back{clientName ? `, ${clientName}` : ''}</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#dbeafe' }}><CalendarClock size={18} color="#1e40af" /></div>
          </div>
          <div className="stat-number" style={{ fontSize: upcoming[0] ? 20 : 28 }}>
            {upcoming[0] ? new Date(upcoming[0].scheduled_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'None'}
          </div>
          <div className="stat-label">Next Clean</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#dcfce7' }}><CheckCircle2 size={18} color="#166534" /></div>
          </div>
          <div className="stat-number">{cleansThisMonth}</div>
          <div className="stat-label">Cleans This Month</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: openReschedules > 0 ? '#fef3c7' : '#f1f5f9' }}><MessageSquareWarning size={18} color={openReschedules > 0 ? '#92400e' : '#64748b'} /></div>
          </div>
          <div className="stat-number">{openReschedules}</div>
          <div className="stat-label">Open Requests</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="stat-card-icon" style={{ background: '#fef3c7' }}><Star size={18} color="#b45309" /></div>
          </div>
          <div className="stat-number">{avgRating ? avgRating.toFixed(1) : '—'}</div>
          <div className="stat-label">Average Rating Given</div>
        </div>
      </div>

      <div className="dash-grid-2">
        <div className="card">
          <div className="dash-panel-header">
            <h2>Upcoming Visits</h2>
            <Link href="/client/history" className="dash-panel-link">View history &rarr;</Link>
          </div>
          {upcoming.length === 0 && <p className="empty-state">Nothing scheduled right now.</p>}
          {upcoming.map((job) => {
            const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
            return (
              <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
                <div>
                  <div className="dash-row-title">{job.properties?.address}</div>
                  <div className="dash-row-subtitle">
                    {new Date(job.scheduled_at).toLocaleString()} · {names.length > 0 ? names.join(', ') : 'Unassigned'}
                  </div>
                </div>
                <span className="badge scheduled">scheduled</span>
              </Link>
            );
          })}
        </div>

        <div className="card">
          <div className="dash-panel-header">
            <h2>Messages</h2>
            <Link href="/client/messages" className="dash-panel-link">Open &rarr;</Link>
          </div>
          {!lastMessage && <p className="empty-state">No messages yet - say hello!</p>}
          {lastMessage && (
            <Link href="/client/messages" className="dash-row">
              <div>
                <div className="dash-row-title">
                  {lastMessage.sender === 'client' ? 'You' : 'CrewConnect'}
                  {unreadCount > 0 && <span className="badge missed" style={{ marginLeft: 6 }}>new</span>}
                </div>
                <div className="dash-row-subtitle">{lastMessage.body}</div>
              </div>
            </Link>
          )}
        </div>
      </div>

      <div className="card">
        <div className="dash-panel-header">
          <h2>Recent Activity</h2>
          <Link href="/client/history" className="dash-panel-link">View all &rarr;</Link>
        </div>
        {recent.length === 0 && <p className="empty-state">No completed cleans yet.</p>}
        {recent.map((job) => {
          const names = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
          return (
            <Link key={job.id} href={`/client/jobs/${job.id}`} className="dash-row">
              <div>
                <div className="dash-row-title">{job.properties?.address}</div>
                <div className="dash-row-subtitle">
                  {new Date(job.scheduled_at).toLocaleString()} · {names.length > 0 ? names.join(', ') : 'Unassigned'}
                </div>
              </div>
              <span className="badge completed">completed</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
