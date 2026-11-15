'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, Trash2, FileText, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { companyFromSettings } from '../../../lib/companyBranding';
import { DOC_TYPES, DOC_GROUPS, docTypeLabel, fileNameFor } from '../../../lib/aiDrafting';
import { FACT_KEYS, factsMap, factsFilled } from '../../../lib/companyFacts';
import { readableKind } from '../../../lib/projectAi';
import { isOpenStatus } from '../../../lib/projects';
import DraftEditor from '../../components/DraftEditor';
import { PageSkeleton } from '../../components/Skeleton';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const MAX_FILES = 3;

// One tap fills the request box - shows new office staff what it can do.
const STARTERS = [
  'Reply to a client complaint about a missed clean',
  'Job advert for a part-time evening cleaner in Swansea',
  'Lone working policy for our cleaners',
  'Letter to a client about a price increase from April',
  'Notice to all staff about the Christmas rota',
  'Answer a tender question about quality control',
];

async function callDraft(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Please sign in again.' };
  let res;
  try {
    res = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: 'Couldn\'t reach the server - check your connection.' };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { error: res.status === 504 ? 'That took too long. Try a shorter request or fewer files.' : 'Something went wrong. Please try again.' };
  if (!res.ok) return { error: data.message || 'Something went wrong. Please try again.' };
  return { data };
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AiAssistant() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [company, setCompany] = useState(null);
  const [factsCount, setFactsCount] = useState(null); // null = 0140 not run
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [projects, setProjects] = useState([]);
  const [library, setLibrary] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [history, setHistory] = useState(null); // null = 0139 not run

  // The request
  const [request, setRequest] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [docType, setDocType] = useState(''); // '' = let the AI decide
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [docIds, setDocIds] = useState([]);
  const [fileIds, setFileIds] = useState([]);
  const [sourceText, setSourceText] = useState('');

  // step: 'ask' -> 'questions' -> 'draft'
  const [step, setStep] = useState('ask');
  const [plan, setPlan] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [change, setChange] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [settingsRes, factsRes, clientsRes, propsRes, projectsRes, libraryRes, historyRes] = await Promise.all([
      supabase.from('company_settings').select('*').limit(1).maybeSingle(),
      supabase.from('company_facts').select('key, value'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('properties').select('id, client_id, address').order('address'),
      supabase.from('projects').select('id, name, status, client_id, ai_enabled').order('updated_at', { ascending: false }),
      supabase.from('company_documents').select('id, title, file_name').is('client_id', null).order('title'),
      supabase.from('ai_drafts').select('id, doc_type, title, created_at, client_id, project_id').order('created_at', { ascending: false }).limit(30),
    ]);

    setCompany(companyFromSettings(settingsRes.data));
    setFactsCount(factsRes.error ? null : factsFilled(factsMap(factsRes.data)));
    setClients(clientsRes.data || []);
    setProperties(propsRes.data || []);
    setProjects((projectsRes.data || []).filter((p) => isOpenStatus(p.status)));
    setLibrary((libraryRes.data || []).filter((d) => readableKind(d.file_name)));
    setHistory(historyRes.error ? null : historyRes.data || []);

    // Arriving from a client or project page: ?client=...&project=...&type=...
    const params = new URLSearchParams(window.location.search);
    if (params.get('client')) { setClientId(params.get('client')); setShowOptions(true); }
    if (params.get('project')) { setProjectId(params.get('project')); setShowOptions(true); }
    if (params.get('type') && DOC_TYPES.some((t) => t.value === params.get('type'))) setDocType(params.get('type'));
    setLoading(false);
  };

  useEffect(() => {
    setFileIds([]);
    if (!projectId) { setProjectFiles([]); return; }
    supabase.from('project_files').select('id, file_name').eq('project_id', projectId).order('created_at', { ascending: false })
      .then(({ data }) => setProjectFiles((data || []).filter((f) => readableKind(f.file_name))));
    const project = projects.find((p) => p.id === projectId);
    if (project?.client_id && !clientId) setClientId(project.client_id);
  }, [projectId]);

  const siteOptions = properties.filter((p) => p.client_id === clientId);
  const fileCount = docIds.length + fileIds.length;
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const toggle = (setter, list, id) => {
    if (list.includes(id)) setter(list.filter((x) => x !== id));
    else if (fileCount < MAX_FILES) setter([...list, id]);
  };

  const context = (overrides = {}) => ({
    instruction: request,
    client_id: clientId || null,
    property_id: propertyId || null,
    project_id: projectId || null,
    document_ids: docIds,
    project_file_ids: fileIds,
    source_text: sourceText,
    ...overrides,
  });

  const addToHistory = (data, type, cid) => {
    if (data.id && history) {
      setHistory((h) => [{ id: data.id, doc_type: type, title: data.title, created_at: new Date().toISOString(), client_id: cid || null, project_id: projectId || null }, ...h]);
    }
  };

  const writeDraft = async (p, given) => {
    setBusy('Writing the draft... (up to a minute)'); setError('');
    const type = p?.doc_type || docType || 'free';
    const cid = p?.client_id || clientId || null;
    const { data, error: err } = await callDraft(context({
      mode: 'draft', doc_type: type, client_id: cid,
      questions: p?.questions || [], answers: given || [],
    }));
    setBusy('');
    if (err) { setError(err); return; }
    setResult({ ...data, docType: type, clientId: cid, questions: p?.questions || [], answers: given || [] });
    setStep('draft');
    addToHistory(data, type, cid);
  };

  // Step 1: work out what's wanted and what to ask.
  const start = async (e) => {
    e?.preventDefault();
    if (!request.trim()) return;
    setBusy('Reading your request...'); setError(''); setResult(null);
    const { data, error: err } = await callDraft(context({ mode: 'plan', doc_type: docType || 'free' }));
    setBusy('');
    if (err) { setError(err); return; }
    const p = { ...data, doc_type: docType || data.doc_type, client_id: clientId || data.client_id };
    setPlan(p);
    setAnswers(p.questions.map(() => ''));
    if (p.client_id && !clientId) setClientId(p.client_id);
    if (p.questions.length === 0) { await writeDraft(p, []); return; }
    setStep('questions');
  };

  const saveEdits = async (body) => {
    setResult((r) => ({ ...r, draft: body }));
    if (result?.id && history) {
      const { error: err } = await supabase.from('ai_drafts').update({ draft: body }).eq('id', result.id);
      if (err) toast.error('Your change is on screen but couldn\'t be saved.');
    }
  };

  const revise = async (e) => {
    e.preventDefault();
    if (!change.trim() || !result) return;
    setBusy('Rewriting...'); setError('');
    const { data, error: err } = await callDraft(context({
      mode: 'draft', doc_type: result.docType, client_id: result.clientId,
      questions: result.questions, answers: result.answers,
      previous_draft: result.draft, change_request: change.trim(), revised_from: result.id,
    }));
    setBusy('');
    if (err) { setError(err); return; }
    setResult((r) => ({ ...r, ...data }));
    setChange('');
    addToHistory(data, result.docType, result.clientId);
  };

  const download = async (body) => {
    try {
      const { downloadDraftDocx } = await import('../../../lib/draftDocx');
      await downloadDraftDocx(body, company, fileNameFor(result?.title));
    } catch {
      toast.error('Couldn\'t make the Word file.');
    }
  };

  const openDraft = async (row) => {
    const { data, error: err } = await supabase.from('ai_drafts').select('id, title, draft, doc_type, client_id').eq('id', row.id).single();
    if (err || !data) { toast.error('Couldn\'t open that draft.'); return; }
    setResult({ id: data.id, title: data.title, draft: data.draft, docType: data.doc_type, clientId: data.client_id, questions: [], answers: [] });
    setStep('draft');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteDraft = async (row) => {
    if (!(await confirm(`Delete the saved draft "${row.title}"?`, { danger: true }))) return;
    const { error: err } = await supabase.from('ai_drafts').delete().eq('id', row.id);
    if (err) { toast.error('Couldn\'t delete it.'); return; }
    setHistory((h) => h.filter((x) => x.id !== row.id));
    if (result?.id === row.id) { setResult(null); setStep('ask'); }
  };

  const saveToProject = async () => {
    const { error: err } = await supabase.from('project_notes').insert({
      project_id: projectId, kind: 'note', created_by: userId,
      body: `AI draft (checked by the office before use): ${result.title}\n\n${result.draft}`,
    });
    if (err) { toast.error('Couldn\'t save it to the project.'); return; }
    toast.success('Saved to the project\'s notes.');
  };

  const startOver = () => { setStep('ask'); setPlan(null); setResult(null); setError(''); setChange(''); };

  if (loading) return <PageSkeleton />;

  const selectedProject = projects.find((p) => p.id === projectId);
  const planClient = plan?.client_id ? clientName.get(plan.client_id) : null;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1 className="pj-ai-title"><Sparkles size={22} aria-hidden /> AI assistant</h1>
          <p className="page-subtitle">Say what you need. It asks anything it has to know, then writes a draft you can finish here and download.</p>
        </div>
        <Link href="/admin/assistant/facts" className="btn-secondary ai-facts-link"><BookOpen size={15} aria-hidden /> Company facts</Link>
      </div>

      {factsCount !== null && factsCount < 6 && (
        <div className="card ai-facts-nudge">
          <p>
            <strong>Tell the AI about the company</strong> - insurance, what you do, how you check quality, who signs letters.
            It uses these in every draft, so far fewer blanks are left for you. {factsCount} of {FACT_KEYS.length} answered so far.
          </p>
          <Link href="/admin/assistant/facts" className="btn-secondary">Fill them in</Link>
        </div>
      )}

      {step === 'ask' && (
        <form className="card ai-ask" onSubmit={start}>
          <label className="field-label" htmlFor="ai-request">What do you need?</label>
          <textarea
            id="ai-request"
            rows={3}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start(e); }}
            placeholder="e.g. Reply to Sam at Example Offices about the bins not being emptied on Tuesday - we'll re-clean free this week"
            autoFocus
          />
          {!request && (
            <div className="ai-starters">
              {STARTERS.map((s) => <button key={s} type="button" className="ai-starter" onClick={() => setRequest(s)}>{s}</button>)}
            </div>
          )}

          <button type="button" className="pj-text-btn ai-more" onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions}>
            {showOptions ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />} More options - client, project, files, pasted text
          </button>

          {showOptions && (
            <div className="ai-options">
              <div className="field">
                <label className="field-label" htmlFor="ai-type">Kind of document</label>
                <select id="ai-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="">Let the AI decide</option>
                  {DOC_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {DOC_TYPES.filter((t) => t.group === g).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label" htmlFor="ai-client">Client</label>
                  <select id="ai-client" value={clientId} onChange={(e) => { setClientId(e.target.value); setPropertyId(''); }}>
                    <option value="">None / let the AI work it out</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="ai-site">Site</label>
                  <select id="ai-site" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!clientId || siteOptions.length === 0}>
                    <option value="">{clientId ? 'All their sites' : 'Pick a client first'}</option>
                    {siteOptions.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                  </select>
                </div>
              </div>
              <p className="pj-muted ai-hint">For a client it sees their name, contact, site addresses, recent visit counts and ratings - never door codes or access notes.</p>

              {projects.length > 0 && (
                <div className="field">
                  <label className="field-label" htmlFor="ai-project">Project</label>
                  <select id="ai-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">None</option>
                    {projects.map((p) => <option key={p.id} value={p.id} disabled={p.ai_enabled === false}>{p.name}{p.ai_enabled === false ? ' (AI switched off)' : ''}</option>)}
                  </select>
                </div>
              )}

              {(library.length > 0 || projectFiles.length > 0) && (
                <div className="field">
                  <span className="field-label">Files to read (up to {MAX_FILES})</span>
                  <ul className="pj-ai-picks ai-file-picks">
                    {projectFiles.map((f) => (
                      <li key={`p${f.id}`}>
                        <label>
                          <input type="checkbox" checked={fileIds.includes(f.id)} onChange={() => toggle(setFileIds, fileIds, f.id)} disabled={!fileIds.includes(f.id) && fileCount >= MAX_FILES} />
                          <span><span className="pj-task-title">{f.file_name}</span><span className="pj-task-meta">{selectedProject?.name}</span></span>
                        </label>
                      </li>
                    ))}
                    {library.map((d) => (
                      <li key={`d${d.id}`}>
                        <label>
                          <input type="checkbox" checked={docIds.includes(d.id)} onChange={() => toggle(setDocIds, docIds, d.id)} disabled={!docIds.includes(d.id) && fileCount >= MAX_FILES} />
                          <span><span className="pj-task-title">{d.title}</span><span className="pj-task-meta">Documents library</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="pj-muted ai-hint">PDF, Word, Excel, text and image files. Pictures inside Word files aren't read.</p>
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="ai-paste">Paste text (optional)</label>
                <textarea id="ai-paste" rows={4} value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="An email from the client, a tender question, your rough notes..." />
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary ai-go" disabled={Boolean(busy) || !request.trim()}>
            {busy || 'Next'}
          </button>
          {error && <p className="pj-late" style={{ marginTop: 10 }}>{error}</p>}
        </form>
      )}

      {step === 'questions' && plan && (
        <form className="card ai-ask" onSubmit={(e) => { e.preventDefault(); writeDraft(plan, answers); }}>
          <p className="ai-plan-line">
            I'll write: <strong>{docTypeLabel(plan.doc_type)}</strong>{planClient ? <> for <strong>{planClient}</strong></> : null}.
            <button type="button" className="pj-text-btn" onClick={() => { setStep('ask'); setShowOptions(true); }} style={{ marginLeft: 8 }}>Change</button>
          </p>
          <p className="pj-muted" style={{ margin: '0 0 12px' }}>A few things first - answer what you can, leave the rest and it will leave a blank.</p>
          {plan.questions.map((q, i) => (
            <div className="field" key={i}>
              <label className="field-label" htmlFor={`ai-q-${i}`}>{q.question}</label>
              <input
                id={`ai-q-${i}`}
                value={answers[i] || ''}
                onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={q.hint || ''}
                autoFocus={i === 0}
              />
            </div>
          ))}
          <div className="ai-actions">
            <button type="submit" className="btn-primary" disabled={Boolean(busy)}>{busy || 'Write it'}</button>
            <button type="button" className="btn-secondary" onClick={() => writeDraft(plan, [])} disabled={Boolean(busy)}>Skip, just write it</button>
            <button type="button" className="pj-text-btn" onClick={startOver} disabled={Boolean(busy)}>Start again</button>
          </div>
          {error && <p className="pj-late" style={{ marginTop: 10 }}>{error}</p>}
        </form>
      )}

      {step === 'draft' && result && (
        <div className="card">
          <div className="pj-section-head">
            <h2 style={{ margin: 0 }}>{result.title}</h2>
            <button type="button" className="pj-text-btn" onClick={startOver}>New request</button>
          </div>
          {result.truncated && <p className="pj-late">The draft was cut off before the end. Ask for something shorter.</p>}
          <DraftEditor
            body={result.draft}
            onChange={saveEdits}
            onDownload={download}
            extraActions={projectId ? <button type="button" className="btn-secondary" onClick={saveToProject}>Save to project notes</button> : null}
          />
          <form className="ai-revise" onSubmit={revise}>
            <label className="field-label" htmlFor="ai-change">Want it different?</label>
            <div className="ai-revise-row">
              <input id="ai-change" value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. shorter, more formal, add a paragraph about night cleaning" />
              <button type="submit" className="btn-secondary" disabled={Boolean(busy) || !change.trim()}>{busy || 'Rewrite'}</button>
            </div>
            <p className="pj-muted ai-hint" style={{ marginTop: 6 }}>Rewriting starts from the text as it is now, including your edits.</p>
          </form>
          {error && <p className="pj-late" style={{ marginTop: 10 }}>{error}</p>}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Recent drafts</h2>
          <ul className="pj-files">
            {history.map((row) => (
              <li key={row.id}>
                <FileText size={16} className="pj-file-icon" aria-hidden />
                <button type="button" className="pj-file-name" onClick={() => openDraft(row)} title="Open this draft">
                  <span>{row.title}</span>
                  <span className="pj-task-meta">{[docTypeLabel(row.doc_type), row.client_id && clientName.get(row.client_id), formatWhen(row.created_at)].filter(Boolean).join(' · ')}</span>
                </button>
                <button type="button" className="pj-icon-btn" onClick={() => deleteDraft(row)} aria-label={`Delete ${row.title}`} title="Delete"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
