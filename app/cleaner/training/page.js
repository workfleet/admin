'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { TRAINING_SECTIONS, formatDuration } from '../../../lib/trainingSections';
import Logo from '../../components/Logo';
import BackButton from '../../components/BackButton';

export default function CleanerTraining() {
  const [videos, setVideos] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    // Slots with no file yet are part of the running order but are not
    // something anybody can watch, so they stay off this page rather than
    // showing as a row that does nothing when tapped.
    const { data } = await supabase
      .from('training_videos')
      .select('id, title, blurb, section, position, duration_seconds')
      .not('storage_path', 'is', null)
      .order('position');
    setVideos(data || []);
  };

  // The number beside each video counts through the whole list, not per
  // heading - the copy tells people to watch them in order, so the numbers
  // have to run 1..n straight through.
  const numbered = (videos || []).map((v, i) => ({ ...v, number: i + 1 }));

  return (
    <div>
      <div style={{ background: 'var(--wf-graphite)', padding: '44px 20px 40px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <Logo size={44} showWordmark tone="light" />
          <div
            style={{
              fontFamily: 'var(--wf-data)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
              marginTop: 6,
            }}
          >
            Cleaner training
          </div>
          <h1 style={{ color: 'var(--wf-white)', fontSize: 30, margin: '22px 0 8px' }}>
            How to use the app
          </h1>
          <p
            style={{
              fontFamily: 'var(--wf-data)',
              fontSize: 14,
              color: 'rgba(255,255,255,0.65)',
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Short videos, about a minute each. Watch them in order the first time — after that,
            dip into whichever one you need.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 20px 48px' }}>
        <BackButton />

        {videos === null && <p className="empty-state">Loading...</p>}
        {videos?.length === 0 && (
          <p className="empty-state">
            No training videos have been added yet. The office will let you know when they're ready.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {TRAINING_SECTIONS.map((section) => {
            const inSection = numbered.filter((v) => v.section === section.key);
            if (inSection.length === 0) return null;
            return (
              <div key={section.key} style={{ display: 'contents' }}>
                <div
                  style={{
                    fontFamily: 'var(--wf-data)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--wf-steel)',
                    margin: '4px 0 2px',
                  }}
                >
                  {section.label}
                </div>
                {inSection.map((video) => (
                  <Link
                    key={video.id}
                    href={`/cleaner/training/${video.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      background: 'var(--wf-white)',
                      border: '1px solid var(--wf-line)',
                      borderRadius: 'var(--wf-radius)',
                      padding: 16,
                      color: 'var(--wf-graphite)',
                      textDecoration: 'none',
                      boxShadow: '0 1px 2px rgba(32,35,39,0.06)',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        flex: 'none',
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--wf-coral)',
                        color: 'var(--wf-on-coral)',
                        fontFamily: 'var(--wf-data)',
                        fontWeight: 700,
                        fontSize: 15,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {video.number}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>
                        {video.title}
                      </span>
                      {video.blurb && (
                        <span
                          style={{
                            display: 'block',
                            fontFamily: 'var(--wf-data)',
                            fontSize: 12.5,
                            color: 'var(--wf-steel)',
                            marginTop: 2,
                          }}
                        >
                          {video.blurb}
                        </span>
                      )}
                    </span>
                    {video.duration_seconds != null && (
                      <span
                        style={{
                          fontFamily: 'var(--wf-data)',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--wf-steel)',
                        }}
                      >
                        {formatDuration(video.duration_seconds)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        {videos?.length > 0 && (
          <p
            style={{
              fontFamily: 'var(--wf-data)',
              fontSize: 12,
              color: 'var(--wf-steel)',
              margin: '16px 0 0',
              lineHeight: 1.5,
            }}
          >
            Questions? Message the office in the app.
          </p>
        )}
      </div>
    </div>
  );
}
