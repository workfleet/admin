'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Copy, X, Download } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { DRAFT_TYPES, MAX_DRAFT_FILES, readableKind, unreadableReason } from '../../lib/projectAi';
import { plainText, fileNameFor } from '../../lib/aiDrafting';
import { companyFromSettings } from '../../lib/companyBranding';
import DraftPreview from './DraftPreview';

async function downloadWord(draft, title) {
  const [{ data }, { downloadDraftDocx }] = await Promise.all([
    supabase.from('company_settings').select('*').limit(1).maybeSingle(),
    import('../../lib/draftDocx'),
  ]);
  await downloadDraftDocx(draft, companyFromSettings(data), fileNameFor(title));
}

// The AI card on a project page. Suggest tasks from a file, ask a
// question, get a summary, or draft something - all suggestion-only:
// nothing is added to the project until someone ticks it or presses Save.
//
// props:
//   project      - needs id and ai_enabled
//   files        - the project's files
//   onToggleAi   - (enabled) => Promise<void>, flips the project's switch
//   onAddSuggestions - ({ tasks, dates }) => Promise<boolean>
//   onSaveNote   - (text) => Promise<boolean>
//   onUsed       - () => void, reload the history after the route logged a use

async function callAi(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Please sign in again.' };
  let res;
  try {
    res = await fetch('/api/projects/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: 'Couldn\'t reach the server - check your connection.' };
  }
  // A function that ran out of time returns a plain-text page, not JSON.
  const data = await res.json().catch(() => null);
  if (!data) return { error: res.status === 504 ? 'That took too long. Try a shorter document or a smaller request.' : 'Something went wrong. Please try again.' };
  if (!res.ok) return { error: data.message || 'Something went wrong. Please try again.' };
  return { data };
}

