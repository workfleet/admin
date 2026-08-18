'use client';

import { useEffect, useState } from 'react';
import { Siren } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const POLL_INTERVAL_MS = 15000;

// Persistent, unmissable banner shown on every admin/supervisor page
// while any emergency alert is unacknowledged - rendered once in the
// admin layout so it follows whoever's signed in regardless of which
// page they're on when a lone worker raises one.
export default function EmergencyBanner() {
  const [alerts, setAlerts] = useState([]);
  const [acknowledgingId, setAcknowledgingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const load = async () => {
      const { data } = await supabase
        .from('emergency_alerts')
        .select('id, created_at, cleaner_id, profiles!emergency_alerts_cleaner_id_fkey(full_name)')
        .eq('status', 'open')
        .order('created_at', { ascending: true });
      if (!cancelled) setAlerts(data || []);
    };

    load();
    timer = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const acknowledge = async (id) => {
    setAcknowledgingId(id);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from('emergency_alerts')
      .update({ status: 'acknowledged', acknowledged_by: session.user.id, acknowledged_at: new Date().toISOString() })
      .eq('id', id);
    setAcknowledgingId(null);
    if (!error) setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  if (alerts.length === 0) return null;

  return (
    <div className="emergency-banner-stack">
      {alerts.map((a) => (
        <div key={a.id} className="emergency-banner">
          <Siren size={18} style={{ flexShrink: 0 }} />
          <span>
            <strong>Emergency alert</strong> from {a.profiles?.full_name || 'a cleaner'} at{' '}
            {new Date(a.created_at).toLocaleTimeString()} - call them now.
          </span>
          <button
            type="button"
            className="emergency-banner-ack"
            onClick={() => acknowledge(a.id)}
            disabled={acknowledgingId === a.id}
          >
            {acknowledgingId === a.id ? 'Acknowledging...' : 'Acknowledge'}
          </button>
        </div>
      ))}
    </div>
  );
}
