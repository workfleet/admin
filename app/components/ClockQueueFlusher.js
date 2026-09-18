'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudOff, AlertTriangle, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import { collapse, failedEntries, isTransientError, markFailed, pendingCount, readQueue, removeFromQueue } from '../../lib/clockQueue';

// Sends clock events that were taken while offline, and tells the cleaner
// they are still holding them.
//
// The banner matters as much as the syncing. Without it, "your check-in is
// saved on your phone" is a claim the app makes once in a toast and then
// forgets, which is not enough to stop somebody walking away worried - or
// worse, tapping Check In four more times. See lib/clockQueue.js.
//
// It sits in the page flow at the top of the shell (see cleaner/layout.js)
// rather than fixed to the bottom: fixed at the bottom it covered the
// Check Out button on the job page, which is the one control that matters
// most in exactly the situation the banner appears in.
//
// A write the server has refused outright is not retried. It stays on the
// phone, marked, and the banner turns from 'you don't need to do anything'
// into 'tell the office', with the time they tapped so they can. Before
// this, a refusal was reported as no signal and retried for ever, and
// every later clock-in queued up behind it.

const RETRY_INTERVAL_MS = 60 * 1000;

export default function ClockQueueFlusher() {
  const toast = useToast();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState([]);

  const flush = useCallback(async () => {
    const queue = readQueue().filter((e) => !e.failedAt);
    setPending(queue.length);
    setFailed(failedEntries());
    if (queue.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    // Without a session there is nobody to write as. The entries keep,
    // which is the whole point - this will run again.
    const session = await getSessionWithRetry();
    if (!session) return;

    let sent = 0;
    for (const entry of collapse(queue)) {
      const result = await flushEntry(entry, session.user.id);
      if (result === 'retry') break; // still offline - stop and keep the rest for next time
      if (result !== 'done') {
        // Refused for good. Mark it, and any check-out folded into it, and
        // carry on: the next entry may be for a different job and fine.
        markFailed(entry.id, result);
        readQueue().filter((e) => e.checkinId === entry.id).forEach((e) => markFailed(e.id, result));
        continue;
      }
      removeFromQueue(entry.id);
      // A collapsed pair leaves its check-out entry behind in storage, since
      // collapse() only dropped it from the working copy.
      if (entry.checkedOutAt) {
        readQueue().filter((e) => e.checkinId === entry.id).forEach((e) => removeFromQueue(e.id));
      }
      sent += 1;
    }

    const left = pendingCount();
    setPending(left);
    setFailed(failedEntries());
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

  const dismissFailed = (entry) => {
    removeFromQueue(entry.id);
    setFailed(failedEntries());
  };

  if (pending === 0 && failed.length === 0) return null;

  return (
    <>
      {pending > 0 && (
        <div role="status" className="queue-banner">
          <CloudOff size={16} aria-hidden />
          <span>
            {pending === 1 ? 'Your clock-in is saved on your phone' : `${pending} clock-ins saved on your phone`}
            {' '}— they’ll send themselves when you get signal. You don’t need to do anything.
          </span>
        </div>
      )}
      {failed.map((entry) => (
        <div key={entry.id} role="alert" className="queue-banner is-failed">
          <AlertTriangle size={16} aria-hidden />
          <span style={{ flex: 1 }}>
            Your {entry.kind === 'check_out' ? 'check-out' : 'check-in'} at {formatTapTime(entry.at)} couldn’t be sent
            {' '}— the office needs to record this one. Message them with the time.
          </span>
          <button type="button" onClick={() => dismissFailed(entry)} aria-label="Dismiss" title="Remove this message once the office knows" className="queue-banner-dismiss">
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
    </>
  );
}

function formatTapTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// 'done' when the entry is dealt with and can leave the queue, 'retry' when
// it should stay for the next attempt, otherwise the reason it was refused
// for good.
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
    if (!error || error.code === '23505') return 'done';
    return isTransientError(error) ? 'retry' : (error.message || error.code);
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
    if (!error) return 'done';
    return isTransientError(error) ? 'retry' : (error.message || error.code);
  }

  // An entry from a future build this one does not understand. Dropping it
  // beats retrying it for ever.
  return 'done';
}