export default function ProjectAiTools({ project, files, onToggleAi, onAddSuggestions, onSaveNote, onUsed }) {
  const [mode, setMode] = useState(null); // null | 'tasks' | 'draft'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [fileId, setFileId] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [picked, setPicked] = useState({ tasks: new Set(), dates: new Set() });

  const [draftType, setDraftType] = useState('free');
  const [instruction, setInstruction] = useState('');
  const [draftFiles, setDraftFiles] = useState([]);
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [change, setChange] = useState('');

  const [question, setQuestion] = useState('');
  const [askFiles, setAskFiles] = useState([]);
  const [answer, setAnswer] = useState(null);

  const readable = files.filter((f) => readableKind(f.file_name));

  if (!project.ai_enabled) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="pj-section-head">
          <h2 className="pj-ai-title"><Sparkles size={16} aria-hidden /> AI tools</h2>
        </div>
        <p className="pj-muted" style={{ margin: '0 0 10px' }}>
          Switched off for this project. {project.kind === 'tender' ? 'Check the tender\'s rules on AI first - some ban it or ask you to declare it.' : ''}
        </p>
        <button type="button" className="btn-secondary" onClick={() => onToggleAi(true)}>Switch AI tools on</button>
      </div>
    );
  }

  const close = () => { setMode(null); setError(''); setSuggestions(null); setDraft(null); setAnswer(null); setChange(''); };

  const runAsk = async (e) => {
    e?.preventDefault();
    if (!question.trim()) return;
    setBusy(true); setError(''); setAnswer(null);
    const { data, error: err } = await callAi({ project_id: project.id, tool: 'ask', question, file_ids: askFiles });
    setBusy(false);
    if (err) { setError(err); return; }
    setAnswer(data.answer);
    onUsed?.();
  };

  // One click: a summary of where the project stands, as a draft.
  const runSummary = async () => {
    setMode('draft');
    setBusy(true); setError(''); setDraft(null);
    const req = { draft_type: 'status_summary', instruction: 'What is done, what is next, what is late or at risk, and any decisions recorded in the notes.', file_ids: [] };
    const { data, error: err } = await callAi({ project_id: project.id, tool: 'draft', ...req });
    setBusy(false);
    if (err) { setError(err); return; }
    setDraft({ ...data, req });
    onUsed?.();
  };

  const runRevise = async (e) => {
    e.preventDefault();
    if (!change.trim() || !draft) return;
    setBusy(true); setError(''); setCopied(false);
    const { data, error: err } = await callAi({ project_id: project.id, tool: 'draft', ...draft.req, previous_draft: draft.draft, change_request: change.trim() });
    setBusy(false);
    if (err) { setError(err); return; }
    setDraft({ ...data, req: draft.req });
    setChange('');
    onUsed?.();
  };

  const toggleAskFile = (fid) => setAskFiles((prev) => (
    prev.includes(fid) ? prev.filter((x) => x !== fid) : prev.length < MAX_DRAFT_FILES ? [...prev, fid] : prev
  ));

  const runTasks = async () => {
    if (!fileId) return;
    setBusy(true); setError(''); setSuggestions(null);
    const { data, error: err } = await callAi({ project_id: project.id, tool: 'tasks', file_id: fileId });
    setBusy(false);
    if (err) { setError(err); return; }
    setSuggestions(data);
    setPicked({ tasks: new Set(data.tasks.map((_, i) => i)), dates: new Set(data.dates.map((_, i) => i)) });
    onUsed?.();
  };

  const togglePick = (kind, i) => setPicked((p) => {
    const next = new Set(p[kind]);
    if (next.has(i)) next.delete(i); else next.add(i);
    return { ...p, [kind]: next };
  });

  const addPicked = async () => {
    const tasks = suggestions.tasks.filter((_, i) => picked.tasks.has(i));
    const dates = suggestions.dates.filter((_, i) => picked.dates.has(i));
    if (!tasks.length && !dates.length) return;
    setBusy(true);
    const ok = await onAddSuggestions({ tasks, dates });
    setBusy(false);
    if (ok) close();
  };

  const runDraft = async () => {
    setBusy(true); setError(''); setDraft(null); setCopied(false);
    const req = { draft_type: draftType, instruction, file_ids: draftFiles };
    const { data, error: err } = await callAi({ project_id: project.id, tool: 'draft', ...req });
    setBusy(false);
    if (err) { setError(err); return; }
    setDraft({ ...data, req });
    onUsed?.();
  };

  const copyDraft = async () => {
    try { await navigator.clipboard.writeText(plainText(draft.draft)); setCopied(true); } catch { setCopied(false); }
  };

  const saveDraft = async () => {
    setBusy(true);
    const ok = await onSaveNote(`AI draft (checked by the office before use): ${draft.title || ''}\n\n${draft.draft}`);
    setBusy(false);
    if (ok) close();
  };

  const toggleDraftFile = (id) => setDraftFiles((prev) => (
    prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_DRAFT_FILES ? [...prev, id] : prev
  ));

  return (
    <div className="card pj-ai" style={{ marginBottom: 16 }}>
      <div className="pj-section-head">
        <h2 className="pj-ai-title"><Sparkles size={16} aria-hidden /> AI tools</h2>
        {mode ? (
          <button type="button" className="pj-icon-btn" onClick={close} aria-label="Close AI tools" title="Close"><X size={16} /></button>
        ) : (
          <button type="button" className="pj-text-btn" onClick={() => onToggleAi(false)} title="Turn AI off for this project">Switch off</button>
        )}
      </div>

      {!mode && (
        <>
          <p className="pj-muted" style={{ margin: '0 0 10px' }}>Suggestions only - nothing is added until you choose it. Every use is noted in the history.</p>
          <div className="pj-ai-choices">
            <button type="button" className="btn-secondary" onClick={() => setMode('tasks')}>Suggest tasks from a file</button>
            <button type="button" className="btn-secondary" onClick={() => setMode('ask')}>Ask a question</button>
            <button type="button" className="btn-secondary" onClick={runSummary}>Summarise where it stands</button>
            <button type="button" className="btn-secondary" onClick={() => setMode('draft')}>Draft something</button>
          </div>
          <p className="pj-muted" style={{ margin: '10px 0 0' }}>
            Need a letter, policy or advert? <Link href={`/admin/assistant?project=${project.id}`}>Open the AI assistant</Link>
          </p>
        </>
      )}

      {mode === 'tasks' && !suggestions && (
        <div>
          {readable.length === 0 ? (
            <p className="pj-muted" style={{ margin: 0 }}>Upload the document to Files first (PDF, Word, Excel, text or an image). {files.length > 0 ? unreadableReason(files[0].file_name) : ''}</p>
          ) : (
            <>
              <label className="field-label" htmlFor="pj-ai-file">Which file should it read?</label>
              <select id="pj-ai-file" value={fileId} onChange={(e) => setFileId(e.target.value)}>
                <option value="">Choose a file...</option>
                {readable.map((f) => <option key={f.id} value={f.id}>{f.file_name}</option>)}
              </select>
              {files.length > readable.length && <p className="pj-muted" style={{ margin: '6px 0 0' }}>Some files aren't listed because they can't be read (old .doc or .xls, or other types) - save them as .docx, .xlsx or PDF.</p>}
              <button type="button" className="btn-primary" style={{ marginTop: 10 }} onClick={runTasks} disabled={!fileId || busy}>
                {busy ? 'Reading... (up to a minute)' : 'Suggest tasks'}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'tasks' && suggestions && (
        <div>
          {suggestions.summary && <p className="pj-ai-summary">{suggestions.summary}</p>}
          {suggestions.warnings.length > 0 && (
            <ul className="pj-ai-warnings">{suggestions.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {suggestions.dates.length > 0 && (
            <>
              <h3 className="pj-ai-subhead">Key dates</h3>
              <ul className="pj-ai-picks">
                {suggestions.dates.map((d, i) => (
                  <li key={`d${i}`}>
                    <label>
                      <input type="checkbox" checked={picked.dates.has(i)} onChange={() => togglePick('dates', i)} />
                      <span>
                        <span className="pj-task-title">{d.label}</span>
                        <span className="pj-task-meta">{d.date}{d.source ? ` · ${d.source}` : ''}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {suggestions.tasks.length > 0 && (
            <>
              <h3 className="pj-ai-subhead">Tasks</h3>
              <ul className="pj-ai-picks">
                {suggestions.tasks.map((t, i) => (
                  <li key={`t${i}`}>
                    <label>
                      <input type="checkbox" checked={picked.tasks.has(i)} onChange={() => togglePick('tasks', i)} />
                      <span>
                        <span className="pj-task-title">{t.title}</span>
                        <span className="pj-task-meta">{[t.due_date && `due ${t.due_date}`, t.source, t.notes].filter(Boolean).join(' · ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {suggestions.tasks.length === 0 && suggestions.dates.length === 0 && (
            <p className="pj-muted">Nothing new found in {suggestions.file_name}.</p>
          )}
          <p className="pj-muted" style={{ margin: '10px 0' }}>Check each one against the document before relying on it.</p>
          <div className="pj-task-edit-actions">
            <button type="button" className="btn-secondary" onClick={() => setSuggestions(null)}>Try another file</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn-primary" onClick={addPicked} disabled={busy || (picked.tasks.size + picked.dates.size === 0)}>
              Add {picked.tasks.size + picked.dates.size} to the project
            </button>
          </div>
        </div>
      )}

      {mode === 'ask' && (
        <form onSubmit={runAsk}>
          <div className="field">
            <label className="field-label" htmlFor="pj-ai-q">Your question</label>
            <textarea id="pj-ai-q" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What did we decide about deep clean pricing? What's still missing for submission?" />
          </div>
          {readable.length > 0 && (
            <div className="field">
              <span className="field-label">Also read these files (optional, up to {MAX_DRAFT_FILES})</span>
              <ul className="pj-ai-picks">
                {readable.map((f) => (
                  <li key={f.id}>
                    <label>
                      <input type="checkbox" checked={askFiles.includes(f.id)} onChange={() => toggleAskFile(f.id)} disabled={!askFiles.includes(f.id) && askFiles.length >= MAX_DRAFT_FILES} />
                      <span className="pj-task-title">{f.file_name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>{busy ? 'Thinking... (up to a minute)' : 'Ask'}</button>
          {answer && (
            <div style={{ marginTop: 12 }}>
              <p className="pj-ai-badge">AI answer - check it against the notes</p>
              <p className="pj-ai-answer">{answer}</p>
            </div>
          )}
        </form>
      )}

      {mode === 'draft' && !draft && busy && <p className="pj-muted">Writing... (up to a minute)</p>}

      {mode === 'draft' && !draft && !busy && (
        <div>
          <div className="field">
            <label className="field-label" htmlFor="pj-ai-type">What kind of writing?</label>
            <select id="pj-ai-type" value={draftType} onChange={(e) => setDraftType(e.target.value)}>
              {DRAFT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pj-ai-ask">{draftType === 'free' ? 'What should it write?' : 'Anything to add? (optional)'}</label>
            <textarea id="pj-ai-ask" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)}
              placeholder={draftType === 'tender_answer' ? 'Paste the question and its word limit' : 'e.g. keep it under 300 words, mention the night team'} />
          </div>
          {readable.length > 0 && (
            <div className="field">
              <span className="field-label">Use these files too (up to {MAX_DRAFT_FILES})</span>
              <ul className="pj-ai-picks">
                {readable.map((f) => (
                  <li key={f.id}>
                    <label>
                      <input type="checkbox" checked={draftFiles.includes(f.id)} onChange={() => toggleDraftFile(f.id)}
                        disabled={!draftFiles.includes(f.id) && draftFiles.length >= MAX_DRAFT_FILES} />
                      <span className="pj-task-title">{f.file_name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn-primary" onClick={runDraft} disabled={busy || (draftType === 'free' && !instruction.trim())}>
            {busy ? 'Writing... (up to a minute)' : 'Write a draft'}
          </button>
        </div>
      )}

      {mode === 'draft' && draft && (
        <div>
          <p className="pj-ai-badge">AI draft - check every fact before you use it</p>
          <DraftPreview body={draft.draft} />
          {draft.truncated && <p className="pj-late" style={{ marginTop: 8 }}>The draft was cut off before the end. Ask for something shorter.</p>}
          {draft.placeholders.length > 0 && (
            <>
              <h3 className="pj-ai-subhead">To fill in ({draft.placeholders.length})</h3>
              <ul className="pj-ai-warnings">{draft.placeholders.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          <div className="pj-task-edit-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>Change the request</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn-secondary" onClick={copyDraft}><Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="btn-secondary" onClick={() => downloadWord(draft.draft, draft.title).catch(() => setError('Couldn\'t make the Word file.'))}><Download size={14} aria-hidden /> Word</button>
            <button type="button" className="btn-primary" onClick={saveDraft} disabled={busy}>Save as a note</button>
          </div>
          <form className="ai-revise" onSubmit={runRevise}>
            <div className="ai-revise-row">
              <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Want it different? e.g. shorter, more formal" aria-label="Change to make" />
              <button type="submit" className="btn-secondary" disabled={busy || !change.trim()}>{busy ? 'Rewriting...' : 'Rewrite'}</button>
            </div>
          </form>
        </div>
      )}

      {error && <p className="pj-late" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
