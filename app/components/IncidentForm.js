'use client';

import { useState } from 'react';
import { Camera, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { compressImage } from '../../lib/compressImage';
import { jobHeadline, isTraining } from '../../lib/training';
import {
  KIND_LABELS, KIND_HELP, KIND_BUTTONS, INCIDENT_TYPE_LABELS, INJURED_PARTY_LABELS, OFFICE_INJURED_PARTY_LABELS,
  FORM_INJURED_PARTIES, TREATMENT_LABELS, MAX_PHOTOS, buildIncidentRow, toLocalInputValue,
} from '../../lib/incidents';
import { useToast } from './ToastProvider';
import { saveToOutbox, sendReport } from '../../lib/incidentOutbox';

// The one form for an accident, incident or near miss, used by staff from
// their phone and by the office. office: an admin adding a report somebody
// told them about, or copying in an old one from the paper accident book -
// it asks who told them, and has no job list (they type the place).

export function jobPlace(job) {
  if (!job) return '';
  return isTraining(job) ? (job.training_location?.trim() || jobHeadline(job)) : (job.properties?.address || '');
}

function emptyForm(kind, jobId = '', location = '') {
  return {
    kind,
    occurredAt: toLocalInputValue(new Date()),
    jobId,
    toldBy: '',
    location,
    description: '',
    incidentType: '',
    injuredParty: '',
    injuredName: '',
    injuredAddress: '',
    injuredOccupation: '',
    injuryDetails: '',
    treatment: '',
    damageDetails: '',
    immediateAction: '',
    witnesses: '',
  };
}

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
  background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
};
const hintStyle = { fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' };

function Choice({ name, value, current, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 400, padding: '6px 0' }}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} style={{ width: 'auto' }} />
      {children}
    </label>
  );
}

const PLACEHOLDERS = {
  accident: 'e.g. Slipped on the kitchen floor after mopping and fell against the worktop',
  incident: 'e.g. Knocked a glass vase off the landing windowsill while dusting and it broke',
  near_miss: 'e.g. Extension lead was across the hallway, nearly tripped carrying the hoover',
};

