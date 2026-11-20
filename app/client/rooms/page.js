'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { SkeletonLines } from '../../components/Skeleton';
import BackButton from '../../components/BackButton';
import RoomTracker from '../../components/RoomTracker';

// Room refreshes for the client (Jess, Nov 2026, for TKR): when the communal
// areas and each room at their properties were last done and when they're
// next booked. The same tracker the office uses on the client's Rooms tab,
// without the office's buttons.
export default function ClientRooms() {
  const router = useRouter();
  const [clientId, setClientId] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
      if (profile?.client_id) setClientId(profile.client_id);
      else setFailed(true);
    })();
  }, []);

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Rooms</h1>
          <p className="page-subtitle">Room refreshes and communal cleans at your properties</p>
        </div>
      </div>
      {failed && <div className="card">Couldn&apos;t find your account&apos;s properties. Please message us.</div>}
      {!failed && !clientId && <div className="card"><SkeletonLines lines={4} /></div>}
      {clientId && <RoomTracker clientId={clientId} readOnly />}
    </div>
  );
}
