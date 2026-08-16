'use client';

import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const HEARTBEAT_INTERVAL_MS = 20000;
const REFRESH_INTERVAL_MS = 20000;
// Anyone whose last heartbeat is older than this is treated as offline -
// generous enough to survive a couple of missed heartbeats (a slow
// network tick, a background tab) without flickering offline.
const ONLINE_WINDOW_MS = 60000;

const ROLE_LABELS = { admin: 'admin', supervisor: 'supervisor', cleaner: 'cleaner' };

// Reports the signed-in user's presence via a heartbeat row, refreshed
// every ~20s while this component is mounted (no explicit "gone offline"
// signal needed - a stale heartbeat just ages out of the online window).
// Every portal mounts this so everyone actually gets tracked, but the
// visible "who's online" flyout only renders for admin/supervisor -
// cleaners and clients still report their own heartbeat, they just don't
// see the panel themselves.
export default function PresenceIndicator({ iconColor = 'var(--muted)' }) {
  const [profile, setProfile] = useState(null);
  const [online, setOnline] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer;
    let refreshTimer;
    let userId;

    const sendHeartbeat = async () => {
      if (!userId) return;
      await supabase.from('user_presence').upsert({ profile_id: userId, last_seen_at: new Date().toISOString() });
    };

    const refreshOnlineList = async () => {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data } = await supabase
        .from('user_presence')
        .select('profile_id, last_seen_at, profiles(full_name, role)')
        .gte('last_seen_at', since);
      if (!cancelled) setOnline(data || []);
    };

    const setup = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      userId = session.user.id;

      const { data: ownProfile } = await supabase
        .from('profiles').select('full_name, role').eq('id', userId).single();
      if (cancelled) return;
      setProfile(ownProfile);

      await sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      if (ownProfile?.role === 'admin' || ownProfile?.role === 'supervisor') {
        await refreshOnlineList();
        refreshTimer = setInterval(refreshOnlineList, REFRESH_INTERVAL_MS);
      }
    };

    setup();

    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
      clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Heartbeat still reports for every role (the effect above already
  // handles that) - just don't render the flyout for non-admin/supervisor.
  if (!profile || (profile.role !== 'admin' && profile.role !== 'supervisor')) return null;

  const sorted = [...online].sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''));

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Who's online"
        style={{
          background: 'transparent', border: 'none', padding: 6, cursor: 'pointer',
          position: 'relative', display: 'flex', alignItems: 'center',
        }}
      >
        <Users size={20} color={iconColor} />
        {sorted.length > 0 && (
          <span
            style={{
              position: 'absolute', top: 3, right: 3, width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e', border: '1.5px solid white',
            }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 240,
            background: 'white', border: '1px solid var(--hairline)', borderRadius: 12,
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)', zIndex: 300, padding: 10,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 6px 8px' }}>
            Online now ({sorted.length})
          </div>
          {sorted.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 6px 6px' }}>No one else is online.</div>
          )}
          {sorted.map((u) => (
            <div key={u.profile_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, flex: 1 }}>{u.profiles?.full_name || 'Unknown'}</span>
              {u.profiles?.role && u.profiles.role !== 'cleaner' && (
                <span className="badge scheduled" style={{ fontSize: 10, padding: '1px 6px' }}>{ROLE_LABELS[u.profiles.role] || u.profiles.role}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
