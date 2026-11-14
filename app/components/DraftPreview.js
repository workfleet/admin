'use client';

import { parseDraft, inlineRuns } from '../../lib/aiDrafting';

// An AI draft shown the way it will look in Word: headings, bullets, bold,
// and [CONFIRM: ...] blanks highlighted so they can't be missed.
function Inline({ text }) {
  return inlineRuns(text).map((r, i) => {
    if (r.placeholder) return <mark key={i} className="draft-blank">{r.text}</mark>;
    if (r.bold) return <strong key={i}>{r.text}</strong>;
    return <span key={i}>{r.text}</span>;
  });
}

export default function DraftPreview({ body }) {
  const blocks = parseDraft(body);
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(list); list = null; } };

  blocks.forEach((b, i) => {
    if (b.type === 'bullet' || b.type === 'numbered') {
      const tag = b.type === 'bullet' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { closeList(); list = { tag, key: i, items: [] }; }
      list.items.push(<li key={i}><Inline text={b.text} /></li>);
      return;
    }
    closeList();
    if (b.type === 'h1') out.push(<h2 key={i} className="draft-h1"><Inline text={b.text} /></h2>);
    else if (b.type === 'h2') out.push(<h3 key={i} className="draft-h2"><Inline text={b.text} /></h3>);
    else if (b.type === 'h3') out.push(<h4 key={i} className="draft-h3"><Inline text={b.text} /></h4>);
    else out.push(<p key={i}><Inline text={b.text} /></p>);
  });
  closeList();

  return (
    <div className="draft-preview">
      {out.map((item) => (item.tag
        ? (item.tag === 'ul' ? <ul key={`l${item.key}`}>{item.items}</ul> : <ol key={`l${item.key}`}>{item.items}</ol>)
        : item))}
    </div>
  );
}
