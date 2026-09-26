'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { compressImage } from '../../../lib/compressImage';
import { assignedJob } from '../../../lib/hoursWorked';
import { jobHeadline, isTraining, TRAINING_JOB_COLUMNS } from '../../../lib/training';
import {
  KIND_LABELS, INJURED_PARTY_LABELS, TREATMENT_LABELS, STATUS_LABELS, STATUS_BADGE_CLASS, MAX_PHOTOS,
  buildIncidentRow, toLocalInputValue, incidentSummary,
} from '../../../lib/incidents';
import IncidentDetails, { formatWhen } from '../../components/IncidentDetails';
import BackButton from '../../components/BackButton';
import { useToast } from '../../components/ToastProvider';

const REPORT_COLUMNS = 'id, kind, occurred_at, location, description, injured_party, injured_name, injury_details, treatment, damage_details, immediate_action, witnesses, photo_paths, status, corrective_action, closed_at, created_at, jobs(scheduled_at, properties(address))';

// Jobs from the last fortnight to now, for "which job was this on". An
// accident is usually reported the same day; a near miss someone has been
// meaning to mention can be a week or so old.
const JOB_LOOKBACK_DAYS = 14;

function emptyForm(kind = 'accident', jobId = '') {
  return {
    kind,
    occurredAt: toLocalInputValue(new Date()),
    jobId,
    location: '',
    description: '',
    injuredParty: '',
    injuredName: '',
    injuryDetails: '',
    treatment: '',
    damageDetails: '',
    immediateAction: '',
    witnesses: '',
  };
}

function jobPlace(job) {
  if (!job) return '';
  return isTraining(job) ? (job.training_location?.trim() || jobHeadline(job)) : (job.properties?.address || '');
}

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
  background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
};

function Choice({ name, value, current, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 400, padding: '6px 0' }}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} style={{ width: 'auto' }} />
      {children}
    </label>
  );
}

