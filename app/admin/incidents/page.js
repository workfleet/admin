'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Circle, Copy, Download, Plus } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../lib/authGate';
import { toCSV, downloadCSV } from '../../../lib/csv';
import { localDateString } from '../../../lib/localDate';
import { companyFromSettings } from '../../../lib/companyBranding';
import {
  KIND_LABELS, STATUS_LABELS, STATUS_BADGE_CLASS, SEVERITY_LABELS, INJURED_STATUS_LABELS, ACCIDENT_KIND_LABELS,
  isReportableCategory, wasInjured, riddorState, daysOffWork, accidentBookGaps, todoList, closeProblems,
  hseQuestions, answersFromReport, riddorFromAnswers, hseOutcome, hseNotes, hseSummary,
  londonDate, addDays, formatDay, incidentSummary, CSV_COLUMNS, csvRow,
} from '../../../lib/incidents';
import IncidentDetails, { formatWhen } from '../../components/IncidentDetails';
import IncidentForm from '../../components/IncidentForm';
import BackButton from '../../components/BackButton';
import { useToast } from '../../components/ToastProvider';

// The embed is hinted even though reported_by is the table's only FK to
// profiles today - a second one added later would otherwise take this page
// down with PGRST201 (0094/0095).
const COLUMNS = 'id, kind, incident_type, told_by, occurred_at, job_id, location, description, injured_party, injured_name, injured_address, injured_occupation, injury_details, treatment, damage_details, immediate_action, witnesses, photo_paths, recorded_by_address, recorded_by_occupation, status, severity, injured_status, accident_kind, body_part, off_work, back_at_work_on, riddor_category, riddor_reported_on, riddor_reference, insurer_notified_on, client_notified_on, risk_assessment_reviewed_on, root_cause, corrective_action, reviewed_by, reviewed_at, closed_at, created_at, reported_by, reporter:profiles!incident_reports_reported_by_fkey(full_name), jobs(scheduled_at, property_id, properties(address))';

const HAZARD_COLUMNS = 'id, property_id, hazard, incident_id, created_at, properties(address, clients(name))';

const FILTERS = [
  { key: 'active', label: 'Still open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
  background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
};
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 12px' };
const sectionStyle = { borderTop: '1px solid var(--hairline)', paddingTop: 12, marginTop: 12 };
const helpStyle = { fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' };
const TONE_STYLE = {
  urgent: { background: 'var(--wf-overdue-tint)', fontWeight: 600 },
  todo: { background: 'var(--wf-ash)' },
  ok: { background: 'var(--wf-ash)' },
};

function followUpFrom(report) {
  return {
    severity: report.severity || '',
    injured_status: report.injured_status || '',
    accident_kind: report.accident_kind || '',
    body_part: report.body_part || '',
    injured_address: report.injured_address || '',
    injured_occupation: report.injured_occupation || '',
    off_work: !!report.off_work,
    back_at_work_on: report.back_at_work_on || '',
    answers: answersFromReport(report),
    riddor_reported_on: report.riddor_reported_on || '',
    riddor_reference: report.riddor_reference || '',
    insurer_notified_on: report.insurer_notified_on || '',
    client_notified_on: report.client_notified_on || '',
    risk_assessment_reviewed_on: report.risk_assessment_reviewed_on || '',
    root_cause: report.root_cause || '',
    corrective_action: report.corrective_action || '',
  };
}

const blank = (v) => (typeof v === 'string' ? v.trim() || null : v);

// The form as the row it would save, so the checklist, the HSE answer and
// the close check all read what is typed rather than what was last saved.
function draftOf(report, f, today) {
  const draft = {
    ...report,
    severity: f.severity || null,
    injured_status: f.injured_status || null,
    accident_kind: f.accident_kind || null,
    body_part: blank(f.body_part),
    // Once filled these are fixed by the database (0130), so only a blank
    // one takes what is typed.
    injured_address: report.injured_address || blank(f.injured_address),
    injured_occupation: report.injured_occupation || blank(f.injured_occupation),
    off_work: f.off_work,
    back_at_work_on: f.off_work ? f.back_at_work_on || null : null,
    insurer_notified_on: f.insurer_notified_on || null,
    client_notified_on: f.client_notified_on || null,
    risk_assessment_reviewed_on: f.risk_assessment_reviewed_on || null,
    root_cause: blank(f.root_cause),
    corrective_action: blank(f.corrective_action),
  };
  draft.riddor_category = riddorFromAnswers(draft, f.answers, today);
  const reportable = isReportableCategory(draft.riddor_category);
  draft.riddor_reported_on = reportable ? f.riddor_reported_on || null : null;
  draft.riddor_reference = reportable ? blank(f.riddor_reference) : null;
  return draft;
}

function Field({ label, children }) {
  return (
    <div>
      <label>{label}</label>
      {children}
    </div>
  );
}

function YesNo({ name, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 16, margin: '4px 0 12px' }}>
      {['yes', 'no'].map((v) => (
        <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 14, margin: 0 }}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} style={{ width: 'auto' }} />
          {v === 'yes' ? 'Yes' : 'No'}
        </label>
      ))}
    </div>
  );
}

