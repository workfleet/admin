'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Copy, Download, Trash2, FileText } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { companyFromSettings } from '../../../lib/companyBranding';
import { DOC_TYPES, DOC_GROUPS, docTypeLabel, plainText, fileNameFor } from '../../../lib/aiDrafting';
import { readableKind } from '../../../lib/projectAi';
import { isOpenStatus } from '../../../lib/projects';
import DraftPreview from '../../components/DraftPreview';
import { PageSkeleton } from '../../components/Skeleton';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const MAX_FILES = 3;

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
  const [company, setCompany] = useState(null);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [projects, setProjects] = useState([]);
  const [library, setLibrary] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [history, setHistory] = useState(null); // null = 0139 not run

  const [docType, setDocType] = useState('client_letter');
  const [instruction, setInstruction] = useState('');
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [docIds, setDocIds] = useState([]);
  const [fileIds, setFileIds] = useState([]);
  const [showPaste, setShowPaste] = useState(false);
  const [sourceText, setSourceText] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [change, setChange] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const [settingsRes, clientsRes, propsRes, projectsRes, libraryRes, historyRes] = await Promise.all([
      supabase.from('company_settings').select('*').limit(1).maybeSingle(),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('properties').select('id, client_id, address').order('address'),
      supabase.from('projects').select('id, name, status, client_id, ai_enabled').order('updated_at', { ascending: false }),
      supabase.from('company_documents').select('id, title, file_name').order('title'),
      supabase.from('ai_drafts').select('id, doc_type, title, created_at, created_by, client_id, project_id').order('created_at', { ascending: false }).limit(30),
    ]);

    setCompany(companyFromSettings(settingsRes.data));
    setClients(clientsRes.data || []);
    setProperties(propsRes.data || []);
    setProjects((projectsRes.data || []).filter((p) => isOpenStatus(p.status)));
    setLibrary((libraryRes.data || []).filter((d) => readableKind(d.file_name)));
    setHistory(historyRes.error ? null : historyRes.data || []);

    // Arriving from a client or project page: ?client=...&project=...&type=...
    const params = new URLSearchParams(window.location.search);
    if (params.get('client')) setClientId(params.get('client'));
    if (params.get('project')) setProjectId(params.get('project'));
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

  const typeInfo = DOC_TYPES.find((t) => t.value === docType);
  const siteOptions = properties.filter((p) => p.client_id === clientId);
  const fileCount = docIds.length + fileIds.length;
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const toggle = (setter, list, id) => {
    if (list.includes(id)) setter(list.filter((x) => x !== id));
    else if (fileCount < MAX_FILES) setter([...list, id]);
  };

  const basePayload = () => ({
    doc_type: docType,
    instruction,
    client_id: clientId || null,
    property_id: propertyId || null,
    project_id: projectId || null,
    document_ids: docIds,
    project_file_ids: fileIds,
    source_text: showPaste ? sourceText : '',
  });

  const write = async (e) => {
    e?.preventDefault();
    setBusy(true); setError(''); setCopied(false);
    const { data, error: err } = await callDraft(basePayload());
    setBusy(false);
    if (err) { setError(err); return; }
    setResult(data);
    setChange('');
    if (data.id && history) setHistory((h) => [{ id: data.id, doc_type: docType, title: data.title, created_at: new Date().toISOString(), client_id: clientId || null, project_id: projectId || null }, ...h]);
  };

  const revise = async (e) => {
    e.preventDefault();
    if (!change.trim() || !result) return;
    setBusy(true); setError(''); setCopied(false);
    const { data, error: err } = await callDraft({ ...basePayload(), previous_draft: result.draft, change_request: change.trim(), revised_from: result.id });
    setBusy(false);
    if (err) { setError(err); return; }
    setResult(data);
    setChange('');
    if (data.id && history) setHistory((h) => [{ id: data.id, doc_type: docType, title: data.title, created_at: new Date().toISOString(), client_id: clientId || null, project_id: projectId || null }, ...h]);
  };

  const download = async (draft, title) => {
    try {
      const { downloadDraftDocx } = await import('../../../lib/draftDocx');
      await downloadDraftDocx(draft, company, fileNameFor(title));
    } catch {
      toast.error('Couldn\'t make the Word file.');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(plainText(result.draft)); setCopied(true); } catch { toast.error('Couldn\'t copy - select the text instead.'); }
  };

  const openDraft = async (row) => {
    const { data, error: err } = await supabase.from('ai_drafts').select('id, title, draft, placeholders').eq('id', row.id).single();
    if (err || !data) { toast.error('Couldn\'t open that draft.'); return; }
    setResult({ id: data.id, title: data.title, draft: data.draft, placeholders: data.placeholders || [], truncated: false });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteDraft = async (row) => {
    if (!(await confirm(`Delete the saved draft "${row.title}"?`, { danger: true }))) return;
    const { error: err } = await supabase.from('ai_drafts').delete().eq('id', row.id);
    if (err) { toast.error('Couldn\'t delete it.'); return; }
    setHistory((h) => h.filter((x) => x.id !== row.id));
    if (result?.id === row.id) setResult(null);
  };

  const saveToProject = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const { error: err } = await supabase.from('project_notes').insert({
      project_id: projectId, kind: 'note', created_by: session?.user?.id,
      body: `AI draft (checked by the office before use): ${result.title}\n\n${result.draft}`,
    });
    if (err) { toast.error('Couldn\'t save it to the project.'); return; }
    toast.success('Saved to the project\'s notes.');
  };

  if (loading) return <PageSkeleton />;

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1 className="pj-ai-title"><Sparkles size={22} aria-hidden /> AI assistant</h1>
          <p className="page-subtitle">Ask for a first draft of any document - letters, emails, policies, adverts, tender answers. You check it before it's used.</p>
        </div>
      </div>

      <div className="ai-layout">
        <form className="card ai-form" onSubmit={write}>
          <div className="field">
            <label className="field-label" htmlFor="ai-type">What do you need?</label>
            <select id="ai-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {DOC_TYPES.filter((t) => t.group === g).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ai-ask">{docType === 'free' ? 'What should it write?' : 'Tell it what to say'}</label>
            <textarea id="ai-ask" rows={5} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={typeInfo?.hint} required={docType === 'free'} />
          </div>

          <p className="ai-include-label">Give it something to work from (optional)</p>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="ai-client">Client</label>
              <select id="ai-client" value={clientId} onChange={(e) => { setClientId(e.target.value); setPropertyId(''); }}>
                <option value="">None</option>
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
          {clientId && <p className="pj-muted ai-hint">It will see the client's name, contact, site addresses, recent visit counts and ratings - never door codes or access notes.</p>}

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
              <p className="pj-muted ai-hint">PDF, text and image files only - save Word files as PDF first.</p>
            </div>
          )}

          {showPaste ? (
            <div className="field">
              <label className="field-label" htmlFor="ai-paste">Pasted text</label>
              <textarea id="ai-paste" rows={6} value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="An email from the client, a tender question, your rough notes..." />
            </div>
          ) : (
            <button type="button" className="pj-text-btn" onClick={() => setShowPaste(true)} style={{ marginBottom: 12 }}>+ Paste some text in</button>
          )}

          <button type="submit" className="btn-primary ai-go" disabled={busy || (docType === 'free' && !instruction.trim())}>
            {busy ? 'Writing... (up to a minute)' : 'Write the draft'}
          </button>
          {error && <p className="pj-late" style={{ marginTop: 10 }}>{error}</p>}
        </form>

        <div className="ai-result">
          {result ? (
            <div className="card">
              <p className="pj-ai-badge">AI draft - check every fact before you use it</p>
              <DraftPreview body={result.draft} />
              {result.truncated && <p className="pj-late">The draft was cut off before the end. Ask for something shorter.</p>}
              {result.placeholders?.length > 0 && (
                <>
                  <h3 className="pj-ai-subhead">To fill in ({result.placeholders.length})</h3>
                  <ul className="pj-ai-warnings">{result.placeholders.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>
              )}
              <div className="ai-actions">
                <button type="button" className="btn-primary" onClick={() => download(result.draft, result.title)}><Download size={15} aria-hidden /> Download Word</button>
                <button type="button" className="btn-secondary" onClick={copy}><Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy text'}</button>
                {projectId && <button type="button" className="btn-secondary" onClick={saveToProject}>Save to project notes</button>}
              </div>
              <form className="ai-revise" onSubmit={revise}>
                <label className="field-label" htmlFor="ai-change">Want it different?</label>
                <div className="ai-revise-row">
                  <input id="ai-change" value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. shorter, more formal, add a paragraph about night cleaning" />
                  <button type="submit" className="btn-secondary" disabled={busy || !change.trim()}>{busy ? 'Rewriting...' : 'Rewrite'}</button>
                </div>
              </form>
            </div>
          ) : (
            <div className="card ai-empty">
              <FileText size={22} aria-hidden />
              <p>Your draft will appear here. Every draft has blanks like <mark className="draft-blank">[CONFIRM: start date]</mark> where the AI didn't have the facts - fill them in before sending.</p>
            </div>
          )}
        </div>
      </div>

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
