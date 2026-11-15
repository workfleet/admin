'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { localDateString } from '../../lib/localDate';
import { useToast } from './ToastProvider';
import {
  QUESTIONS, QUESTIONS_LEAD, CHOICES, OUTCOME_LABELS,
  yesAnswers, latestReviewDate, formatDay,
} from '../../lib/nightHealth';

// The office side of one night worker health questionnaire (0143): the
// answers, and the "For office use only" box. Used by /admin/night-health.

const textareaStyle = { width: '100%', resize: 'vertical' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' };

export function ReviewForm({ q, select, onSaved }) {
  const toast = useToast();
  const today = localDateString(new Date());
  const [reviewedOn, setReviewedOn] = useState(q.reviewed_on || today);
  const [outcome, setOutcome] = useState(q.outcome || '');
  const [notes, setNotes] = useState(q.office_notes || '');
  const [nextDue, setNextDue] = useState(q.next_review_due || latestReviewDate(q.reviewed_on || today));
  const [saving, setSaving] = useState(false);
  const latest = reviewedOn ? latestReviewDate(reviewedOn) : '';

  const save = async (e) => {
    e.preventDefault();
    if (!reviewedOn) { toast.error('Fill in the date reviewed.'); return; }
    if (!outcome) { toast.error('Choose the outcome.'); return; }
    if (!nextDue) { toast.error('Set the next review date.'); return; }
    if (nextDue > latest) { toast.error(`The next review must be within 12 months - by ${formatDay(latest)}.`); return; }
    setSaving(true);
    const { data, error } = await supabase.from('night_health_questionnaires')
      .update({ reviewed_on: reviewedOn, outcome, office_notes: notes.trim() || null, next_review_due: nextDue })
      .eq('id', q.id).select(select).single();
    setSaving(false);
    if (error || !data) { toast.error("Couldn't save the review. Try again in a moment."); return; }
    toast.success('Review saved.');
    onSaved(data);
  };

  return (
    <form onSubmit={save} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12, marginTop: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>For office use only</h3>
      <div style={gridStyle}>
        <div>
          <label htmlFor={`rv-on-${q.id}`}>Date reviewed</label>
          <input id={`rv-on-${q.id}`} type="date" value={reviewedOn} max={today}
            onChange={(e) => { setReviewedOn(e.target.value); if (e.target.value) setNextDue(latestReviewDate(e.target.value)); }} />
        </div>
        <div>
          <label htmlFor={`rv-out-${q.id}`}>Outcome</label>
          <select id={`rv-out-${q.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`rv-next-${q.id}`}>Next review due (within 12 months)</label>
          <input id={`rv-next-${q.id}`} type="date" value={nextDue} min={reviewedOn || undefined} max={latest || undefined}
            onChange={(e) => setNextDue(e.target.value)} />
        </div>
      </div>
      <label htmlFor={`rv-notes-${q.id}`}>Adjustments or notes</label>
      <textarea id={`rv-notes-${q.id}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={textareaStyle} />
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : q.outcome ? 'Update review' : 'Save review'}</button>
    </form>
  );
}

export function Answers({ q, reviewerName }) {
  const yes = yesAnswers(q);
  return (
    <div style={{ marginTop: 10, fontSize: 14 }}>
      <div style={gridStyle}>
        <p style={{ margin: '0 0 6px' }}><strong>Role and site:</strong> {q.role_and_site || '—'}</p>
        <p style={{ margin: '0 0 6px' }}><strong>Usual night shift pattern:</strong> {q.shift_pattern || '—'}</p>
      </div>
      <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>{QUESTIONS_LEAD}</p>
      {QUESTIONS.map((question, i) => (
        <div key={question.key} style={{ display: 'flex', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--hairline)' }}>
          <span style={{ flex: 1 }}>{i + 1}. {question.text}</span>
          <strong style={{ color: q[question.key] ? 'var(--wf-overdue)' : 'var(--muted)', width: 32, textAlign: 'right' }}>
            {q[question.key] ? 'Yes' : 'No'}
          </strong>
        </div>
      ))}
      <p style={{ margin: '10px 0 4px' }}><strong>Anything else:</strong> {q.details || '—'}</p>
      <p style={{ margin: '0 0 4px' }}><strong>Choice:</strong> {CHOICES.find((c) => c.value === q.wants_assessment)?.text}</p>
      <p style={{ margin: '0 0 4px' }}><strong>Signed:</strong> {q.signed_name}, {formatDay(q.signed_on)}</p>
      {yes.length > 0 && (
        <p style={{ margin: '8px 0 0', background: 'var(--wf-ash)', borderRadius: 8, padding: '8px 10px' }}>
          Yes to {yes.length}. If any answer suggests night work could affect their health, refer them to a qualified health professional.
        </p>
      )}
      {q.outcome && reviewerName && (
        <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>Last reviewed by {reviewerName}.</p>
      )}
    </div>
  );
}
