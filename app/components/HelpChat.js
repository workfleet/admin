'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircleQuestion, X, Send, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { parseAnswer } from '../../lib/helpChat';
import { runRotaAction } from '../../lib/rotaActions';

// "Ask WorkFleet" - the chat in the corner of every office page. Ask how to
// do something and it explains, with links. Ask it to change the rota and
// it puts up a card for each change; nothing happens until Confirm.
//
// The conversation lives in this tab only (sessionStorage), so a reload
// keeps it but nothing is stored anywhere else.

const STORE = 'wf-help-chat';
const SUGGESTIONS = [
  'How do I give a cleaner a regular weekly shift?',
  'Book Sam at the Bus Station next Monday 6-8pm',
  'Who is working tomorrow?',
  'How do I close a pay period?',
  'Move Friday\'s visit at Axis Court to 7pm',
  'How do I add a new client?',
];

function readStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch { return []; }
}
function writeStore(items) {
  try { sessionStorage.setItem(STORE, JSON.stringify(items.slice(-40))); } catch { /* private mode */ }
}

// What goes back to the AI: the text of each turn, plus a line saying what
// happened to each card, so "and move it to 8 instead" makes sense.
function historyFor(items) {
  return items.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    const outcomes = (m.cards || []).map((c) => `- ${c.headline}: ${c.error ? `couldn't be done (${c.error})` : c.state === 'done' ? 'confirmed and done' : c.state === 'failed' ? `failed (${c.result})` : c.state === 'dismissed' ? 'not wanted' : 'waiting for Confirm'}`);
    return { role: 'assistant', content: [m.text, outcomes.length ? `Changes shown:\n${outcomes.join('\n')}` : ''].filter(Boolean).join('\n\n') || '(changes shown)' };
  });
}

function Runs({ runs, onNavigate }) {
  return runs.map((r, i) => {
    if (r.href) return <Link key={i} href={r.href} onClick={onNavigate}>{r.text}</Link>;
    if (r.bold) return <strong key={i}>{r.text}</strong>;
    return <span key={i}>{r.text}</span>;
  });
}

function Answer({ text, onNavigate }) {
  const blocks = parseAnswer(text);
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(list); list = null; } };
  blocks.forEach((b, i) => {
    if (b.type === 'bullet' || b.type === 'numbered') {
      const tag = b.type === 'bullet' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { close(); list = { tag, key: i, items: [] }; }
      list.items.push(<li key={i}><Runs runs={b.runs} onNavigate={onNavigate} /></li>);
      return;
    }
    close();
    out.push(<p key={i}><Runs runs={b.runs} onNavigate={onNavigate} /></p>);
  });
  close();
  return out.map((x) => (x.tag ? (x.tag === 'ul' ? <ul key={`l${x.key}`}>{x.items}</ul> : <ol key={`l${x.key}`}>{x.items}</ol>) : x));
}

