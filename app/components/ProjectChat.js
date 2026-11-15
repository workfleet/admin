'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessagesSquare, Send, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { parseAnswer } from '../../lib/helpChat';
import { applyProjectChange, applyOrder } from '../../lib/projectChatActions';

// The chat on a project page. Tell it things ("the minimum wage goes to
// £13.21 in April") and it proposes every change that follows - notes,
// tasks, key dates, and new copies of Excel or Word files - as one list to
// tick and apply. Then it says what is still outstanding.
//
// The conversation is kept in this tab only (sessionStorage).

const SUGGESTIONS = [
  'What is still outstanding?',
  'The National Living Wage goes up to £13.21 an hour from 1 April 2027 - update the project for it',
  'Which tasks are late, and what should I do first?',
];

function storeKey(projectId) { return `wf-project-chat-${projectId}`; }
function readStore(projectId) { try { return JSON.parse(sessionStorage.getItem(storeKey(projectId)) || '[]'); } catch { return []; } }
function writeStore(projectId, items) { try { sessionStorage.setItem(storeKey(projectId), JSON.stringify(items.slice(-30))); } catch { /* private mode */ } }

function historyFor(items) {
  return items.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    const outcomes = (m.changes || []).map((c) => `- ${c.headline}: ${c.error ? `not possible (${c.error})` : c.result ? (c.result.ok ? 'applied' : `failed (${c.result.message})`) : c.include === false ? 'not wanted' : 'not applied yet'}`);
    return { role: 'assistant', content: [m.text, outcomes.length ? `Changes proposed:\n${outcomes.join('\n')}` : ''].filter(Boolean).join('\n\n') || '(changes proposed)' };
  });
}

function Runs({ runs }) {
  return runs.map((r, i) => {
    if (r.href) return <Link key={i} href={r.href}>{r.text}</Link>;
    if (r.bold) return <strong key={i}>{r.text}</strong>;
    return <span key={i}>{r.text}</span>;
  });
}

function Answer({ text }) {
  const blocks = parseAnswer(text);
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(list); list = null; } };
  blocks.forEach((b, i) => {
    if (b.type === 'bullet' || b.type === 'numbered') {
      const tag = b.type === 'bullet' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { close(); list = { tag, key: i, items: [] }; }
      list.items.push(<li key={i}><Runs runs={b.runs} /></li>);
      return;
    }
    close();
    out.push(<p key={i}><Runs runs={b.runs} /></p>);
  });
  close();
  return out.map((x) => (x.tag ? (x.tag === 'ul' ? <ul key={`l${x.key}`}>{x.items}</ul> : <ol key={`l${x.key}`}>{x.items}</ol>) : x));
}

