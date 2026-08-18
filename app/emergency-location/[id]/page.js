'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Siren } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const PropertyMap = dynamic(() => import('../../components/PropertyMap'), { ssr: false });

// Standalone (no admin sidebar/topbar) - meant to be opened via
// window.open() as a small popup from the emergency banner, so it
// should read at a glance rather than carry the full app chrome.
export default function EmergencyLocationPage() {
  const { id } = useParams();
  const router = useRouter();
  const [alert, setAlert] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin' && profile?.role !== 'supervisor') { router.push('/'); return; }

    const { data } = await supabase
      .from('emergency_alerts')
      .select('id, created_at, lat, lng, checkin_at, profiles!emergency_alerts_cleaner_id_fkey(full_name)')
      .eq('id', id)
      .maybeSingle();

    if (!data) { setNotFound(true); return; }
    setAlert(data);
  };

  if (notFound) return <div style={{ padding: 20 }}>Alert not found.</div>;
  if (!alert) return <div style={{ padding: 20 }}>Loading...</div>;

  const hasLocation = alert.lat != null && alert.lng != null;

  return (
    <div style={{ padding: 16, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', marginBottom: 4 }}>
        <Siren size={20} />
        <h1 style={{ fontSize: 18, margin: 0 }}>Emergency Alert</h1>
      </div>
      <p style={{ fontSize: 14, margin: '0 0 4px' }}>
        <strong>{alert.profiles?.full_name || 'Unknown cleaner'}</strong>
      </p>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
        Alert raised {new Date(alert.created_at).toLocaleString()}
      </p>

      {hasLocation ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
            Last known location - from clocking in
            {alert.checkin_at && ` at ${new Date(alert.checkin_at).toLocaleTimeString()}`}:
          </p>
          <PropertyMap lat={alert.lat} lng={alert.lng} />
        </>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          No location on file - this cleaner hasn't clocked in to a job today, so there's no GPS fix to show. Call them directly.
        </p>
      )}
    </div>
  );
}
