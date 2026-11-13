'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { assignedJob } from '../../../lib/hoursWorked';
import { TRAINING_JOB_COLUMNS } from '../../../lib/training';
import { KIND_LABELS, KIND_BUTTONS, STATUS_LABELS, STATUS_BADGE_CLASS, incidentSummary } from '../../../lib/incidents';
import IncidentDetails, { formatWhen } from '../../components/IncidentDetails';
import IncidentForm from '../../components/IncidentForm';
import BackButton from '../../components/BackButton';

const REPORT_COLUMNS = 'id, kind, incident_type, occurred_at, location, description, injured_party, injured_name, injured_address, injured_occupation, injury_details, treatment, damage_details, immediate_action, witnesses, photo_paths, status, corrective_action, closed_at, created_at, jobs(scheduled_at, properties(address))';

// Jobs from the last fortnight to now, for "which job was this on". An
// accident is usually reported the same day; a near miss someone has been
// meaning to mention can be a week or so old.
const JOB_LOOKBACK_DAYS = 14;

export default function CleanerIncidents() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [reports, setReports] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  // From their staff record, offered when they were the one hurt so the
  // accident book has it without them typing it at the scene.
  const [ownAddress, setOwnAddress] = useState('');
  // { kind, jobId, n } while the form is open; n remounts it fresh.
  const [formStart, setFormStart] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const since = new Date(Date.now() - JOB_LOOKBACK_DAYS * 24 * 3600000).toISOString();
    const [{ data: assignmentRows }, { data: reportRows }, { data: details }] = await Promise.all([
      supabase
        .from('job_assignments')
        .select(`jobs(id, scheduled_at, status, ${TRAINING_JOB_COLUMNS}, properties(address))`)
        .eq('cleaner_id', session.user.id),
      supabase
        .from('incident_reports')
        .select(REPORT_COLUMNS)
        .eq('reported_by', session.user.id)
        .order('occurred_at', { ascending: false }),
      supabase.from('staff_details').select('address').eq('profile_id', session.user.id).maybeSingle(),
    ]);
    setOwnAddress(details?.address || '');

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
    const kindParam = params.get('kind');
    const kind = KIND_LABELS[kindParam] ? kindParam : 'accident';
    if (params.get('job') || kindParam) setFormStart({ kind, jobId: params.get('job') || '', n: 1 });
  };

  const startForm = (kind) => setFormStart((prev) => ({ kind, jobId: '', n: (prev?.n || 0) + 1 }));

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

  return (
    <div className="container">
      <BackButton />
      <h1>Report a problem</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
        Tell the office about anything that hurt someone, anything that went wrong, and anything that nearly did.
        Near misses matter - they are how we stop the next accident.
      </p>

      <div className="card" style={{ borderLeft: '4px solid var(--wf-overdue)' }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          <strong>If someone is badly hurt, call 999 first.</strong> Use the emergency button if you need the office right now.
          Fill this in once everyone is safe.
        </p>
      </div>

      {!formStart && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {Object.keys(KIND_LABELS).map((k, i) => (
              <button key={k} type="button" className={i === 0 ? '' : 'btn-secondary'} onClick={() => startForm(k)}>
                {KIND_BUTTONS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {formStart && (
        <IncidentForm
          key={formStart.n}
          userId={userId}
          initialKind={formStart.kind}
          initialJobId={formStart.jobId}
          jobs={jobs}
          ownAddress={ownAddress}
          columns={REPORT_COLUMNS}
          onCancel={() => setFormStart(null)}
          onSaved={(row) => { setReports((prev) => [row, ...prev]); setFormStart(null); }}
        />
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
