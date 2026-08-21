'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Square } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { REPORT_TEMPLATES, DEFAULT_TEMPLATE } from '../../../lib/reportTemplates';
import BackButton from '../../components/BackButton';

export default function AdminReports() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobPhotos, setJobPhotos] = useState([]);
  const [editingReport, setEditingReport] = useState(false);
  const [notes, setNotes] = useState('');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address), job_reports(id, summary, issues, suggestions, input_notes, template, created_at, visible_to_client)')
      .order('scheduled_at', { ascending: false })
      .limit(100);

    setJobs(data || []);
    setLoading(false);
  };

  const reportFor = (job) => (Array.isArray(job.job_reports) ? job.job_reports[0] : job.job_reports) || null;

  const toggleExpand = async (job) => {
    const isOpen = expandedJobId === job.id;
    const existing = reportFor(job);
    setExpandedJobId(isOpen ? null : job.id);
    setEditingReport(false);
    setNotes(isOpen ? '' : existing?.input_notes || '');
    setTemplate(isOpen ? DEFAULT_TEMPLATE : existing?.template || DEFAULT_TEMPLATE);
    setError('');
    setJobPhotos([]);

    if (!isOpen) {
      const { data } = await supabase
        .from('photos')
        .select('id, url, caption')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });

      // photos.url stores the job-photos storage path, not a public URL -
      // the bucket is private, so each photo needs a freshly signed URL.
      const withUrls = await Promise.all(
        (data || []).map(async (p) => {
          const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
          return { ...p, signedUrl: signed?.signedUrl };
        })
      );
      setJobPhotos(withUrls);
    }
  };

  const generateReport = async (jobId) => {
    setGenerating(true);
    setError('');

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ job_id: jobId, notes, template }),
    });

    setGenerating(false);
    if (res.ok) {
      const report = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, job_reports: [report] } : j)));
      setEditingReport(false);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.detail || body.error || 'Something went wrong generating the report.');
    }
  };

  const toggleClientVisibility = async (job, report, visible) => {
    const { error } = await supabase.from('job_reports').update({ visible_to_client: visible }).eq('id', report.id);
    if (error) return;
    setJobs((prev) => prev.map((j) => (
      j.id === job.id ? { ...j, job_reports: [{ ...report, visible_to_client: visible }] } : j
    )));
  };

  const toggleRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser (try Chrome).');
      return;
    }

    if (recording) {
      window.__wfRecognition?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-GB';

    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setNotes((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setRecording(false);
    recognition.onerror = () => setRecording(false);

    window.__wfRecognition = recognition;
    recognition.start();
    setRecording(true);
  };

  const filteredJobs = jobs.filter((j) =>
    !search.trim() || (j.properties?.address || '').toLowerCase().includes(search.trim().toLowerCase())
  );

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">AI-generated job reports — visible to admins only</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address..."
          style={{ marginBottom: 0 }}
        />
      </div>

      {filteredJobs.length === 0 && <p className="empty-state">No jobs found.</p>}

      <div className="job-list">
        {filteredJobs.map((job) => {
          const report = reportFor(job);
          const isExpanded = expandedJobId === job.id;

          return (
            <div key={job.id} className="card">
              <div className="page-header-row" style={{ marginBottom: isExpanded ? 12 : 0 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{job.properties?.address}</h2>
                  <p className="job-time">{new Date(job.scheduled_at).toLocaleString()}</p>
                  <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                  {report && <span className="badge completed" style={{ marginLeft: 6 }}>report ready</span>}
                </div>
                <button className="btn-secondary" onClick={() => toggleExpand(job)} title="Show or hide the report and notes for this job">
                  {isExpanded ? 'Close' : report ? 'View Report' : 'Generate Report'}
                </button>
              </div>

              {isExpanded && jobPhotos.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Photos
                  </strong>
                  <div className="photo-grid">
                    {jobPhotos.map((p) => (
                      <img
                        key={p.id}
                        src={p.signedUrl}
                        alt={p.caption || 'job photo'}
                        onClick={() => window.open(p.signedUrl, '_blank', 'noopener,noreferrer')}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && (
                report && !editingReport ? (
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                    <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px', fontWeight: 600 }}>
                      Template: {REPORT_TEMPLATES[report.template]?.label || REPORT_TEMPLATES[DEFAULT_TEMPLATE].label}
                    </p>
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {(REPORT_TEMPLATES[report.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels.summary}
                      </strong>
                      <p style={{ margin: '4px 0 0' }}>{report.summary}</p>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {(REPORT_TEMPLATES[report.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels.issues}
                      </strong>
                      <p style={{ margin: '4px 0 0' }}>{report.issues}</p>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <strong style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {(REPORT_TEMPLATES[report.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels.suggestions}
                      </strong>
                      <p style={{ margin: '4px 0 0' }}>{report.suggestions}</p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 13.5, margin: '12px 0' }}>
                      <input
                        type="checkbox"
                        checked={!!report.visible_to_client}
                        onChange={(e) => toggleClientVisibility(job, report, e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      Add to client portal
                    </label>
                    <button className="btn-secondary" onClick={() => setEditingReport(true)} title="Write it again from new notes - the current report is replaced">
                      Regenerate
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="empty-state" style={{ padding: '4px 0' }}>
                      Add a few notes (or speak them), pick a template, and generate a report from those notes and the job's photos.
                    </p>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label className="field-label">Template</label>
                      <select value={template} onChange={(e) => setTemplate(e.target.value)} style={{ marginBottom: 0 }}>
                        {Object.entries(REPORT_TEMPLATES).map(([id, t]) => (
                          <option key={id} value={id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Deep cleaned kitchen and bathrooms, noticed a leak under the sink..."
                      rows={4}
                      style={{
                        width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                        background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={toggleRecording}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        title="Dictate your notes instead of typing them"
                      >
                        {recording ? <Square size={14} /> : <Mic size={14} />}
                        {recording ? 'Stop' : 'Speak notes'}
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => generateReport(job.id)}
                        disabled={generating}
                        style={{ flex: 1 }}
                        title="Write a report from your notes and the job's photos"
                      >
                        {generating ? 'Generating...' : report ? 'Regenerate Report' : 'Generate Report'}
                      </button>
                    </div>
                    {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, marginTop: 8 }}>{error}</p>}
                  </>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
