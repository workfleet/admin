'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { purgeOldNotifications } from '../../../lib/notifications';

export default function NotificationHistory() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    await purgeOldNotifications(session.user.id);

    const { data } = await supabase
      .from('notifications')
      .select('id, message, dismissed_at, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    setNotifications(data || []);
    setLoading(false);
  };

  const dismissNotification = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, dismissed_at: new Date().toISOString() } : n))
    );
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>Notifications</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: -8, marginBottom: 16 }}>
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
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