function ActionCard({ card, waiting, onConfirm, onDismiss }) {
  const [busy, setBusy] = useState(false);
  if (card.error) {
    return (
      <div className="help-card is-error">
        <p className="help-card-title"><AlertTriangle size={14} aria-hidden /> {card.headline}</p>
        <p className="help-card-line">{card.error}</p>
      </div>
    );
  }
  const done = card.state === 'done';
  const failed = card.state === 'failed';
  const dismissed = card.state === 'dismissed';
  return (
    <div className={`help-card${done ? ' is-done' : ''}${dismissed ? ' is-dismissed' : ''}`}>
      <p className="help-card-title">{card.headline}</p>
      {card.details.map((d, i) => <p key={i} className="help-card-line">{d}</p>)}
      {card.warnings?.length > 0 && !done && (
        <ul className="help-card-warnings">{card.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {done && <p className="help-card-result"><Check size={14} aria-hidden /> {card.result}</p>}
      {failed && <p className="help-card-result is-failed">{card.result}</p>}
      {dismissed && <p className="help-card-line">Not done.</p>}
      {!done && !dismissed && waiting && <p className="help-card-line"><em>{waiting}</em></p>}
      {!done && !dismissed && (
        <div className="help-card-actions">
          <button type="button" className="btn-primary" disabled={busy || Boolean(waiting)} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? 'Doing it...' : failed ? 'Try again' : 'Confirm'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onDismiss}>No thanks</button>
        </div>
      )}
    </div>
  );
}

export default function HelpChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setItems(readStore()); }, []);
  useEffect(() => { writeStore(items); }, [items]);
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, items.length, busy]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    const next = [...items, { role: 'user', text: question }];
    setItems(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Please sign in again.'); return; }
      const res = await fetch('/api/ai/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ messages: historyFor(next), page: pathname }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { setError(data?.message || (res.status === 504 ? 'That took too long - try a simpler question.' : 'Something went wrong. Please try again.')); return; }
      setItems((cur) => [...cur, { role: 'assistant', text: data.answer || '', cards: (data.cards || []).map((c) => ({ ...c, state: c.error ? 'error' : 'pending' })) }]);
    } catch {
      setError('Couldn\'t reach the server - check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const updateCard = (msgIndex, cardIndex, patch) => {
    setItems((cur) => cur.map((m, i) => (i !== msgIndex ? m : { ...m, cards: m.cards.map((c, j) => (j === cardIndex ? { ...c, ...patch } : c)) })));
  };

  // A card that builds on an earlier one (a site for a client just added, a
  // visit at that site) takes the id that card created.
  const resolvedFor = (cards, card) => {
    const parent = Number.isInteger(card.dependsOn) ? cards[card.dependsOn] : null;
    if (!parent) return {};
    if (parent.type === 'create_client') return { client_id: parent.createdId };
    if (parent.type === 'create_site') return { property_id: parent.createdId };
    return {};
  };

  const confirmCard = async (msgIndex, cardIndex) => {
    const cards = items[msgIndex].cards;
    const card = cards[cardIndex];
    const result = await runRotaAction(card, resolvedFor(cards, card));
    updateCard(msgIndex, cardIndex, { state: result.ok ? 'done' : 'failed', result: result.message, createdId: result.createdId });
    // Tell the Rota page (if it's open) to reload so the change shows.
    if (result.ok) { try { window.dispatchEvent(new CustomEvent('wf-rota-changed')); } catch { /* old browsers */ } }
  };

  const clear = () => { setItems([]); setError(''); };

  return (
    <>
      {!open && (
        <button type="button" className="help-fab" onClick={() => setOpen(true)} aria-label="Ask WorkFleet" title="Ask how to do something, or ask it to change the rota">
          <MessageCircleQuestion size={20} aria-hidden />
          <span>Ask</span>
        </button>
      )}
      {open && (
        <div className="help-panel" role="dialog" aria-label="Ask WorkFleet">
          <div className="help-head">
            <div>
              <p className="help-title">Ask WorkFleet</p>
              <p className="help-sub">How to do things - or ask it to change the rota</p>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {items.length > 0 && <button type="button" className="help-icon" onClick={clear} aria-label="Start a new conversation" title="Start again"><RotateCcw size={16} /></button>}
              <button type="button" className="help-icon" onClick={() => setOpen(false)} aria-label="Close" title="Close"><X size={18} /></button>
            </div>
          </div>

          <div className="help-list" ref={listRef}>
            {items.length === 0 && (
              <div className="help-empty">
                <p>Ask how to do anything in WorkFleet, or ask it to book, move or change visits on the rota - it shows you each change to confirm first.</p>
                <div className="help-suggestions">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {items.map((m, i) => (m.role === 'user'
              ? <div key={i} className="help-msg is-user">{m.text}</div>
              : (
                <div key={i} className="help-msg is-ai">
                  {m.text && <Answer text={m.text} onNavigate={() => { if (window.innerWidth < 700) setOpen(false); }} />}
                  {(m.cards || []).map((c, j) => {
                    const parent = Number.isInteger(c.dependsOn) ? m.cards[c.dependsOn] : null;
                    const waiting = parent && parent.state !== 'done'
                      ? (parent.type === 'create_client' ? 'Confirm the new client first.' : 'Confirm the new site first.')
                      : null;
                    return <ActionCard key={j} card={c} waiting={waiting} onConfirm={() => confirmCard(i, j)} onDismiss={() => updateCard(i, j, { state: 'dismissed' })} />;
                  })}
                </div>
              )))}
            {busy && <div className="help-msg is-ai help-typing"><span /><span /><span /></div>}
            {error && <p className="help-error">{error}</p>}
          </div>

          <form className="help-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask a question or say what to change..."
              aria-label="Your question"
            />
            <button type="submit" className="help-send" disabled={busy || !input.trim()} aria-label="Send"><Send size={16} /></button>
          </form>
          <p className="help-foot">AI can get things wrong - check before you rely on it.</p>
        </div>
      )}
    </>
  );
}
