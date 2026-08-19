'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Star } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { COMPANY } from '../../../../lib/companyBranding';
import BackButton from '../../../components/BackButton';

export default function ClientJobDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [clientId, setClientId] = useState(null);
  const [job, setJob] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState(null);
  const [ratingHover, setRatingHover] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  const [report, setReport] = useState(null);

  const [myReschedule, setMyReschedule] = useState(null);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('09:00');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [submittingReschedule, setSubmittingReschedule] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    setClientId(profile?.client_id || null);

    const [{ data: jobData }, { data: taskData }, { data: photoData }, { data: checkinData }, { data: ratingData }, { data: rescheduleData }] = await Promise.all([
      supabase.from('jobs').select('id, scheduled_at, status, properties(address), job_assignments(profiles(full_name))').eq('id', id).single(),
      supabase.from('tasks').select('*').eq('job_id', id),
      supabase.from('photos').select('*').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('checkins').select('*, profiles(full_name)').eq('job_id', id),
      supabase.from('job_ratings').select('rating, comment').eq('job_id', id).maybeSingle(),
      supabase.from('reschedule_requests').select('id, status, requested_scheduled_at').eq('job_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const { data: reportData } = await supabase
      .from('job_reports')
      .select('summary, issues, suggestions, created_at')
      .eq('job_id', id)
      .eq('visible_to_client', true)
      .maybeSingle();
    setReport(reportData || null);

    const photosWithUrls = await Promise.all(
      (photoData || []).map(async (p) => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      })
    );

    setJob(jobData);
    setTasks(taskData || []);
    setPhotos(photosWithUrls);
    setCheckins(checkinData || []);
    setRating(ratingData || null);
    setMyReschedule(rescheduleData || null);
    setLoading(false);
  };

  const submitRating = async (stars) => {
    if (!clientId) return;
    setSubmittingRating(true);
    const { data, error } = await supabase
      .from('job_ratings')
      .insert({ job_id: id, client_id: clientId, rating: stars, comment: ratingComment.trim() || null })
      .select('rating, comment')
      .single();
    setSubmittingRating(false);
    if (!error && data) setRating(data);
  };

  const submitReschedule = async (e) => {
    e.preventDefault();
    if (!clientId || !rescheduleDate) return;
    setSubmittingReschedule(true);

    const requestedAt = new Date(`${rescheduleDate}T${rescheduleTime}`).toISOString();
    const { data, error } = await supabase
      .from('reschedule_requests')
      .insert({ job_id: id, client_id: clientId, requested_scheduled_at: requestedAt, reason: rescheduleReason.trim() || null })
      .select('id, status, requested_scheduled_at')
      .single();

    setSubmittingReschedule(false);
    if (data) {
      setMyReschedule(data);
      setShowRescheduleForm(false);
      setRescheduleDate('');
      setRescheduleTime('09:00');
      setRescheduleReason('');
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!job) return <div>Job not found.</div>;

  const staffNames = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);

  return (
    <div>
      <BackButton />
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{job.properties?.address}</h1>
        <p style={{ margin: '4px 0', fontSize: 14 }}>
          {new Date(job.scheduled_at).toLocaleString()} — {staffNames.length > 0 ? staffNames.join(', ') : 'Unassigned'}
        </p>
        <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
      </div>

      {report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Clean Report</h2>
          {report.summary && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Summary</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.summary}</p>
            </div>
          )}
          {report.issues && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Issues Found</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.issues}</p>
            </div>
          )}
          {report.suggestions && (
            <div>
              <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Suggestions</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.suggestions}</p>
            </div>
          )}
        </div>
      )}

      {checkins.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Visit Log</h2>
          {checkins.map((c) => (
            <p key={c.id} style={{ fontSize: 13, color: 'var(--muted)' }}>
              {c.profiles?.full_name ? `${c.profiles.full_name} — ` : ''}
              Checked in: {c.checked_in_at ? new Date(c.checked_in_at).toLocaleTimeString() : '—'}{' '}
              · Checked out: {c.checked_out_at ? new Date(c.checked_out_at).toLocaleTimeString() : '—'}
            </p>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Tasks</h2>
        {tasks.length === 0 && <p className="empty-state">No tasks recorded.</p>}
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
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Photos</h2>
        {photos.length === 0 && <p className="empty-state">No photos for this clean.</p>}
        <div className="photo-grid">
          {photos.map((p) => (
            <img key={p.id} src={p.signedUrl} alt="job" />
          ))}
        </div>
      </div>

      {job.status === 'scheduled' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Reschedule</h2>
          {myReschedule ? (
            <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              {myReschedule.status === 'pending' && `Requested new time: ${new Date(myReschedule.requested_scheduled_at).toLocaleString()} - waiting for us to confirm.`}
              {myReschedule.status === 'approved' && 'Your reschedule request was approved.'}
              {myReschedule.status === 'declined' && "Your reschedule request was declined - message us if you'd like to try a different time."}
            </p>
          ) : showRescheduleForm ? (
            <form onSubmit={submitReschedule}>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">New date</label>
                  <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="field-label">New time</label>
                  <input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} required />
                </div>
              </div>
              <input
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="Reason (optional)"
                style={{ marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowRescheduleForm(false)}>Cancel</button>
                <button type="submit" disabled={submittingReschedule}>
                  {submittingReschedule ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setShowRescheduleForm(true)}>
              Request a different time
            </button>
          )}
        </div>
      )}

      {job.status === 'completed' && (
        <div className="card">
          <h2>Rate This Clean</h2>
          {rating ? (
            <>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={22} fill={n <= rating.rating ? '#f59e0b' : 'none'} color="#f59e0b" />
                ))}
              </div>
              {rating.comment && <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0' }}>{rating.comment}</p>}
              {rating.rating >= 4 && COMPANY.googleReviewUrl && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
                  <p style={{ fontSize: 14, margin: '0 0 8px' }}>Glad you're happy with the clean! Mind leaving us a quick public review?</p>
                  <a href={COMPANY.googleReviewUrl} target="_blank" rel="noopener noreferrer">
                    <button type="button">Leave a Review</button>
                  </a>
                </div>
              )}
              {rating.rating <= 3 && (
                <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 10 }}>
                  Thanks for letting us know - we've flagged this with the office so we can put it right.
                </p>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    size={26}
                    fill={n <= ratingHover ? '#f59e0b' : 'none'}
                    color="#f59e0b"
                    style={{ cursor: submittingRating ? 'default' : 'pointer' }}
                    onMouseEnter={() => setRatingHover(n)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => !submittingRating && submitRating(n)}
                  />
                ))}
              </div>
              <input
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Add a comment (optional) - click a star to submit"
                style={{ marginTop: 8, marginBottom: 0 }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
