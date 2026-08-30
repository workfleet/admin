'use client';

import { useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import {
  MIN_ONSITE_MS,
  autoCheckoutTimestamp,
  classifyFix,
  closeCheckin,
  markSeenInside,
} from '../../lib/autoCheckout';

// The other half of auto check-out, and in practice the half that does the
// work. The live watch on the job page only survives while that page is
// awake, which rules out the ordinary ending to a shift: finish, pocket the
// phone, lock it, drive to the next job. Nothing runs in the background on
// the web, so the next best moment is the next time the app is opened at
// all - by then they're demonstrably somewhere else, and any check-in still
// hanging open can be closed.
//
// Mounted in the cleaner layout so it gets that chance on whichever screen
// they happen to land on.

// Module-level, not state: this should run once when the app is opened,
// not again on every screen they tap through afterwards.
let lastRunAt = 0;
const RERUN_INTERVAL_MS = 5 * 60 * 1000;

// Asking for a fix is only reasonable if they've already agreed to share
// location - which they have, if they've ever checked in. Popping the
// browser's permission prompt on the home screen, unprompted and with no
// explanation next to it, is how people learn to hit Block.
async function locationAlreadyPermitted() {
  if (!navigator.geolocation) return false;
  if (!navigator.permissions?.query) return true; // older Safari: no way to ask quietly
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state === 'granted';
  } catch {
    return true;
  }
}

function currentFix() {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 }
    );
  });
}

export default function AutoCheckoutWatcher() {
  const toast = useToast();

  useEffect(() => {
    run();

    // A phone-installed PWA is often not reloaded for days - it's resumed.
    // Coming back to the foreground is the same signal as opening it.
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    const now = new Date();
    if (now - lastRunAt < RERUN_INTERVAL_MS) return;

    const session = await getSessionWithRetry();
    if (!session) return;

    const { data: open } = await supabase
      .from('checkins')
      .select('id, job_id, checked_in_at, last_seen_inside_at, jobs(scheduled_at, duration_minutes, properties(address, lat, lng))')
      .eq('cleaner_id', session.user.id)
      .is('checked_out_at', null);

    // No open shift means no reason to touch their location at all.
    const candidates = (open || []).filter((c) => c.jobs?.properties?.lat != null && c.jobs?.properties?.lng != null);
    if (candidates.length === 0) return;

    if (!(await locationAlreadyPermitted())) return;
    lastRunAt = now;

    const fix = await currentFix();
    if (!fix) return;

    for (const checkin of candidates) {
      const where = classifyFix(fix, checkin.jobs.properties);

      // Still on site: nothing to close, but worth recording as proof of
      // where they were, so a later catch-up isn't guessing from nothing.
      if (where === 'inside') {
        await markSeenInside(checkin.id, now.toISOString());
        continue;
      }
      if (where !== 'outside') continue;

      // A wild first fix moments after arriving shouldn't undo a check-in.
      if (now - new Date(checkin.checked_in_at) < MIN_ONSITE_MS) continue;

      const at = autoCheckoutTimestamp({ observedDepartureAt: null, checkin, job: checkin.jobs, now });
      const { closed } = await closeCheckin(checkin.id, at);
      if (!closed) continue;

      const address = checkin.jobs.properties.address || 'your last job';
      toast.success(
        `You were still checked in at ${address}. Checked out for you at ${new Date(at).toLocaleTimeString()}.`
      );
    }
  };

  return null;
}
