'use client';

import { PageSkeleton } from '../../../components/Skeleton';
import { useEffect, useState } from 'react';
import { siteStatusFor } from '../../../../lib/siteStatus';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Star } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { COMPANY } from '../../../../lib/companyBranding';
import BackButton from '../../../components/BackButton';
import ReportRooms from '../../../components/ReportRooms';
import VisitProblemReport from '../../../components/VisitProblemReport';
import { downloadReportPdf } from '../../../../lib/downloadReportPdf';
import { REPORT_TEMPLATES, DEFAULT_TEMPLATE } from '../../../../lib/reportTemplates';
import { minutesOnSite, formatDuration } from '../../../../lib/detailedReport';

// "Wednesday 11 November 2026, 12:00" - no seconds.
const longWhen = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null);

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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const [myReschedule, setMyReschedule] = useState(null);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('09:00');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [submittingReschedule, setSubmittingReschedule] = useState(false);

  useEffect(() => {
    load();
    // While a visit is live, the status line follows the cleaner's check-in
    // without the client having to reload.
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
    }, 60000);
    return () => clearInterval(timer);
  }, [id]);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    setClientId(profile?.client_id || null);

    const [{ data: jobData }, { data: taskData }, { data: photoData }, { data: checkinData }, { data: ratingData }, { data: rescheduleData }] = await Promise.all([
      supabase.from('jobs').select('id, scheduled_at, status, duration_minutes, properties(address), job_assignments(profiles(full_name))').eq('id', id).single(),
      supabase.from('tasks').select('*').eq('job_id', id),
      supabase.from('photos').select('*').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('checkins').select('*, profiles(full_name)').eq('job_id', id),
      supabase.from('job_ratings').select('rating, comment').eq('job_id', id).maybeSingle(),
      supabase.from('reschedule_requests').select('id, status, requested_scheduled_at').eq('job_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const { data: reportData } = await supabase
      .from('job_reports')
      .select('summary, issues, suggestions, rooms, template, created_at')
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

  const downloadPdf = async () => {
    setDownloading(true);
    setDownloadError('');
    const failure = await downloadReportPdf({ job: id });
    setDownloading(false);
    if (failure) setDownloadError(failure);
  };

  if (loading) return <PageSkeleton className="" variant="detail" rows={3} />;
  if (!job) return <div>Job not found.</div>;

  // The detailed report's headings say who each part is for ("For the
  // landlord", "Tenant housekeeping"), so they come from its template.
  const reportLabels = (REPORT_TEMPLATES[report?.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels;

  const staffNames = (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);

  return (
    <div>
      <BackButton />
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{job.properties?.address}</h1>
        <p style={{ margin: '4px 0', fontSize: 14 }}>
          {longWhen(job.scheduled_at)} · {staffNames.length > 0 ? staffNames.join(', ') : 'Cleaner to be confirmed'}
        </p>
        <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
        {(() => {
          const status = siteStatusFor(job, checkins);
          const colour = status.state === 'on_site' ? 'var(--wf-verified)'
            : status.state === 'finished' ? 'var(--wf-steel)'
            : status.state === 'late' || status.state === 'past' || status.state === 'missed' ? 'var(--wf-overdue)'
            : 'var(--wf-azure)';
          return (
            <p style={{ margin: '10px 0 0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dash-glance-dot" style={{ background: colour, flexShrink: 0 }} />
              <strong>{status.label}</strong>{status.detail ? <span style={{ color: 'var(--muted)' }}> · {status.detail}</span> : null}
            </p>
          );
        })()}
      </div>

      {report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Clean report</h2>
          {report.summary && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--muted)' }}>{reportLabels.summary}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.summary}</p>
            </div>
          )}
          <ReportRooms rooms={report.rooms} photoUrls={Object.fromEntries(photos.map((p) => [p.id, p.signedUrl]))} />
          {report.issues && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--muted)' }}>{reportLabels.issues}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.issues}</p>
            </div>
          )}
          {report.suggestions && (
            <div>
              <strong style={{ fontSize: 13.5, color: 'var(--muted)' }}>{reportLabels.suggestions}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{report.suggestions}</p>
            </div>
          )}
          <button type="button" className="btn-secondary" onClick={downloadPdf} disabled={downloading} style={{ marginTop: 12 }} title="Save this report, with its photos, as a PDF">
            {downloading ? 'Making PDF...' : 'Download PDF'}
          </button>
          {downloadError && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, marginTop: 8 }}>{downloadError}</p>}
        </div>
      )}

      {checkins.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="dash-panel-header">
            <h2>Time on site</h2>
            {minutesOnSite(checkins) > 0 && <strong style={{ fontSize: 15 }}>{formatDuration(minutesOnSite(checkins))}</strong>}
          </div>
          {checkins.map((c) => (
            <div key={c.id} className="dash-row dash-row-quiet">
              <div>
                <div className="dash-row-title">{c.profiles?.full_name || 'Cleaner'}</div>
                <div className="dash-row-subtitle">
                  Arrived {clock(c.checked_in_at) || '-'}
                  {' · '}
                  {c.checked_out_at ? `left ${clock(c.checked_out_at)}` : job.status === 'in_progress' ? 'still on site' : 'leaving time not recorded'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ticked items read as done, not crossed out: a line through a task
          looked like it had been dropped. */}
      {tasks.length > 0 && (() => {
        const done = tasks.filter((t) => t.completed).length;
        const finished = job.status === 'completed';
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="dash-panel-header">
              <h2>Checklist</h2>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{done} of {tasks.length} done</span>
            </div>
            {[...tasks].sort((a, b) => Number(!!b.completed) - Number(!!a.completed)).map((t) => (
              <div key={t.id} className="task-row">
                {t.completed ? (
                  <CheckCircle2 size={18} color="var(--wf-verified-ink)" style={{ flexShrink: 0 }} aria-label="Done" />
                ) : (
                  <Circle size={18} color="var(--muted)" style={{ flexShrink: 0 }} aria-label="Not ticked" />
                )}
                <span style={{ flex: 1 }}>{t.description}</span>
                {!t.completed && finished && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>not ticked</span>}
              </div>
            ))}
          </div>
        );
      })()}

      {photos.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Photos</h2>
          <div className="photo-grid">
            {photos.map((p) => (
              <a key={p.id} href={p.signedUrl} target="_blank" rel="noopener noreferrer"><img src={p.signedUrl} alt="From the clean" /></a>
            ))}
          </div>
        </div>
      )}

      {job.status === 'scheduled' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Reschedule</h2>
          {myReschedule ? (
            <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              {myReschedule.status === 'pending' && `Requested new time: ${longWhen(myReschedule.requested_scheduled_at)} - waiting for us to confirm.`}
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
                  {submittingReschedule ? 'Sending...' : 'Send request'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setShowRescheduleForm(true)} title="Ask us to move this clean to a different date or time">
              Request a different time
            </button>
          )}
        </div>
      )}

      {(job.status === 'completed' || job.status === 'missed') && clientId && (
        <VisitProblemReport jobId={job.id} clientId={clientId} />
      )}

      {job.status === 'completed' && (
        <div className="card">
          <h2>Rate this clean</h2>
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
                    <button type="button">Leave a review</button>
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