export default function IncidentForm({
  userId, office = false, initialKind = 'accident', initialJobId = '', jobs = [], ownAddress = '', columns, onSaved, onCancel,
}) {
  const toast = useToast();
  const startJob = jobs.find((j) => j.id === initialJobId);
  const [form, setForm] = useState(() => emptyForm(initialKind, startJob ? startJob.id : '', jobPlace(startJob)));
  const [photos, setPhotos] = useState([]); // { file, preview }
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const partyLabels = office ? OFFICE_INJURED_PARTY_LABELS : INJURED_PARTY_LABELS;

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setFromEvent = (field) => (e) => set(field)(e.target.value);

  // Switching who was hurt swaps whose address the box holds.
  const chooseInjured = (value) => setForm((prev) => ({
    ...prev,
    injuredParty: value,
    injuredAddress: value === 'me' ? ownAddress : (prev.injuredParty === 'me' ? '' : prev.injuredAddress),
  }));

  const chooseJob = (jobId) => {
    const job = jobs.find((j) => j.id === jobId);
    setForm((prev) => ({
      ...prev,
      jobId,
      // Fill the place in from the job, unless they have typed their own.
      location: !prev.location || jobs.some((j) => jobPlace(j) === prev.location) ? jobPlace(job) : prev.location,
    }));
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
    // Checked before anything is compressed or sent, so a missing field
    // never leaves orphaned uploads behind.
    const check = buildIncidentRow({ ...form, photoPaths: photos.map(() => 'pending') }, { reporterId: userId, office });
    if (check.errors.length > 0) { setErrors(check.errors); return; }
    setErrors([]);
    setSubmitting(true);

    // Every id and photo path is fixed here, when the report is written, so
    // a send that is retried later cannot make it twice (lib/incidentOutbox).
    const reportId = crypto.randomUUID();
    const photoEntries = [];
    for (const photo of photos) {
      photoEntries.push({ path: `${userId}/${crypto.randomUUID()}.jpg`, blob: await compressImage(photo.file) });
    }
    const { row } = buildIncidentRow({ ...form, photoPaths: photoEntries.map((ph) => ph.path) }, { reporterId: userId, office });
    const entry = { id: reportId, userId, row: { ...row, id: reportId }, photos: photoEntries, savedAt: new Date().toISOString() };

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const result = offline ? { ok: false, retry: true } : await sendReport(supabase, entry, columns);
    const done = (saved, message) => {
      photos.forEach((ph) => URL.revokeObjectURL(ph.preview));
      setSubmitting(false);
      toast.success(message);
      onSaved(saved);
    };

    if (result.ok) {
      done(result.data, office ? 'Report added.' : 'Report sent to the office. Thank you for reporting it.');
      return;
    }

    // No signal: keep it on the phone and let IncidentQueueFlusher send it.
    // Staff only - the office is at a desk, and its pages have no flusher.
    if (result.retry && !office && await saveToOutbox(entry)) {
      done(
        { ...entry.row, status: 'open', created_at: entry.savedAt, jobs: null, pending: true },
        "No signal - your report is saved on this phone and will send itself when you're back in range.",
      );
      return;
    }

    setSubmitting(false);
    if (result.retry) {
      toast.error(office
        ? "Couldn't save the report - check the connection and try again."
        : "Couldn't send the report or keep it on this phone. Try again when you have signal, or ring the office.");
    } else {
      toast.error(office
        ? "The report was refused. Check the details and try again."
        : 'The report was refused. Ring the office and tell them what happened.');
    }
  };

  const accident = form.kind === 'accident';
  const incident = form.kind === 'incident';
  const injured = accident && !!form.injuredParty;
  const nowMax = toLocalInputValue(new Date());

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <h2 style={{ margin: 0 }}>{office ? 'Add a report' : 'Report it'}</h2>
        <button type="button" className="btn-secondary" onClick={onCancel} title="Close the form without saving">Cancel</button>
      </div>

      <label>What happened?</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 6 }}>
        {Object.keys(KIND_LABELS).map((k) => (
          <button key={k} type="button" className={form.kind === k ? '' : 'btn-secondary'} onClick={() => set('kind')(k)} aria-pressed={form.kind === k}>
            {KIND_BUTTONS[k]}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 0 }}>
        <strong>{KIND_LABELS[form.kind]}:</strong> {KIND_HELP[form.kind]}
      </p>

      {office && (
        <>
          <label>Who told you about it? (optional)</label>
          <input value={form.toldBy} onChange={setFromEvent('toldBy')} placeholder="e.g. Sarah rang at 2pm, or: copied from the paper accident book" />
        </>
      )}

      <label>When did it happen?</label>
      <input type="datetime-local" value={form.occurredAt} max={nowMax} onChange={setFromEvent('occurredAt')} />
      {office && <p style={hintStyle}>For an old entry, put the date and time it actually happened.</p>}

      {!office && jobs.length > 0 && (
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

      {incident && (
        <>
          <label>What kind of incident?</label>
          <div style={{ marginBottom: 8 }}>
            {Object.entries(INCIDENT_TYPE_LABELS).map(([value, label]) => (
              <Choice key={value} name="incidentType" value={value} current={form.incidentType} onChange={set('incidentType')}>{label}</Choice>
            ))}
          </div>
        </>
      )}

      <label>Tell us what happened</label>
      <textarea value={form.description} onChange={setFromEvent('description')} rows={4} placeholder={PLACEHOLDERS[form.kind]} style={textareaStyle} />
      {incident && <p style={hintStyle}>If anyone was hurt, choose "Someone got hurt" at the top instead.</p>}

      {accident && (
        <>
          <label>Who was hurt?</label>
          <div style={{ marginBottom: 8 }}>
            {FORM_INJURED_PARTIES.map((value) => (
              <Choice key={value} name="injuredParty" value={value} current={form.injuredParty} onChange={chooseInjured}>{partyLabels[value]}</Choice>
            ))}
          </div>

          {injured && form.injuredParty !== 'me' && (
            <>
              <label>Their name</label>
              <input value={form.injuredName} onChange={setFromEvent('injuredName')} />
              <label>Their address (if you know it)</label>
              <input value={form.injuredAddress} onChange={setFromEvent('injuredAddress')} placeholder={office ? '' : 'The office can add it later'} />
              <label>Their job (if you know it)</label>
              <input value={form.injuredOccupation} onChange={setFromEvent('injuredOccupation')} placeholder={form.injuredParty === 'colleague' ? 'e.g. Cleaning Operative' : 'e.g. Retired, Receptionist'} />
            </>
          )}

          {injured && form.injuredParty === 'me' && (
            <>
              <label>Your home address</label>
              <input value={form.injuredAddress} onChange={setFromEvent('injuredAddress')} placeholder="Can be added later from your record" />
              <p style={hintStyle}>
                The accident book needs it. {ownAddress ? 'Filled in from your profile - change it if it is out of date.' : ''}
              </p>
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
        </>
      )}

      {(injured || incident) && (
        <>
          <label>Was anything damaged, lost or taken? (optional)</label>
          <textarea value={form.damageDetails} onChange={setFromEvent('damageDetails')} rows={2} placeholder="e.g. Glass vase on the landing, broken" style={textareaStyle} />
        </>
      )}

      <label>What was done straight after? (optional)</label>
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
        {submitting ? 'Saving...' : office ? 'Add the report' : 'Send to the office'}
      </button>
    </form>
  );
}
