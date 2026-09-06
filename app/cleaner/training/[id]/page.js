'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { TRAINING_SECTION_LABELS, formatDuration } from '../../../../lib/trainingSections';

export default function CleanerTrainingVideo() {
  const { id } = useParams();
  const videoRef = useRef(null);
  // A video fires 'play' every time it is unpaused. The view row only needs
  // writing once per visit, so the first play latches it.
  const viewRecorded = useRef(false);

  const [video, setVideo] = useState(null);
  const [neighbours, setNeighbours] = useState({ prev: null, next: null });
  const [sourceUrl, setSourceUrl] = useState(null);
  const [viewerId, setViewerId] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    viewRecorded.current = false;
    load();
  }, [id]);

  const load = async () => {
    setLoadError(false);
    const session = await getSessionWithRetry();
    setViewerId(session?.user?.id || null);

    // The whole running order, because the page needs this video, the one
    // before it and the one after it, and eight rows is cheaper to fetch
    // once than three separate positional queries.
    const { data: all, error } = await supabase
      .from('training_videos')
      .select('id, title, blurb, section, position, duration_seconds, storage_path')
      .not('storage_path', 'is', null)
      .order('position');

    if (error || !all) { setLoadError(true); return; }

    const index = all.findIndex((v) => v.id === id);
    if (index === -1) { setLoadError(true); return; }

    setVideo(all[index]);
    setNeighbours({ prev: all[index - 1] || null, next: all[index + 1] || null });

    const { data: signed } = await supabase.storage
      .from('training-videos')
      .createSignedUrl(all[index].storage_path, 3600);
    if (!signed?.signedUrl) { setLoadError(true); return; }
    setSourceUrl(signed.signedUrl);
  };

  const recordView = async () => {
    if (viewRecorded.current || !viewerId || !video) return;
    viewRecorded.current = true;
    // first_viewed_at is left out on purpose: it keeps its default on the
    // first write and is not touched on a rewatch, so it stays the date
    // they actually first saw this.
    await supabase
      .from('training_video_views')
      .upsert(
        { video_id: video.id, viewer_id: viewerId, last_viewed_at: new Date().toISOString() },
        { onConflict: 'video_id,viewer_id' }
      );
  };

  const recordCompletion = async () => {
    if (!viewerId || !video) return;
    await supabase
      .from('training_video_views')
      .upsert(
        {
          video_id: video.id,
          viewer_id: viewerId,
          last_viewed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'video_id,viewer_id' }
      );
  };

  if (loadError) {
    return (
      <div className="container">
        <p style={{ marginBottom: 12 }}>
          Couldn't load this video - please check your connection and try again.
        </p>
        <button onClick={load}>Retry</button>
        <p style={{ marginTop: 16 }}>
          <Link href="/cleaner/training">Back to all videos</Link>
        </p>
      </div>
    );
  }

  if (!video) return <p className="empty-state" style={{ padding: 24 }}>Loading...</p>;

  return (
    <div>
      <div style={{ background: 'var(--wf-graphite)', padding: '20px 20px 28px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <Link
            href="/cleaner/training"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--wf-data)',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.65)',
              textDecoration: 'none',
              marginBottom: 18,
            }}
          >
            <ArrowLeft size={14} /> All videos
          </Link>
          <div
            style={{
              fontFamily: 'var(--wf-data)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            {TRAINING_SECTION_LABELS[video.section]}
            {video.duration_seconds != null && ` · ${formatDuration(video.duration_seconds)}`}
          </div>
          <h1 style={{ color: 'var(--wf-white)', fontSize: 24, margin: '8px 0 0' }}>{video.title}</h1>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '20px 20px 48px' }}>
        {sourceUrl ? (
          <video
            ref={videoRef}
            src={sourceUrl}
            controls
            playsInline
            preload="metadata"
            onPlay={recordView}
            onEnded={recordCompletion}
            style={{
              width: '100%',
              display: 'block',
              background: 'var(--wf-graphite)',
              borderRadius: 'var(--wf-radius)',
            }}
          />
        ) : (
          <p className="empty-state">Loading video...</p>
        )}

        {video.blurb && (
          <p
            style={{
              fontFamily: 'var(--wf-data)',
              fontSize: 13.5,
              color: 'var(--wf-steel)',
              lineHeight: 1.55,
              margin: '14px 0 0',
            }}
          >
            {video.blurb}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          {neighbours.prev && (
            <Link
              href={`/cleaner/training/${neighbours.prev.id}`}
              className="btn-secondary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}
            >
              <ArrowLeft size={15} /> Previous
            </Link>
          )}
          {neighbours.next && (
            <Link
              href={`/cleaner/training/${neighbours.next.id}`}
              className="btn-primary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}
            >
              Next <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
