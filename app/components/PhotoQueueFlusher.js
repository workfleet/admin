'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import { isAlreadyUploaded, pendingPhotos, removePhoto, withTimeout } from '../../lib/photoQueue';

// Sends job photos taken while offline. See lib/photoQueue.js.
//
// Sits below the clock-queue banner rather than merging with it, because the
// two say different things to somebody deciding whether they can leave: an
// unsent clock-in affects their pay, an unsent photo affects whether the job
// can be defended later. Collapsing them into "3 things pending" would tell
// them neither.

const RETRY_INTERVAL_MS = 60 * 1000;

export default function PhotoQueueFlusher() {
  const toast = useToast();
  const [pending, setPending] = useState(0);

  // One flush at a time. Uploads on a weak signal can outlast the retry
  // timer, and two flushes walking the same queue both found no photos row
  // and both inserted one.
  const running = useRef(false);

  const flushQueue = useCallback(async () => {
    const queue = await pendingPhotos();
    setPending(queue.length);
    if (queue.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const session = await getSessionWithRetry();
    if (!session || session.offline) return;

    let sent = 0;
    let failedInARow = 0;
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
    }

    const left = (await pendingPhotos()).length;
    setPending(left);
    if (sent > 0 && left === 0) {
      toast.success(sent === 1 ? 'Your photo has been sent.' : `${sent} photos have been sent.`);
    }
  }, [toast]);

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
    <div role="status" className="queue-banner is-photos">
      <ImageUp size={16} aria-hidden />
      <span>
        {pending === 1 ? 'One photo is waiting to send' : `${pending} photos are waiting to send`}
        {' '}— they’ll go when you get signal. Don’t clear the app until they do.
      </span>
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
