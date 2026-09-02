'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import {
  INSIDE_PERSIST_INTERVAL_MS,
  autoCheckoutTimestamp,
  classifyFix,
  closeCheckin,
  markSeenInside,
  nextDepartureState,
  shouldAutoCheckOut,
} from '../../lib/autoCheckout';

// The live departure watch, running on every cleaner screen rather than only
// on the job page.
//
// There were two halves to auto check-out and a hole between them. The job
// page watches continuously and knows the moment somebody actually left, but
// only while that page is open. AutoCheckoutWatcher covers everywhere else,
// but it is a single fix taken when the app is opened - so it can only say
// "you are elsewhere now", not when you went, and falls back to the job's
// allotted end.
//
// The hole was somebody finishing up while looking at their rota or their
// job list, which is where cleaners naturally end up between jobs. Nothing
// watched, so a departure that could have been timed precisely got recorded
// as a full shift instead. This closes that: the same watch, wherever they
// are in the app.
//
// What it still cannot do is see anything while the app is closed or the
// phone is locked. There is no background geolocation on the web - the
// Geofencing API was abandoned and never shipped - so a pocketed phone
// reports nothing and the catch-up pass remains the backstop. See
// lib/autoCheckout.js.

export default function ShiftLocationWatcher() {
  const toast = useToast();
  const pathname = usePathname();
  // Read from inside the geolocation callback, which is set up once and would
  // otherwise close over whichever path was current at the time.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let watchId = null;
    let cancelled = false;
    // Departure state per check-in, so somebody double-booked across two
    // properties does not have one job's readings advance the other's timer.
    const states = new Map();
    const lastPersisted = new Map();
    let openCheckins = [];

    const load = async () => {
      const session = await getSessionWithRetry();
      if (!session || cancelled) return;

      const { data } = await supabase
        .from('checkins')
        .select('id, job_id, checked_in_at, jobs(scheduled_at, duration_minutes, properties(address, lat, lng))')
        .eq('cleaner_id', session.user.id)
        .is('checked_out_at', null);

      openCheckins = (data || []).filter(
        (c) => c.jobs?.properties?.lat != null && c.jobs?.properties?.lng != null
      );

      // No open shift, or no way to place them: never touch location. Asking
      // for a fix the app has no use for is how people learn to hit Block.
      if (openCheckins.length === 0 || cancelled || !navigator.geolocation) return;

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          const now = new Date();
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };

          for (const checkin of openCheckins) {
            // The job page runs its own watch, with its own toast copy about
            // photos and its own on-screen state to keep in step. Leave that
            // one to it rather than racing - closeCheckin's null guard would
            // make a race safe, but two toasts about the same shift would not
            // read as safe to the person holding the phone.
            if (pathnameRef.current === `/cleaner/jobs/${checkin.job_id}`) continue;

            const where = classifyFix(fix, checkin.jobs.properties);
            const state = nextDepartureState(states.get(checkin.id) || { lastInsideAt: null, outsideSince: null }, where, now);
            states.set(checkin.id, state);

            if (where === 'inside' && now - (lastPersisted.get(checkin.id) || 0) > INSIDE_PERSIST_INTERVAL_MS) {
              lastPersisted.set(checkin.id, now);
              markSeenInside(checkin.id, now.toISOString());
            }

            if (!shouldAutoCheckOut(state, checkin.checked_in_at, now)) continue;
            closeOut(checkin, state.lastInsideAt, now);
          }
        },
        // A refused or failed fix just means no auto check-out - they check
        // out by hand as before, rather than being told something is wrong.
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
      );
    };

    const closeOut = async (checkin, observedDepartureAt, now) => {
      const at = autoCheckoutTimestamp({ observedDepartureAt, checkin, job: checkin.jobs, now });
      const { closed } = await closeCheckin(checkin.id, at);
      // Not closed means they beat us to it by hand, or it failed. Either
      // way their own time stands and there is nothing to announce.
      if (!closed) return;

      openCheckins = openCheckins.filter((c) => c.id !== checkin.id);
      if (openCheckins.length === 0 && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }

      const address = checkin.jobs.properties.address || 'your job';
      toast.success(
        `You've left ${address}, so you've been checked out at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      );
    };

    load();

    return () => {
      cancelled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
    // Set up once per mount. The watch follows them across screens, which is
    // the entire point - re-running it on every navigation would restart the
    // dwell timer each time they tapped something, and a departure would
    // never accumulate the three minutes it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
