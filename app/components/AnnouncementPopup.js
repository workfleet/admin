'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// Office announcements (0136), shown over the cleaner app one at a time,
// oldest first, until each is acknowledged with "Got it". Checked when the
// app opens and again when it comes back to the front - an installed app
// is usually resumed rather than reopened, so a mount-only check would
// miss a message sent while it sat in the background.
const RECHECK_MS = 60000;

export default function AnnouncementPopup() {
  const [queue, setQueue] = useState([]);
  const [saving, setSaving] = useState(false);
  const lastCheck = useRef(0);
  const userId = useRef(null);

  const check = async () => {
    lastCheck.current = Date.now();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      userId.current = session.user.id;

      const { data: live, error } = await supabase
        .from('announcements')
        .select('id, title, body, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: true })
        .limit(20);
      if (error || !live || live.length === 0) { setQueue([]); return; }

      const { data: seen } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('profile_id', session.user.id)
        .in('announcement_id', live.map((a) => a.id));
      const seenIds = new Set((seen || []).map((r) => r.announcement_id));
      setQueue(live.filter((a) => !seenIds.has(a.id)));
    } catch {
      // No signal: try again next time the app comes to the front.
    }
  };

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > RECHECK_MS) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const gotIt = async () => {
    setSaving(true);
    // Recorded so it never shows again and the office can see who has read
    // it. If there's no signal the write fails and it simply shows again
    // next time - better than losing track of who has seen it.
    await supabase
      .from('announcement_reads')
      .upsert({ announcement_id: current.id, profile_id: userId.current }, { onConflict: 'announcement_id,profile_id', ignoreDuplicates: true })
      .then(() => {}, () => {});
    setSaving(false);
    setQueue((q) => q.slice(1));
  };

  const sent = new Date(current.created_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20,
      }}
    >
      <div className="card" style={{ maxWidth: 380, width: '100%', padding: 24, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', fontSize: 13, fontWeight: 600 }}>
          <Megaphone size={18} />
          Message from the office
          {queue.length > 1 && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontWeight: 500 }}>1 of {queue.length}</span>}
        </div>
        <h2 id="announcement-title" style={{ margin: '10px 0 4px', fontSize: 19 }}>{current.title}</h2>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>{sent}</div>
        {current.body && (
          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 18px', fontSize: 15, lineHeight: 1.5, overflowY: 'auto' }}>{current.body}</p>
        )}
        <button className="btn-primary" onClick={gotIt} disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Saving...' : 'Got it'}
        </button>
        <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', margin: '10px 0 0' }}>
          You can read this again any time in Notifications.
        </p>
      </div>
    </div>
  );
}
