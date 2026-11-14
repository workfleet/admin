'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Megaphone } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { purgeOldNotifications } from '../../../lib/notifications';
import BackButton from '../../components/BackButton';

export default function NotificationHistory() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [officeMessages, setOfficeMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    await purgeOldNotifications(session.user.id);

    // Office announcements (0136) in full, for as long as the office keeps
    // them showing - the bell only ever holds the headline, and clears it
    // after 30 days. "Stop showing" on the admin side takes them off here.
    const [{ data }, { data: anns }] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, message, dismissed_at, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('announcements')
        .select('id, title, body, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    setNotifications(data || []);
    setOfficeMessages(anns || []);
    setLoading(false);
  };

  const dismissNotification = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, dismissed_at: new Date().toISOString() } : n))
    );
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  };

  if (loading) return <PageSkeleton className="container" rows={3} />;

  return (
    <div className="container">
      <BackButton />
      <h1>Notifications</h1>

      {officeMessages.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Megaphone size={16} /> Office messages
          </h2>
          {officeMessages.map((a) => (
            <div key={a.id} className="card">
              <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{a.title}</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
                {new Date(a.created_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              {a.body && <p style={{ fontSize: 14, margin: '8px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{a.body}</p>}
            </div>
          ))}
        </div>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: officeMessages.length > 0 ? 0 : -8, marginBottom: 16 }}>
        Notifications are removed automatically 30 days after they arrive.
      </p>

      {notifications.length === 0 && <p>No notifications yet.</p>}

      {notifications.map((n) => (
        <div
          key={n.id}
          className="card"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, opacity: n.dismissed_at ? 0.65 : 1 }}
        >
          <div>
            <p style={{ fontSize: 14, margin: 0 }}>{n.message}</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
              {new Date(n.created_at).toLocaleString()}
              {n.dismissed_at && ' · Dismissed'}
            </p>
          </div>
          {!n.dismissed_at && (
            <button
              type="button"
              className="dismiss-btn"
              onClick={() => dismissNotification(n.id)}
              aria-label="Dismiss notification" title="Dismiss this — it stays in your history for 30 days"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