export default function CleanerIncidents() {
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [reports, setReports] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [photos, setPhotos] = useState([]); // { file, preview }
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const since = new Date(Date.now() - JOB_LOOKBACK_DAYS * 24 * 3600000).toISOString();
    const [{ data: assignmentRows }, { data: reportRows }] = await Promise.all([
      supabase
        .from('job_assignments')
        .select(`jobs(id, scheduled_at, status, ${TRAINING_JOB_COLUMNS}, properties(address))`)
        .eq('cleaner_id', session.user.id),
      supabase
        .from('incident_reports')
        .select(REPORT_COLUMNS)
        .eq('reported_by', session.user.id)
        .order('occurred_at', { ascending: false }),
    ]);

    const now = Date.now();
    const recentJobs = (assignmentRows || [])
      .map(assignedJob)
      .filter((j) => j && j.scheduled_at >= since && new Date(j.scheduled_at).getTime() <= now + 12 * 3600000)
      .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
    setJobs(recentJobs);
    setReports(reportRows || []);
    setLoading(false);

    // Opened from a job page: start the form on that job.
    const params = new URLSearchParams(window.location.search);
    const fromJob = params.get('job');
    const kind = params.get('kind') === 'near_miss' ? 'near_miss' : 'accident';
    if (fromJob || params.get('kind')) {
      const job = recentJobs.find((j) => j.id === fromJob);
      setForm({ ...emptyForm(kind, job ? job.id : ''), location: jobPlace(job) });
      setShowForm(true);
    }
  };

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setFromEvent = (field) => (e) => set(field)(e.target.value);

  const chooseJob = (jobId) => {
    const job = jobs.find((j) => j.id === jobId);
    setForm((prev) => ({
      ...prev,
      jobId,
      // Fill the place in from the job, unless they have typed their own.
      location: !prev.location || jobs.some((j) => jobPlace(j) === prev.location) ? jobPlace(job) : prev.location,
    }));
  };

  const startForm = (kind) => {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setErrors([]);
    setForm(emptyForm(kind));
    setShowForm(true);
  };

  const addPhotos = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setPhotos((prev) => [
      ...prev,
      ...files.slice(0, Math.max(0, MAX_PHOTOS - prev.length)).map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  };

  const removePhoto = (index) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    // Checked before any photo goes up, so a missing field never leaves
    // orphaned uploads behind.
    const check = buildIncidentRow({ ...form, photoPaths: photos.map(() => 'pending') }, { reporterId: userId });
    if (check.errors.length > 0) { setErrors(check.errors); return; }
    setErrors([]);
    setSubmitting(true);

    const paths = [];
    for (const photo of photos) {
      const file = await compressImage(photo.file);
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('incident-photos').upload(path, file, { contentType: 'image/jpeg' });
      if (error) {
        setSubmitting(false);
        toast.error("A photo didn't upload. Check your signal and try again, or send it without the photos.");
        return;
      }
      paths.push(path);
    }

    const { row } = buildIncidentRow({ ...form, photoPaths: paths }, { reporterId: userId });
    const { data, error } = await supabase.from('incident_reports').insert(row).select(REPORT_COLUMNS).single();
    setSubmitting(false);
    if (error || !data) {
      toast.error("Couldn't send the report. Check your signal and try again - if it keeps failing, ring the office.");
      return;
    }

    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setReports((prev) => [data, ...prev]);
    setShowForm(false);
    setForm(emptyForm());
    toast.success('Report sent to the office. Thank you for reporting it.');
  };

  const toggleReport = async (report) => {
    const next = openId === report.id ? null : report.id;
    setOpenId(next);
    if (!next || photoUrls[report.id] || (report.photo_paths || []).length === 0) return;
    const urls = await Promise.all(report.photo_paths.map(async (path) => {
      const { data } = await supabase.storage.from('incident-photos').createSignedUrl(path, 3600);
      return data?.signedUrl || null;
    }));
    setPhotoUrls((prev) => ({ ...prev, [report.id]: urls }));
  };

  if (loading) return <div className="container">Loading...</div>;

  const accident = form.kind === 'accident';
  const injured = accident && form.injuredParty && form.injuredParty !== 'nobody';

  return (
    <div className="container">
      <BackButton />
      <h1>Accidents &amp; near misses</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
        Report anything that hurt someone or damaged something, and anything that nearly did. Near misses matter -
        they are how we stop the next accident.
      </p>

      <div className="card" style={{ borderLeft: '4px solid var(--wf-overdue)' }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          <strong>If someone is badly hurt, call 999 first.</strong> Use the emergency button if you need the office right now.
          Fill this in once everyone is safe.
        </p>
      </div>

      {!showForm && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => startForm('accident')} style={{ flex: 1 }}>Report an accident</button>
            <button type="button" className="btn-secondary" onClick={() => startForm('near_miss')} style={{ flex: 1 }}>Report a near miss</button>
          </div>
        </div>
      )}

      {showForm && (
        <form className="card" onSubmit={submit} noValidate>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{accident ? 'Report an accident' : 'Report a near miss'}</h2>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} title="Close the form without sending">Cancel</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {['accident', 'near_miss'].map((k) => (
              <button key={k} type="button" className={form.kind === k ? '' : 'btn-secondary'} onClick={() => set('kind')(k)} style={{ flex: 1 }}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 0 }}>
            {accident
              ? 'Someone was hurt, or something was damaged.'
              : 'Nobody was hurt and nothing was damaged this time - but it could have been. A wet floor with no sign, a trailing cable, a loose stair rod, mixing products.'}
          </p>

          <label>When did it happen?</label>
          <input type="datetime-local" value={form.occurredAt} max={toLocalInputValue(new Date())} onChange={setFromEvent('occurredAt')} />

          {jobs.length > 0 && (
            <>
              <label>Which job were you on? (optional)</label>
              <select value={form.jobId} onChange={(e) => chooseJob(e.target.value)}>
                <option value="">Not on a job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobHeadline(j)} - {new Date(j.scheduled_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </>
          )}

          <label>Where exactly?</label>
          <input value={form.location} onChange={setFromEvent('location')} placeholder="e.g. 12 High Street, back stairs" />

          <label>What happened?</label>
          <textarea
            value={form.description}
            onChange={setFromEvent('description')}
            rows={4}
            placeholder={accident ? 'e.g. Slipped on the kitchen floor after mopping and fell against the worktop' : 'e.g. Extension lead was across the hallway, nearly tripped carrying the hoover'}
            style={textareaStyle}
          />

          {accident && (
            <>
              <label>Who was hurt?</label>
              <div style={{ marginBottom: 8 }}>
                {Object.entries(INJURED_PARTY_LABELS).map(([value, label]) => (
                  <Choice key={value} name="injuredParty" value={value} current={form.injuredParty} onChange={set('injuredParty')}>{label}</Choice>
                ))}
              </div>

              {injured && form.injuredParty !== 'me' && (
                <>
                  <label>Their name</label>
                  <input value={form.injuredName} onChange={setFromEvent('injuredName')} />
                </>
              )}

              {injured && (
                <>
                  <label>What is the injury, and where on the body?</label>
                  <textarea value={form.injuryDetails} onChange={setFromEvent('injuryDetails')} rows={2} placeholder="e.g. Bruised left hip, small cut on hand" style={textareaStyle} />

                  <label>What treatment did they have?</label>
                  <div style={{ marginBottom: 8 }}>
                    {Object.entries(TREATMENT_LABELS).map(([value, label]) => (
                      <Choice key={value} name="treatment" value={value} current={form.treatment} onChange={set('treatment')}>{label}</Choice>
                    ))}
                  </div>
                </>
              )}

              {form.injuredParty && (
                <>
                  <label>{form.injuredParty === 'nobody' ? 'What was damaged?' : 'Was anything damaged? (optional)'}</label>
                  <textarea value={form.damageDetails} onChange={setFromEvent('damageDetails')} rows={2} placeholder="e.g. Glass vase on the landing, broken" style={textareaStyle} />
                </>
              )}
            </>
          )}

          <label>What did you do straight after? (optional)</label>
          <textarea value={form.immediateAction} onChange={setFromEvent('immediateAction')} rows={2} placeholder="e.g. Put a wet floor sign out, told the client" style={textareaStyle} />

          <label>Did anyone see it? (optional)</label>
          <input value={form.witnesses} onChange={setFromEvent('witnesses')} placeholder="Names, and a phone number if you have one" />

          <label>Photos (optional, up to {MAX_PHOTOS})</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {photos.map((p, i) => (
              <div key={p.preview} style={{ position: 'relative' }}>
                <img src={p.preview} alt={`Photo ${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  title="Remove this photo"
                  style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label
                title="Take or choose a photo"
                aria-label="Add a photo"
                style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px dashed var(--hairline)', background: 'var(--wf-ash)', color: 'var(--muted)', cursor: 'pointer', margin: 0 }}
              >
                <Camera size={22} />
                <input type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          {errors.length > 0 && (
            <ul role="alert" style={{ color: 'var(--wf-overdue)', fontSize: 13.5, paddingLeft: 18, margin: '0 0 12px' }}>
              {errors.map((err) => <li key={err}>{err}</li>)}
            </ul>
          )}

          <button type="submit" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Sending...' : 'Send to the office'}
          </button>
        </form>
      )}

      <div className="card">
        <h2>Your reports</h2>
        {reports.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>You haven't reported anything yet.</p>}
        {reports.map((r) => (
          <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button
              type="button"
              onClick={() => toggleReport(r)}
              title={openId === r.id ? 'Hide the details' : 'Show the details'}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', width: '100%' }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{KIND_LABELS[r.kind]} - {formatWhen(r.occurred_at)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{r.location} · {incidentSummary(r)}</div>
              </div>
              <span className={`badge ${STATUS_BADGE_CLASS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
            </button>
            {openId === r.id && (
              <div style={{ marginTop: 10 }}>
                <IncidentDetails report={r} photoUrls={photoUrls[r.id] || []} />
                {r.status === 'closed' && r.corrective_action && (
                  <div style={{ fontSize: 13.5, background: 'var(--wf-ash)', borderRadius: 8, padding: '8px 10px' }}>
                    <strong>What the office changed:</strong> {r.corrective_action}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
