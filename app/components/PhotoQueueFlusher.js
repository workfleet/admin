'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import {
  PHOTO_QUEUED_EVENT, PHOTOS_SENT_EVENT, announce, isAlreadyUploaded, nextRetryDelay,
  pendingPhotos, removePhoto, withTimeout,
} from '../../lib/photoQueue';

// Sends job photos taken while offline. See lib/photoQueue.js.
//
// Sits below the clock-queue banner rather than merging with it, because the
// two say different things to somebody deciding whether they can leave: an
// unsent clock-in affects their pay, an unsent photo affects whether the job
// can be defended later. Collapsing them into "3 things pending" would tell
// them neither.

// A session lookup that refreshes an expired token can hang on a phone that
// has just woken up. Before this limit, one hang held the `running` lock for
// good and every later flush returned straight away - the queue only moved
// again once the app was killed, which is the one thing the banner says not
// to do.
const SESSION_TIMEOUT_MS = 15 * 1000;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export default function PhotoQueueFlusher() {
  const toast = useToast();
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);

  // One flush at a time. Uploads on a weak signal can outlast the retry
  // timer, and two flushes walking the same queue both found no photos row
  // and both inserted one.
  const running = useRef(false);
  // A flush asked for while one was running - a photo queued mid-flush, say.
  // Run again as soon as the current one ends rather than waiting for the
  // timer, or that photo sits until the next try.
  const again = useRef(false);
  const failures = useRef(0);
  const timer = useRef(null);
  const mounted = useRef(true);

  // Returns the number of photos still waiting afterwards.
  const flushQueue = useCallback(async () => {
    const queue = await pendingPhotos();
    setPending(queue.length);
    if (queue.length === 0) return 0;
    if (isOffline()) return queue.length;

    const session = await withTimeout(getSessionWithRetry(), SESSION_TIMEOUT_MS);
    if (!session?.user || session.offline) return queue.length;

    setSending(true);
    let sent = 0;
    let failedInARow = 0;
    try {
      for (const photo of queue) {
        const done = await flushPhoto(photo, session.user.id);
        if (!done) {
          // Two in a row is the connection, not the photo - keep the rest for
          // later. One on its own may be just that photo (a job taken off
          // them, say), and must not hold back the ones behind it.
          failedInARow += 1;
          if (failedInARow >= 2) break;
          continue;
        }
        failedInARow = 0;
        await removePhoto(photo.id);
        sent += 1;
        setPending((n) => Math.max(0, n - 1));
      }
    } finally {
      setSending(false);
    }

    const left = (await pendingPhotos()).length;
    setPending(left);
    if (sent > 0) announce(PHOTOS_SENT_EVENT);
    if (sent > 0 && left === 0) {
      toast.success(sent === 1 ? 'Your photo has been sent.' : `${sent} photos have been sent.`);
    }
    return left;
  }, [toast]);

  const flush = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    clearTimeout(timer.current);
    let left = 0;
    try {
      do {
        again.current = false;
        left = await flushQueue();
      } while (again.current);
    } catch {
      left = 1;
    } finally {
      running.current = false;
    }

    // Quick retries while anything is left, backing off to a minute. Nothing
    // left means nothing scheduled; a newly queued photo wakes this up.
    if (!mounted.current) return;
    if (left > 0) {
      timer.current = setTimeout(flush, nextRetryDelay(failures.current));
      failures.current += 1;
    } else {
      failures.current = 0;
    }
  }, [flushQueue]);

  // A fresh reason to think it will work now starts the backoff over.
  const flushNow = useCallback(() => {
    failures.current = 0;
    flush();
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    setOffline(isOffline());
    flush();

    const onOnline = () => { setOffline(false); flushNow(); };
    const onOffline = () => setOffline(true);
    const onVisible = () => { if (document.visibilityState === 'visible') flushNow(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(PHOTO_QUEUED_EVENT, flushNow);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(PHOTO_QUEUED_EVENT, flushNow);
      document.removeEventListener('visibilitychange', onVisible);
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, [flush, flushNow]);

  if (pending === 0) return null;

  const what = pending === 1 ? 'Your photo' : `${pending} photos`;
  // "When you get signal" was shown to people with full bars, which reads as
  // the app being broken. Only say it when the phone really is offline.
  let message;
  if (offline) {
    message = `No signal — ${what.toLowerCase()} ${pending === 1 ? 'is' : 'are'} saved on your phone and will send when you’re back online. Don’t clear the app until ${pending === 1 ? 'it has' : 'they have'}.`;
  } else if (sending) {
    message = `Sending ${what.toLowerCase()}…`;
  } else {
    message = `${what} ${pending === 1 ? 'is' : 'are'} saved on your phone and will keep trying to send. Don’t clear the app until ${pending === 1 ? 'it has' : 'they have'}.`;
  }

  return (
    <div role="status" className="queue-banner is-photos">
      <ImageUp size={16} aria-hidden />
      <span style={{ flex: 1 }}>{message}</span>
      {!offline && !sending && (
        <button type="button" className="queue-banner-action" onClick={flushNow}>
          Send now
        </button>
      )}
    </div>
  );
}

// True when the photo is dealt with and can leave the queue.
async function flushPhoto(photo, userId) {
  const { error: uploadError } = await withTimeout(supabase.storage
    .from('job-photos')
    .upload(photo.path, photo.blob, { contentType: 'image/jpeg' }));

  // The path was decided when the photo was taken, so a replay of one that
  // already landed finds its own file there rather than adding a second copy
  // under a new name - which counts as uploaded. See isAlreadyUploaded.
  if (uploadError && !isAlreadyUploaded(uploadError)) return false;

  // The row may already exist from a flush that uploaded and then lost the
  // connection before inserting. The path is unique per photo, so finding one
  // means this is a replay and there is nothing left to do.
  const { data: existing, error: lookupError } = await withTimeout(supabase
    .from('photos')
    .select('id')
    .eq('url', photo.path)
    .maybeSingle());
  if (lookupError) return false;
  if (existing) return true;

  const { error: insertError } = await withTimeout(supabase
    .from('photos')
    .insert({ job_id: photo.jobId, uploaded_by: userId, url: photo.path, caption: photo.caption }));

  return !insertError;
}
