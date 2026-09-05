'use client';

import { useCallback, useEffect, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getSessionWithRetry } from '../../lib/authGate';
import { useToast } from './ToastProvider';
import { pendingPhotos, removePhoto } from '../../lib/photoQueue';

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

  const flush = useCallback(async () => {
    const queue = await pendingPhotos();
    setPending(queue.length);
    if (queue.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const session = await getSessionWithRetry();
    if (!session) return;

    let sent = 0;
    for (const photo of queue) {
      const done = await flushPhoto(photo, session.user.id);
      if (!done) break; // still no usable connection - keep the rest for later
      await removePhoto(photo.id);
      sent += 1;
    }

    const left = (await pendingPhotos()).length;
    setPending(left);
    if (sent > 0 && left === 0) {
      toast.success(sent === 1 ? 'Your photo has been sent.' : `${sent} photos have been sent.`);
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
        position: 'fixed', left: 12, right: 12, bottom: 132, zIndex: 55,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--wf-slate)', color: 'var(--wf-white)',
        borderRadius: 'var(--wf-radius)', padding: '10px 14px',
        boxShadow: 'var(--shadow-md)', fontSize: 13,
      }}
    >
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
  const { error: uploadError } = await supabase.storage
    .from('job-photos')
    .upload(photo.path, photo.blob, { contentType: 'image/jpeg', upsert: true });

  // upsert:true makes a replay harmless - the path was decided when the photo
  // was taken, so re-uploading overwrites the same object with itself rather
  // than adding a second copy under a new name.
  if (uploadError) return false;

  // The row may already exist from a flush that uploaded and then lost the
  // connection before inserting. The path is unique per photo, so finding one
  // means this is a replay and there is nothing left to do.
  const { data: existing } = await supabase
    .from('photos')
    .select('id')
    .eq('url', photo.path)
    .maybeSingle();
  if (existing) return true;

  const { error: insertError } = await supabase
    .from('photos')
    .insert({ job_id: photo.jobId, uploaded_by: userId, url: photo.path, caption: photo.caption });

  return !insertError;
}
