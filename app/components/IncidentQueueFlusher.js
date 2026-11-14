'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HardHat } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import { OUTBOX_CHANGED, outboxEntries, removeFromOutbox, saveToOutbox, sendReport } from '../../lib/incidentOutbox';

// Sends accident, incident and near-miss reports written with no signal.
// See lib/incidentOutbox.js. Mounted in the staff layout beside the clock
// and photo flushers, so it runs on whatever page they have open.
//
// A report the server refuses outright (not a signal problem) is kept, not
// thrown away, and the banner tells them to ring the office: losing an
// accident report quietly is the one outcome this exists to prevent.

const RETRY_INTERVAL_MS = 60 * 1000;

export default function IncidentQueueFlusher() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(0);
  const [refused, setRefused] = useState(0);
  const running = useRef(false);

  const count = useCallback(async (userId) => {
    const entries = await outboxEntries(userId);
    setWaiting(entries.filter((e) => !e.refusedAt).length);
    setRefused(entries.filter((e) => e.refusedAt).length);
    return entries;
  }, []);

  const flushQueue = useCallback(async () => {
    const session = await getSessionWithRetry();
    if (!session) return;
    const entries = await count(session.user.id);
    if (entries.length === 0) return;
    if (session.offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;

    let sent = 0;
    for (const entry of entries) {
      if (entry.refusedAt) continue;
      const result = await sendReport(supabase, entry, 'id');
      if (result.ok) {
        await removeFromOutbox(entry.id);
        sent += 1;
      } else if (result.retry) {
        break; // the connection, not this report - keep the rest for later
      } else {
        await saveToOutbox({ ...entry, refusedAt: new Date().toISOString(), refusal: result.error?.message || 'refused' });
      }
    }

    await count(session.user.id);
    if (sent > 0) toast.success(sent === 1 ? 'Your report has been sent to the office.' : `${sent} reports have been sent to the office.`);
  }, [count, toast]);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await flushQueue();
    } finally {
      running.current = false;
    }
  }, [flushQueue]);

  useEffect(() => {
    flush();
    const onOnline = () => flush();
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };
    // A report saved on the page: show the banner now, and try straight
    // away in case the signal is back already.
    const onChanged = () => { if (!running.current) flush(); };
    window.addEventListener('online', onOnline);
    window.addEventListener(OUTBOX_CHANGED, onChanged);
    document.addEventListener('visibilitychange', onVisible);
    // A phone can say it is online while the connection is useless, so the
    // event alone is not enough.
    const timer = setInterval(flush, RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener(OUTBOX_CHANGED, onChanged);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [flush]);

  if (waiting === 0 && refused === 0) return null;

  return (
    <div role="status" className="queue-banner is-photos">
      <HardHat size={16} aria-hidden />
      <span>
        {waiting > 0 && (
          <>
            {waiting === 1 ? 'Your report is waiting to send' : `${waiting} reports are waiting to send`}
            {' '}— it’ll go when you get signal. Don’t clear the app until it does.
          </>
        )}
        {waiting > 0 && refused > 0 && ' '}
        {refused > 0 && (
          <>
            {refused === 1 ? 'A report couldn’t be sent.' : `${refused} reports couldn’t be sent.`}
            {' '}Ring the office and tell them what happened - it’s still saved on this phone.
          </>
        )}
      </span>
    </div>
  );
}