export default function ProjectChat({ projectId, aiEnabled, userId, onApplied, onToggleAi }) {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(null);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => { setItems(readStore(projectId)); }, [projectId]);
  useEffect(() => { writeStore(projectId, items); }, [projectId, items]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [items.length, busy]);

  if (!aiEnabled) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="pj-ai-title"><MessagesSquare size={16} aria-hidden /> Project chat</h2>
        <p className="pj-muted" style={{ margin: '0 0 10px' }}>Tell it what's changed and it updates the tasks, dates and files for you. It needs this project's AI tools switched on.</p>
        {onToggleAi && <button type="button" className="btn-secondary" onClick={() => onToggleAi(true)}>Switch AI tools on</button>}
      </div>
    );
  }

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    const next = [...items, { role: 'user', text: message }];
    setItems(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/projects/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ project_id: projectId, messages: historyFor(next) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { setError(data?.message || (res.status === 504 ? 'That took too long - try one thing at a time.' : 'Something went wrong. Please try again.')); return; }
      setItems((cur) => [...cur, { role: 'assistant', text: data.answer || '', changes: (data.changes || []).map((c) => ({ ...c, include: !c.error })) }]);
    } catch {
      setError('Couldn\'t reach the server - check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (mi, ci) => setItems((cur) => cur.map((m, i) => (i !== mi ? m : { ...m, changes: m.changes.map((c, j) => (j === ci ? { ...c, include: !c.include } : c)) })));

  const apply = async (mi) => {
    const changes = items[mi].changes;
    setApplying(mi);
    const results = {};
    for (const i of applyOrder(changes)) {
      const c = changes[i];
      if (c.error || !c.include || c.result?.ok) continue;
      results[i] = await applyProjectChange(projectId, c, userId);
    }
    setItems((cur) => cur.map((m, i) => (i !== mi ? m : { ...m, changes: m.changes.map((c, j) => (results[j] ? { ...c, result: results[j] } : c)) })));
    setApplying(null);
    onApplied?.();
  };

  return (
    <div className="card pj-chat" style={{ marginBottom: 16 }}>
      <div className="pj-section-head">
        <h2 className="pj-ai-title" style={{ margin: 0 }}><MessagesSquare size={16} aria-hidden /> Project chat</h2>
        {items.length > 0 && <button type="button" className="pj-icon-btn" onClick={() => { setItems([]); setError(''); }} aria-label="Start a new conversation" title="Start again"><RotateCcw size={15} /></button>}
      </div>

      <div className="pj-chat-list" ref={listRef}>
        {items.length === 0 && (
          <div className="help-empty">
            <p>Tell it what's changed - a new rate, a moved deadline, a decision - and it updates the tasks, dates, notes and files for you to check, then says what's still outstanding.</p>
            <div className="help-suggestions">
              {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {items.map((m, mi) => (m.role === 'user'
          ? <div key={mi} className="help-msg is-user">{m.text}</div>
          : (
            <div key={mi} className="help-msg is-ai">
              {m.text && <Answer text={m.text} />}
              {(m.changes || []).length > 0 && (
                <div className="pj-chat-changes">
                  <p className="help-card-title">Changes to apply</p>
                  <ul>
                    {m.changes.map((c, ci) => (
                      <li key={ci} className={c.error ? 'is-error' : c.result ? (c.result.ok ? 'is-done' : 'is-failed') : ''}>
                        {c.error ? <AlertTriangle size={14} aria-hidden /> : c.result?.ok ? <Check size={14} aria-hidden /> : (
                          <input type="checkbox" checked={Boolean(c.include)} onChange={() => toggle(mi, ci)} disabled={applying !== null} style={{ width: 'auto', margin: '2px 0 0' }} aria-label={c.headline} />
                        )}
                        <span>
                          <strong>{c.headline}</strong>
                          {c.error && <span className="pj-task-meta"> - {c.error}</span>}
                          {(c.details || []).map((d, k) => <span key={k} className="pj-chat-detail">{d}</span>)}
                          {(c.warnings || []).map((w, k) => <span key={`w${k}`} className="pj-chat-warning">{w}</span>)}
                          {c.result && <span className={c.result.ok ? 'pj-chat-ok' : 'pj-chat-warning'}>{c.result.message}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {m.changes.some((c) => !c.error && !c.result?.ok) && (
                    <button type="button" className="btn-primary" onClick={() => apply(mi)} disabled={applying !== null || !m.changes.some((c) => !c.error && c.include && !c.result?.ok)} style={{ width: 'auto' }}>
                      {applying === mi ? 'Applying...' : `Apply ${m.changes.filter((c) => !c.error && c.include && !c.result?.ok).length} change${m.changes.filter((c) => !c.error && c.include && !c.result?.ok).length === 1 ? '' : 's'}`}
                    </button>
                  )}
                  <p className="pj-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Edited files are saved as new copies - the originals stay.</p>
                </div>
              )}
            </div>
          )))}
        {busy && <div className="help-msg is-ai help-typing"><span /><span /><span /></div>}
        {error && <p className="help-error">{error}</p>}
      </div>

      <form className="help-input pj-chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Tell it what's changed, or ask what's left to do..."
          aria-label="Message the project chat"
        />
        <button type="submit" className="help-send" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
      </form>
    </div>
  );
}
