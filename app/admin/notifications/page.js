'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Bell } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { purgeOldNotifications } from '../../../lib/notifications';
import BackButton from '../../components/BackButton';

// The office's own bell. Every trigger that writes a notification for an
// admin or supervisor - a kit request, a client message, a shift dropped,
// a claim to decide - has been writing rows here since the day it was
// added, and nothing in the admin portal ever showed them. Cleaners have
// had this page all along; this is the same one.
export default function AdminNotifications() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    await purgeOldNotifications(session.user.id);

    const { data } = await supabase
      .from('notifications')
      .select('id, message, dismissed_at, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    setNotifications(data || []);
    setLoading(false);
  };

  const dismiss = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, dismissed_at: new Date().toISOString() } : n)));
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  };

  const dismissAll = async () => {
    const open = notifications.filter((n) => !n.dismissed_at).map((n) => n.id);
    if (open.length === 0) return;
    const at = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.dismissed_at ? n : { ...n, dismissed_at: at })));
    await supabase.from('notifications').update({ dismissed_at: at }).in('id', open);
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const openCount = notifications.filter((n) => !n.dismissed_at).length;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Notifications</h1>
          <p className="page-subtitle">Everything the app has told you, newest first. Removed automatically after 30 days.</p>
        </div>
        {openCount > 0 && (
          <button className="btn-secondary" onClick={dismissAll} title="Mark every notification as read">
            Dismiss all ({openCount})
          </button>
        )}
      </div>

      {notifications.length === 0 && (
        <p className="empty-state">Nothing yet. Requests, messages, dropped shifts and claims will show up here as they happen.</p>
      )}

      {notifications.map((n) => (
        <div
          key={n.id}
          className="card"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, opacity: n.dismissed_at ? 0.6 : 1 }}
        >
          <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
            <Bell size={16} style={{ flexShrink: 0, marginTop: 2, color: n.dismissed_at ? 'var(--muted)' : 'var(--wf-azure)' }} />
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, margin: 0 }}>{n.message}</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
                {new Date(n.created_at).toLocaleString()}
                {n.dismissed_at && ' · Dismissed'}
              </p>
            </div>
          </div>
          {!n.dismissed_at && (
            <button
              type="button"
              className="dismiss-btn"
              onClick={() => dismiss(n.id)}
              aria-label="Dismiss notification"
              title="Dismiss this - it stays in your history for 30 days"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
