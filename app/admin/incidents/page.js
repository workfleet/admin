'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { toCSV, downloadCSV } from '../../../lib/csv';
import { localDateString } from '../../../lib/localDate';
import {
  KIND_LABELS, STATUS_LABELS, STATUS_BADGE_CLASS, SEVERITY_LABELS,
  riddorPrompts, needsRiddorDecision, incidentSummary, CSV_COLUMNS, csvRow,
} from '../../../lib/incidents';
import IncidentDetails, { formatWhen } from '../../components/IncidentDetails';
import BackButton from '../../components/BackButton';
import { useToast } from '../../components/ToastProvider';

// The embed is hinted even though reported_by is the table's only FK to
// profiles today - a second one added later would otherwise take this page
// down with PGRST201 (0094/0095).
const COLUMNS = 'id, kind, occurred_at, location, description, injured_party, injured_name, injury_details, treatment, damage_details, immediate_action, witnesses, photo_paths, status, severity, riddor_reportable, riddor_reference, days_off_work, root_cause, corrective_action, reviewed_by, reviewed_at, closed_at, created_at, reported_by, reporter:profiles!incident_reports_reported_by_fkey(full_name), jobs(scheduled_at, properties(address))';

const FILTERS = [
  { key: 'active', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
  background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
};

function followUpFrom(report) {
  return {
    status: report.status,
    severity: report.severity || '',
    days_off_work: report.days_off_work ?? '',
    riddor: report.riddor_reportable === null ? '' : report.riddor_reportable ? 'yes' : 'no',
    riddor_reference: report.riddor_reference || '',
    root_cause: report.root_cause || '',
    corrective_action: report.corrective_action || '',
  };
}

function FollowUp({ report, staffNames, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => followUpFrom(report));
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setF((prev) => ({ ...prev, [field]: e.target.value }));

  // Prompts read the days off as typed, so the over-7-day deadline appears
  // the moment someone enters 8 - before they save.
  const days = f.days_off_work === '' ? null : Number(f.days_off_work);
  const prompts = riddorPrompts({ ...report, days_off_work: days });

  const save = async (e) => {
    e.preventDefault();
    if (days !== null && (!Number.isInteger(days) || days < 0)) { toast.error('Days off work must be a whole number.'); return; }
    if (f.status === 'closed' && !f.corrective_action.trim()) {
      toast.error('Say what was done about it before closing the report.');
      return;
    }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const now = new Date().toISOString();
    const update = {
      status: f.status,
      severity: f.severity || null,
      days_off_work: days,
      riddor_reportable: f.riddor === '' ? null : f.riddor === 'yes',
      riddor_reference: f.riddor === 'yes' ? f.riddor_reference.trim() || null : null,
      root_cause: f.root_cause.trim() || null,
      corrective_action: f.corrective_action.trim() || null,
      reviewed_by: session?.user?.id || null,
      reviewed_at: now,
      closed_at: f.status === 'closed' ? report.closed_at || now : null,
    };
    const { data, error } = await supabase.from('incident_reports').update(update).eq('id', report.id).select(COLUMNS).single();
    setSaving(false);
    if (error || !data) { toast.error("Couldn't save the follow-up."); return; }
    toast.success(f.status === 'closed' && report.status !== 'closed' ? 'Report closed - the person who reported it has been told.' : 'Follow-up saved.');
    onSaved(data);
  };

  return (
    <form onSubmit={save} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12, marginTop: 4 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Office follow-up</h3>

      {prompts.length > 0 && (
        <div style={{ background: 'var(--wf-overdue-tint)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={15} /> Check whether this is RIDDOR reportable
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {prompts.map((p) => <li key={p.key} style={{ marginBottom: 4 }}>{p.text}</li>)}
          </ul>
          <a href="https://www.hse.gov.uk/riddor/" target="_blank" rel="noreferrer" style={{ color: 'var(--brand-link)', fontWeight: 600 }}>
            HSE RIDDOR guidance and reporting
          </a>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 12px' }}>
        <div>
          <label>Status</label>
          <select value={f.status} onChange={set('status')}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label>Severity</label>
          <select value={f.severity} onChange={set('severity')}>
            <option value="">Not set</option>
            {Object.entries(SEVERITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {report.kind === 'accident' && (
          <div>
            <label>Days off work</label>
            <input type="number" min="0" step="1" inputMode="numeric" value={f.days_off_work} onChange={set('days_off_work')} placeholder="Not known" />
          </div>
        )}
        <div>
          <label>RIDDOR reportable?</label>
          <select value={f.riddor} onChange={set('riddor')}>
            <option value="">Not decided</option>
            <option value="no">No</option>
            <option value="yes">Yes - reported to HSE</option>
          </select>
        </div>
      </div>
      {f.riddor === 'yes' && (
        <>
          <label>HSE reference number</label>
          <input value={f.riddor_reference} onChange={set('riddor_reference')} />
        </>
      )}

      <label>What caused it?</label>
      <textarea value={f.root_cause} onChange={set('root_cause')} rows={2} style={textareaStyle} />

      <label>What we did or changed {f.status === 'closed' ? '' : '(needed to close)'}</label>
      <textarea
        value={f.corrective_action}
        onChange={set('corrective_action')}
        rows={2}
        placeholder="e.g. Wet floor signs added to every van kit; spoke to the client about the stair carpet"
        style={textareaStyle}
      />
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
        The person who reported it sees this line when the report is closed.
      </p>

      {report.reviewed_at && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          Last updated {formatWhen(report.reviewed_at)}{staffNames[report.reviewed_by] ? ` by ${staffNames[report.reviewed_by]}` : ''}
        </p>
      )}
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save follow-up'}</button>
    </form>
  );
}

export default function AdminIncidents() {
  const router = useRouter();
  const [reports, setReports] = useState([]);
  const [staffNames, setStaffNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('active');
  const [kind, setKind] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const [{ data, error }, { data: office }] = await Promise.all([
      supabase.from('incident_reports').select(COLUMNS).order('occurred_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']),
    ]);
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
      riddor: reports.filter(needsRiddorDecision).length,
      accidents: lastYear.filter((r) => r.kind === 'accident').length,
      nearMisses: lastYear.filter((r) => r.kind === 'near_miss').length,
    };
  }, [reports]);

  const exportCsv = () => {
    downloadCSV(`accidents-and-near-misses-${localDateString(new Date())}.csv`, toCSV(CSV_COLUMNS, shown.map(csvRow)));
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <BackButton />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Accidents &amp; near misses</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
            The accident book. Staff report from the app; follow each one up here. Reports cannot be deleted.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={exportCsv} disabled={shown.length === 0} title="Download the reports shown below as a spreadsheet">
          <Download size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Export CSV
        </button>
      </div>

      {loadError && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>Couldn't load the reports. If this is the first time, the 0117 database update may not have been run yet.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '16px 0' }}>
        {[
          ['Open', counts.open],
          ['RIDDOR to decide', counts.riddor],
          ['Accidents, last 12 months', counts.accidents],
          ['Near misses, last 12 months', counts.nearMisses],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ margin: 0, padding: '12px 14px' }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--wf-data)' }}>{value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={filter === f.key ? '' : 'btn-secondary'} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto', marginLeft: 'auto', marginBottom: 0 }} aria-label="Type of report">
          <option value="all">Accidents and near misses</option>
          <option value="accident">Accidents only</option>
          <option value="near_miss">Near misses only</option>
        </select>
      </div>

      {shown.length === 0 && !loadError && (
        <div className="card"><p style={{ margin: 0, color: 'var(--muted)' }}>Nothing to show here.</p></div>
      )}

      {shown.map((r) => (
        <div key={r.id} className="card">
          <button
            type="button"
            onClick={() => openReport(r)}
            title={openId === r.id ? 'Hide the details' : 'Show the details and follow it up'}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', width: '100%' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{KIND_LABELS[r.kind]}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{formatWhen(r.occurred_at)}</span>
                {r.treatment === 'hospital' && <span className="badge missed">Hospital</span>}
                {needsRiddorDecision(r) && <span className="badge missed">RIDDOR?</span>}
                {r.riddor_reportable && <span className="badge in_progress">RIDDOR reported</span>}
              </div>
              <div style={{ fontSize: 13.5, marginTop: 2 }}>{r.location}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {incidentSummary(r)} · reported by {r.reporter?.full_name || 'unknown'}
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
                onSaved={(updated) => setReports((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
