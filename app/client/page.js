'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function ClientPortal() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [expandedJob, setExpandedJob] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [checkin, setCheckin] = useState(null);

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address), profiles(full_name)')
      .order('scheduled_at', { ascending: false });

    setJobs(data || []);
  };

  const openJob = async (jobId) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobId);

    const [{ data: taskData }, { data: photoData }, { data: checkinData }] = await Promise.all([
      supabase.from('tasks').select('*').eq('job_id', jobId),
      supabase.from('photos').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      supabase.from('checkins').select('*').eq('job_id', jobId).maybeSingle(),
    ]);

    // photos.url stores the job-photos storage path, not a public URL —
    // the bucket is private, so each photo needs a freshly signed URL.
    const photosWithUrls = await Promise.all(
      (photoData || []).map(async (p) => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      })
    );

    setTasks(taskData || []);
    setPhotos(photosWithUrls);
    setCheckin(checkinData);
  };

  return (
    <div className="container">
      <h1>Cleaning Log</h1>

      {jobs.length === 0 && <p>No jobs recorded yet.</p>}

      {jobs.map((job) => (
        <div key={job.id} className="card">
          <div onClick={() => openJob(job.id)} style={{ cursor: 'pointer' }}>
            <h2>{job.properties?.address}</h2>
            <p style={{ margin: '4px 0', fontSize: 14 }}>
              {new Date(job.scheduled_at).toLocaleString()} — {job.profiles?.full_name || 'Unassigned'}
            </p>
            <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
          </div>

          {expandedJob === job.id && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              {checkin && (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Checked in: {checkin.checked_in_at ? new Date(checkin.checked_in_at).toLocaleTimeString() : '—'}{' '}
                  · Checked out: {checkin.checked_out_at ? new Date(checkin.checked_out_at).toLocaleTimeString() : '—'}
                </p>
              )}

              <h2 style={{ marginTop: 10 }}>Tasks</h2>
              {tasks.map((t) => (
                <div key={t.id} className={`task-row ${t.completed ? 'done' : ''}`}>
                  {t.completed ? (
                    <CheckCircle2 size={16} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Circle size={16} color="var(--muted)" style={{ flexShrink: 0 }} />
                  )}
                  <span>{t.description}</span>
                </div>
              ))}

              <h2 style={{ marginTop: 10 }}>Photos</h2>
              <div className="photo-grid">
                {photos.map((p) => (
                  <img key={p.id} src={p.signedUrl} alt="job" />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