function Checklist({ items }) {
  const left = items.filter((i) => !i.done);
  return (
    <div style={{ background: 'var(--wf-ash)', borderRadius: 10, padding: '12px 14px', marginBottom: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
        {left.length === 0 ? 'All done - you can close this report.' : "What's left to do"}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, padding: '3px 0', color: i.done ? 'var(--muted)' : 'inherit' }}>
            {i.done
              ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--wf-done, #2f9e6b)' }} aria-label="Done" />
              : <Circle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-label="Not done" />}
            <span style={{ textDecoration: i.done ? 'line-through' : 'none' }}>
              {i.label}
              {!i.done && !i.required && <span style={{ color: 'var(--muted)' }}> (recommended)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function placeLabel(p) {
  if (!p) return '';
  const client = p.clients?.name;
  return client && !p.address?.includes(client) ? `${p.address} (${client})` : p.address;
}

// "Warn the next cleaner": turns what was found into a warning on the
// site's job page (0135). Saved straight away, apart from the follow-up,
// because it is about the building rather than this report.
function SiteWarning({ report, properties, warnings, onAdded, onFixed }) {
  const toast = useToast();
  const [propertyId, setPropertyId] = useState(report.jobs?.property_id || '');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const mine = warnings.filter((w) => w.incident_id === report.id);

  const add = async () => {
    if (!propertyId) { toast.error('Choose the site to warn.'); return; }
    if (!text.trim()) { toast.error('Write the warning the cleaner will see.'); return; }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('site_hazards')
      .insert({ property_id: propertyId, hazard: text.trim(), incident_id: report.id, created_by: session?.user?.id || null })
      .select(HAZARD_COLUMNS).single();
    setSaving(false);
    if (error || !data) { toast.error("Couldn't add the warning. If this is the first time, the 0135 database update may not have been run yet."); return; }
    setText('');
    toast.success('Warning added. Staff will see it on every job at that site until you mark it fixed.');
    onAdded(data);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Warn the next cleaner</h3>
      <p style={helpStyle}>
        If the danger is still there, add a warning to the site. Everyone sent to a job there sees it on the job page until
        you mark it fixed. Describe the danger, not the person: staff can read this.
      </p>
      {mine.map((w) => (
        <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', background: 'var(--wf-overdue-tint)', borderRadius: 8, padding: '8px 10px', marginBottom: 8, fontSize: 13.5 }}>
          <span><strong>{placeLabel(w.properties)}:</strong> {w.hazard}</span>
          <button type="button" className="btn-secondary" onClick={() => onFixed(w)} title="The danger has gone - stop showing this warning">Fixed</button>
        </div>
      ))}
      <div style={gridStyle}>
        <Field label="Site">
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Choose a site...</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{placeLabel(p)}</option>)}
          </select>
        </Field>
      </div>
      <label>The warning</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. Loose stair rod on the top landing - use the back stairs until it is fixed" style={textareaStyle} />
      <button type="button" className="btn-secondary" disabled={saving} onClick={add}>{saving ? 'Adding...' : 'Add the warning'}</button>
    </div>
  );
}

function FollowUp({ report, staffNames, company, siteWarningCount, onSaved, children }) {
  const toast = useToast();
  const [f, setF] = useState(() => followUpFrom(report));
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((prev) => ({ ...prev, [field]: value }));
  };
  const answer = (key) => (value) => setF((prev) => ({ ...prev, answers: { ...prev.answers, [key]: value } }));

  const today = londonDate(new Date());
  const draft = draftOf(report, f, today);
  const injured = wasInjured(report);
  const accident = report.kind === 'accident';
  const items = todoList({ ...draft, site_warning_count: siteWarningCount }, today);
  const questions = hseQuestions(draft);
  const outcome = hseOutcome(draft, today);
  const notes = hseNotes(draft);
  const reportable = isReportableCategory(draft.riddor_category);
  const days = daysOffWork(draft, today);
  const gaps = accidentBookGaps(report);
  const closed = report.status === 'closed';

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(hseSummary(draft, company, today));
      toast.success("Copied. Open HSE's form and copy each answer across.");
    } catch {
      toast.error("Couldn't copy - your browser blocked it.");
    }
  };

  const save = async (nextStatus) => {
    if (nextStatus === 'closed') {
      const problems = closeProblems(draft, today);
      if (problems.length > 0) { toast.error(`Not ready to close yet: ${problems.join('; ')}.`); return; }
    }
    if (draft.back_at_work_on && draft.back_at_work_on <= londonDate(report.occurred_at)) {
      toast.error('The day they went back must be after the day it happened.');
      return;
    }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const now = new Date().toISOString();
    const update = {
      status: nextStatus,
      severity: draft.severity,
      root_cause: draft.root_cause,
      corrective_action: draft.corrective_action,
      risk_assessment_reviewed_on: draft.risk_assessment_reviewed_on,
      insurer_notified_on: draft.insurer_notified_on,
      client_notified_on: draft.client_notified_on,
      riddor_category: draft.riddor_category,
      riddor_reported_on: draft.riddor_reported_on,
      riddor_reference: draft.riddor_reference,
      reviewed_by: session?.user?.id || null,
      reviewed_at: now,
      closed_at: nextStatus === 'closed' ? report.closed_at || now : null,
    };
    if (accident) update.accident_kind = draft.accident_kind;
    if (injured) {
      Object.assign(update, {
        injured_status: draft.injured_status,
        body_part: draft.body_part,
        off_work: draft.off_work,
        back_at_work_on: draft.back_at_work_on,
      });
      if (!report.injured_address && draft.injured_address) update.injured_address = draft.injured_address;
      if (!report.injured_occupation && draft.injured_occupation) update.injured_occupation = draft.injured_occupation;
    }
    const { data, error } = await supabase.from('incident_reports').update(update).eq('id', report.id).select(COLUMNS).single();
    setSaving(false);
    if (error || !data) { toast.error("Couldn't save. Try again in a moment."); return; }
    toast.success(nextStatus === 'closed' && !closed
      ? 'Report closed. The person who reported it has been told.'
      : nextStatus === 'investigating' && closed ? 'Report reopened.' : 'Saved.');
    onSaved(data);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(closed ? 'closed' : 'investigating'); }} style={sectionStyle}>
      <Checklist items={items} />

      {injured && (
        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>1. The person who was hurt</h3>
          <p style={helpStyle}>The accident book has to hold their name, address and job.</p>
          {gaps.length > 0 && (
            <div style={gridStyle}>
              {!report.injured_address && (
                <Field label="Their address">
                  <input value={f.injured_address} onChange={set('injured_address')} placeholder='or "Not given" if they would not say' />
                </Field>
              )}
              {!report.injured_occupation && (
                <Field label="Their job">
                  <input value={f.injured_occupation} onChange={set('injured_occupation')} placeholder='e.g. Cleaning Operative, Retired' />
                </Field>
              )}
            </div>
          )}
          {gaps.length > 0 && <p style={helpStyle}>Once saved, these can't be changed - the accident book has to stay as written.</p>}
          <div style={gridStyle}>
            <Field label="Do they work for you?">
              <select value={f.injured_status} onChange={set('injured_status')}>
                <option value="">Choose...</option>
                {Object.entries(INJURED_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Part of the body hurt">
              <input value={f.body_part} onChange={set('body_part')} placeholder="e.g. Left wrist" />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 14 }}>
            <input type="checkbox" checked={f.off_work} onChange={set('off_work')} style={{ width: 'auto' }} />
            They had time off work, or couldn't do their normal job, because of it
          </label>
          {f.off_work && (
            <div style={gridStyle}>
              <Field label="Back to normal work on (leave blank if still off)">
                <input type="date" value={f.back_at_work_on} min={addDays(londonDate(report.occurred_at), 1)} onChange={set('back_at_work_on')} />
              </Field>
              <div style={{ alignSelf: 'center', fontSize: 13.5, paddingTop: 12 }}>
                <strong>{days} day{days === 1 ? '' : 's'} off{f.back_at_work_on ? '' : ' so far'}.</strong> The day it happened doesn't count; weekends do.
              </div>
            </div>
          )}
        </div>
      )}

      {questions.length > 0 && (
        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{injured ? '2. ' : ''}Does HSE need to know?</h3>
          <p style={helpStyle}>
            By law (RIDDOR), some accidents and dangerous events must be reported to the Health and Safety Executive.
            Answer these and the app tells you whether this one does.
          </p>
          {questions.map((q) => (
            <div key={q.key}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{q.text}</div>
              {q.list && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {q.list.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              <YesNo name={`${report.id}-${q.key}`} value={f.answers[q.key]} onChange={answer(q.key)} />
            </div>
          ))}
          {outcome && (
            <div role={outcome.tone === 'urgent' ? 'alert' : undefined} style={{ ...TONE_STYLE[outcome.tone], borderRadius: 8, padding: '10px 12px', fontSize: 14, marginBottom: 10 }}>
              {outcome.text}
            </div>
          )}
          {notes.map((n) => <p key={n} style={{ fontSize: 13, margin: '0 0 8px' }}>{n}</p>)}

          {reportable && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13.5, margin: '0 0 10px' }}>
                <a href="https://www.hse.gov.uk/riddor/report.htm" target="_blank" rel="noreferrer" style={{ color: 'var(--brand-link)', fontWeight: 600 }}>
                  Open HSE's report form
                </a>
                <button type="button" className="btn-secondary" onClick={copySummary} title="Copy the details in the order HSE's form asks for them">
                  <Copy size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Copy the details to paste in
                </button>
              </div>
              <div style={gridStyle}>
                {accident && (
                  <Field label="Kind of accident (HSE asks this)">
                    <select value={f.accident_kind} onChange={set('accident_kind')}>
                      <option value="">Choose...</option>
                      {Object.entries(ACCIDENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Date you reported it">
                  <input type="date" value={f.riddor_reported_on} max={today} onChange={set('riddor_reported_on')} />
                </Field>
                <Field label="Reference number HSE gave you">
                  <input value={f.riddor_reference} onChange={set('riddor_reference')} />
                </Field>
              </div>
            </>
          )}
        </div>
      )}

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{injured ? '3. ' : ''}Putting it right</h3>
        <div style={gridStyle}>
          <Field label="How serious was it?">
            <select value={f.severity} onChange={set('severity')}>
              <option value="">Choose...</option>
              {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Risk assessment looked at again on">
            <input type="date" value={f.risk_assessment_reviewed_on} max={today} onChange={set('risk_assessment_reviewed_on')} />
          </Field>
        </div>
        <label>What caused it?</label>
        <textarea value={f.root_cause} onChange={set('root_cause')} rows={2} placeholder="e.g. Floor still wet, no sign out; trainers with worn soles" style={textareaStyle} />
        <label>What have you done so it doesn't happen again?</label>
        <textarea
          value={f.corrective_action}
          onChange={set('corrective_action')}
          rows={2}
          placeholder="e.g. Wet floor signs added to every van kit; spoke to the client about the stair carpet"
          style={textareaStyle}
        />
        <p style={{ ...helpStyle, marginTop: -4 }}>The person who reported it sees this when you close the report.</p>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{injured ? '4. ' : ''}Who you've told</h3>
        <p style={helpStyle}>Put the date you told them. Leave blank if you haven't, or don't need to.</p>
        <div style={gridStyle}>
          <Field label="Your insurer">
            <input type="date" value={f.insurer_notified_on} max={today} onChange={set('insurer_notified_on')} />
          </Field>
          {report.job_id && (
            <Field label="The client">
              <input type="date" value={f.client_notified_on} max={today} onChange={set('client_notified_on')} />
            </Field>
          )}
        </div>
      </div>

      {children}

      {report.reviewed_at && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '12px 0 10px' }}>
          Last updated {formatWhen(report.reviewed_at)}{staffNames[report.reviewed_by] ? ` by ${staffNames[report.reviewed_by]}` : ''}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        {!closed && (
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => save('closed')} title="Close the report once everything on the list is done">
            Save and close
          </button>
        )}
        {closed && (
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => save('investigating')} title="Open the report again to add to it">
            Reopen
          </button>
        )}
      </div>
    </form>
  );
}

