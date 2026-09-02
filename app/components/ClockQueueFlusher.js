'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import { collapse, readQueue, removeFromQueue } from '../../lib/clockQueue';

// Sends clock events that were taken while offline, and tells the cleaner
// they are still holding them.
//
// The banner matters as much as the syncing. Without it, "your check-in is
// saved on your phone" is a claim the app makes once in a toast and then
// forgets, which is not enough to stop somebody walking away worried - or
// worse, tapping Check In four more times. See lib/clockQueue.js.

const RETRY_INTERVAL_MS = 60 * 1000;

export default function ClockQueueFlusher() {
  const toast = useToast();
  const [pending, setPending] = useState(0);

  const flush = useCallback(async () => {
    const queue = readQueue();
    setPending(queue.length);
    if (queue.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    // Without a session there is nobody to write as. The entries keep,
    // which is the whole point - this will run again.
    const session = await getSessionWithRetry();
    if (!session) return;

    let sent = 0;
    for (const entry of collapse(queue)) {
      const done = await flushEntry(entry, session.user.id);
      if (!done) break; // still offline, or the server is unhappy - stop and keep the rest
      removeFromQueue(entry.id);
      // A collapsed pair leaves its check-out entry behind in storage, since
      // collapse() only dropped it from the working copy.
      if (entry.checkedOutAt) {
        readQueue().filter((e) => e.checkinId === entry.id).forEach((e) => removeFromQueue(e.id));
      }
      sent += 1;
    }

    const left = readQueue().length;
    setPending(left);
    if (sent > 0 && left === 0) {
      toast.success(sent === 1 ? 'Your clock-in has been sent.' : `${sent} clock-ins have been sent.`);
    }
  }, [toast]);

  useEffect(() => {
    flush();

    const onOnline = () => flush();
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    // A phone can report itself online while the connection is useless, so
    // the event alone is not enough to rely on.
    const timer = setInterval(flush, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [flush]);

  if (pending === 0) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 76, zIndex: 55,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--wf-graphite)', color: 'var(--wf-white)',
        borderRadius: 'var(--wf-radius)', padding: '10px 14px',
        boxShadow: 'var(--shadow-md)', fontSize: 13,
      }}
    >
      <CloudOff size={16} aria-hidden />
      <span>
        {pending === 1 ? 'Your clock-in is saved on your phone' : `${pending} clock-ins saved on your phone`}
        {' '}— they’ll send themselves when you get signal. You don’t need to do anything.
      </span>
    </div>
  );
}

// Returns true when the entry is dealt with and can be dropped from the
// queue, false when it should stay for the next attempt.
async function flushEntry(entry, userId) {
  if (entry.kind === 'check_in') {
    const { error } = await supabase.from('checkins').insert({
      id: entry.id,
      job_id: entry.jobId,
      cleaner_id: userId,
      checked_in_at: entry.at,
      ...(entry.checkedOutAt ? { checked_out_at: entry.checkedOutAt } : {}),
      lat: entry.lat ?? null,
      lng: entry.lng ?? null,
    });

    // 23505 is a primary key collision, which here means the original insert
    // did reach the server and only its response was lost. The shift is
    // already recorded; replaying would double it. Treat as done.
    if (error && error.code !== '23505') return false;
    return true;
  }

  if (entry.kind === 'check_out') {
    // Same null guard as closeCheckin: if they have since been checked out
    // some other way, that time stands rather than being overwritten by one
    // that has been sitting in a pocket.
    const { error } = await supabase
      .from('checkins')
      .update({ checked_out_at: entry.at })
      .eq('id', entry.checkinId)
      .is('checked_out_at', null);
    return !error;
  }

  // An entry from a future build this one does not understand. Dropping it
  // beats retrying it for ever.
  return true;
}
