'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Pencil, Check } from 'lucide-react';
import { blanksIn, fillBlank, plainText } from '../../lib/aiDrafting';
import DraftPreview from './DraftPreview';
import { useConfirm } from './ConfirmProvider';

// A draft you can finish on the page: fill each [CONFIRM: ...] blank once
// and every copy of it is replaced, or edit the text directly. Download
// warns while any blank is left, so one can't slip out to a client.
//
// props:
//   body, onChange(body)  - the draft text, kept by the parent
//   onDownload(body)      - make the Word file
//   extraActions          - more buttons (e.g. Save to project)
export default function DraftEditor({ body, onChange, onDownload, extraActions }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const [answers, setAnswers] = useState({});
  const [copied, setCopied] = useState(false);
  const inputs = useRef({});

  useEffect(() => { setText(body); }, [body]);

  const blanks = blanksIn(body);

  const fill = (blank) => {
    const value = (answers[blank] || '').trim();
    if (!value) return;
    onChange(fillBlank(body, blank, value));
    setAnswers((a) => { const n = { ...a }; delete n[blank]; return n; });
  };

  const jumpTo = (blank) => {
    const el = inputs.current[blank];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  };

  const finishEditing = () => {
    setEditing(false);
    if (text !== body) onChange(text);
  };

  const download = async () => {
    const current = editing ? text : body;
    const left = blanksIn(current).length;
    if (left && !(await confirm(`${left} blank${left === 1 ? ' is' : 's are'} still not filled in. Download anyway?`))) return;
    if (editing) finishEditing();
    onDownload(current);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(plainText(editing ? text : body)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };

  return (
    <div className="draft-editor">
      <div className="draft-editor-bar">
        <p className="pj-ai-badge" style={{ margin: 0 }}>AI draft - check every fact before you use it</p>
        <button type="button" className="pj-text-btn" onClick={() => (editing ? finishEditing() : setEditing(true))}>
          {editing ? <><Check size={14} aria-hidden /> Done editing</> : <><Pencil size={14} aria-hidden /> Edit the text</>}
        </button>
      </div>

      {editing ? (
        <>
          <textarea className="draft-textarea" value={text} onChange={(e) => setText(e.target.value)} rows={22} aria-label="Draft text" />
          <p className="pj-muted ai-hint" style={{ marginTop: 6 }}># makes a heading, - makes a bullet, **like this** makes bold.</p>
        </>
      ) : (
        <DraftPreview body={body} onBlankClick={jumpTo} />
      )}

      {!editing && blanks.length > 0 && (
        <div className="draft-blanks">
          <h3 className="pj-ai-subhead">Fill in the blanks ({blanks.length} left)</h3>
          {blanks.map((blank) => (
            <form key={blank} className="draft-blank-row" onSubmit={(e) => { e.preventDefault(); fill(blank); }}>
              <label htmlFor={`blank-${blank}`}>{blank.replace(/^\[(CONFIRM|ADD|CHECK):?\s*/, '').replace(/\]$/, '')}</label>
              <div className="ai-revise-row">
                <input
                  id={`blank-${blank}`}
                  ref={(el) => { inputs.current[blank] = el; }}
                  value={answers[blank] || ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [blank]: e.target.value }))}
                  placeholder="Type the answer"
                />
                <button type="submit" className="btn-secondary" disabled={!(answers[blank] || '').trim()}>Fill in</button>
              </div>
            </form>
          ))}
        </div>
      )}
      {!editing && blanks.length === 0 && <p className="draft-done"><Check size={15} aria-hidden /> No blanks left.</p>}

      <div className="ai-actions">
        <button type="button" className="btn-primary" onClick={download}><Download size={15} aria-hidden /> Download Word</button>
        <button type="button" className="btn-secondary" onClick={copy}><Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy text'}</button>
        {extraActions}
      </div>
    </div>
  );
}