function HseBadge({ report, today }) {
  const r = riddorState(report, today);
  if (r.state === 'overdue') return <span className="badge missed">HSE report overdue</span>;
  if (r.state === 'due') return <span className="badge missed">{r.due ? `Report to HSE by ${formatDay(r.due).replace(/ \d{4}$/, '')}` : 'Report to HSE'}</span>;
  if (r.state === 'decide') return <span className="badge missed">Check if HSE needs to know</span>;
  if (r.state === 'reported') return <span className="badge in_progress">Reported to HSE</span>;
  return null;
}

export default function AdminIncidents() {
  const router = useRouter();
  const toast = useToast();
  const [userId, setUserId] = useState(null);
  const [reports, setReports] = useState([]);
  const [staffNames, setStaffNames] = useState({});
  const [company, setCompany] = useState(() => companyFromSettings(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('active');
  const [kind, setKind] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [adding, setAdding] = useState(0); // >0 while the add form is open; remounts it fresh
  const [properties, setProperties] = useState([]);
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { session, profile } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }
    // Admins only (0131): the layout hides the link from supervisors, and
    // the database would return nothing anyway; this sends them home.
    if (profile?.role !== 'admin') { router.push('/admin'); return; }
    setUserId(session.user.id);

    const [{ data, error }, { data: office }, { data: settings }, { data: places }, { data: hazards }] = await Promise.all([
      supabase.from('incident_reports').select(COLUMNS).order('occurred_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']),
      supabase.from('company_settings').select('*').limit(1).maybeSingle(),
      supabase.from('properties').select('id, address, clients(name)').order('address'),
      // Fails quietly until 0135 is run: the reports still load.
      supabase.from('site_hazards').select(HAZARD_COLUMNS).is('resolved_at', null).order('created_at', { ascending: false }),
    ]);
    setCompany(companyFromSettings(settings));
    setProperties(places || []);
    setWarnings(hazards || []);
    if (error) { setLoadError(true); setLoading(false); return; }
    setReports(data || []);
    setStaffNames(Object.fromEntries((office || []).map((p) => [p.id, p.full_name])));
    setLoading(false);

    // A bell notification opens the list; ?id= opens straight onto one.
    const id = new URLSearchParams(window.location.search).get('id');
    if (id && (data || []).some((r) => r.id === id)) openReport((data || []).find((r) => r.id === id));
  };

  const openReport = async (report) => {
    const next = openId === report.id ? null : report.id;
    setOpenId(next);
    if (!next || photoUrls[report.id] || (report.photo_paths || []).length === 0) return;
    const urls = await Promise.all(report.photo_paths.map(async (path) => {
      const { data } = await supabase.storage.from('incident-photos').createSignedUrl(path, 3600);
      return data?.signedUrl || null;
    }));
    setPhotoUrls((prev) => ({ ...prev, [report.id]: urls }));
  };

  const today = londonDate(new Date());

  const shown = useMemo(() => reports.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (filter === 'active') return r.status !== 'closed';
    if (filter === 'closed') return r.status === 'closed';
    return true;
  }), [reports, filter, kind]);

  const counts = useMemo(() => {
    const yearAgo = Date.now() - 365 * 24 * 3600000;
    const lastYear = reports.filter((r) => new Date(r.occurred_at).getTime() >= yearAgo);
    return {
      open: reports.filter((r) => r.status !== 'closed').length,
      hse: reports.filter((r) => ['decide', 'due', 'overdue'].includes(riddorState(r, today).state)).length,
      accidents: lastYear.filter((r) => r.kind === 'accident').length,
      incidents: lastYear.filter((r) => r.kind === 'incident').length,
      nearMisses: lastYear.filter((r) => r.kind === 'near_miss').length,
    };
  }, [reports, today]);

  const markFixed = async (warning) => {
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('site_hazards')
      .update({ resolved_at: new Date().toISOString(), resolved_by: session?.user?.id || null })
      .eq('id', warning.id);
    if (error) { toast.error("Couldn't update the warning."); return; }
    setWarnings((prev) => prev.filter((w) => w.id !== warning.id));
    toast.success('Marked fixed. Staff no longer see it.');
  };

  const exportCsv = () => {
    downloadCSV(`accidents-incidents-near-misses-${localDateString(new Date())}.csv`, toCSV(CSV_COLUMNS, shown.map((r) => csvRow(r, today))));
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <BackButton />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Accidents &amp; incidents</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0, maxWidth: 640 }}>
            Your accident book. Staff report from their phones, or you can add one yourself. Open a report to see
            what's left to do - the list tells you, including whether HSE needs to know. Reports are kept for at least
            three years and can't be deleted or changed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setAdding((n) => n + 1)} title="Add a report someone told you about, or one from the paper accident book">
            <Plus size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Add a report
          </button>
          <button type="button" className="btn-secondary" onClick={exportCsv} disabled={shown.length === 0} title="Download the reports shown below as a spreadsheet">
            <Download size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Download
          </button>
        </div>
      </div>

      {loadError && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>Couldn't load the reports. If this is the first time since an update, the 0131 database update may not have been run yet.</p>
        </div>
      )}

      {adding > 0 && userId && (
        <div style={{ marginTop: 16 }}>
          <IncidentForm
            key={adding}
            userId={userId}
            office
            columns={COLUMNS}
            onCancel={() => setAdding(0)}
            onSaved={(row) => {
              setAdding(0);
              setReports((prev) => [row, ...prev].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)));
              setOpenId(row.id);
            }}
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, margin: '16px 0' }}>
        {[
          ['Still open', counts.open],
          ['Need an HSE decision or report', counts.hse],
          ['Accidents, last 12 months', counts.accidents],
          ['Incidents, last 12 months', counts.incidents],
          ['Near misses, last 12 months', counts.nearMisses],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ margin: 0, padding: '12px 14px' }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--wf-data)' }}>{value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="card">
          <h2 style={{ margin: '0 0 4px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={16} /> Site warnings staff can see
          </h2>
          <p style={{ ...helpStyle, marginBottom: 8 }}>Shown on every job at these sites. Mark one fixed once the danger has gone.</p>
          {warnings.map((w) => (
            <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', borderTop: '1px solid var(--hairline)', padding: '8px 0', fontSize: 13.5 }}>
              <span>
                <strong>{placeLabel(w.properties)}:</strong> {w.hazard}
                <span style={{ color: 'var(--muted)' }}> · added {new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </span>
              <button type="button" className="btn-secondary" onClick={() => markFixed(w)} title="The danger has gone - stop showing this warning">Fixed</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={filter === f.key ? '' : 'btn-secondary'} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto', marginLeft: 'auto', marginBottom: 0 }} aria-label="Type of report">
          <option value="all">Every type</option>
          <option value="accident">Accidents only</option>
          <option value="incident">Incidents only</option>
          <option value="near_miss">Near misses only</option>
        </select>
      </div>

      {shown.length === 0 && !loadError && (
        <div className="card"><p style={{ margin: 0, color: 'var(--muted)' }}>Nothing to show here.</p></div>
      )}

      {shown.map((r) => {
        const left = todoList(r, today).filter((i) => i.required && !i.done).length;
        return (
          <div key={r.id} className="card">
            <button
              type="button"
              onClick={() => openReport(r)}
              title={openId === r.id ? 'Hide the details' : 'Open the report and see what is left to do'}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', width: '100%' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{KIND_LABELS[r.kind]}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{formatWhen(r.occurred_at)}</span>
                  {r.treatment === 'hospital' && <span className="badge missed">Hospital</span>}
                  <HseBadge report={r} today={today} />
                </div>
                <div style={{ fontSize: 13.5, marginTop: 2 }}>{r.location}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {incidentSummary(r)} · reported by {r.reporter?.full_name || 'unknown'}
                  {r.status !== 'closed' && left > 0 ? ` · ${left} thing${left === 1 ? '' : 's'} to do` : ''}
                </div>
              </div>
              <span className={`badge ${STATUS_BADGE_CLASS[r.status]}`} style={{ alignSelf: 'flex-start' }}>{STATUS_LABELS[r.status]}</span>
            </button>

            {openId === r.id && (
              <div style={{ marginTop: 14 }}>
                <IncidentDetails report={r} photoUrls={photoUrls[r.id] || []} />
                <FollowUp
                  key={r.reviewed_at || r.id}
                  report={r}
                  staffNames={staffNames}
                  company={company}
                  siteWarningCount={warnings.filter((w) => w.incident_id === r.id).length}
                  onSaved={(updated) => setReports((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                >
                  <SiteWarning
                    report={r}
                    properties={properties}
                    warnings={warnings}
                    onAdded={(w) => setWarnings((prev) => [w, ...prev])}
                    onFixed={markFixed}
                  />
                </FollowUp>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
