'use client';

import {
  INTRO, QUESTIONS_LEAD, QUESTIONS, DETAILS_PROMPT, CHOICES,
} from '../../lib/nightHealth';

// The questionnaire itself, worded as the Word form. State lives in the
// page (app/cleaner/night-health); this only draws it.

const textareaStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
  background: 'var(--wf-ash)', fontSize: 15, fontFamily: 'inherit', marginBottom: 10, resize: 'vertical',
};
const sectionTitle = { margin: '0 0 8px', fontSize: 17 };
const tickStyle = { width: 20, height: 20, margin: '1px 0 0', padding: 0, flexShrink: 0 };

function YesNo({ value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? '' : 'btn-secondary'}
          onClick={() => onChange(v)}
          style={{ minWidth: 58, padding: '8px 12px' }}
        >
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  );
}

export default function NightHealthForm({ form, onChange, problems = [], saveError = '', saving = false, onSubmit, onCancel }) {
  const setAnswer = (key, v) => onChange({ answers: { ...form.answers, [key]: v } });
  return (
    <form onSubmit={onSubmit}>
      <div className="card">
        <h2 style={sectionTitle}>Free health assessment for night workers</h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, margin: 0 }}>{INTRO}</p>
      </div>

      <div className="card">
        <h2 style={sectionTitle}>Your details</h2>
        <label htmlFor="nh-role">Role and site</label>
        <input id="nh-role" value={form.roleAndSite} onChange={(e) => onChange({ roleAndSite: e.target.value })} placeholder="e.g. Cleaner, Swansea Bus Station" />
        <label htmlFor="nh-pattern">Usual night shift pattern</label>
        <input id="nh-pattern" value={form.shiftPattern} onChange={(e) => onChange({ shiftPattern: e.target.value })} placeholder="e.g. Mon–Fri, 10pm–6am" />
      </div>

      <div className="card">
        <h2 style={sectionTitle}>Your health</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          Tap Yes or No. If you answer Yes, add any detail you are happy to share in the box at the end.
        </p>
        <p style={{ fontSize: 14.5, fontWeight: 600, margin: '0 0 4px' }}>{QUESTIONS_LEAD}</p>
        {QUESTIONS.map((q, i) => (
          <div key={q.key} className="task-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 200px', fontSize: 14.5 }}>{i + 1}. {q.text}</span>
            <YesNo value={form.answers[q.key]} onChange={(v) => setAnswer(q.key, v)} label={q.text} />
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={sectionTitle}>Anything else</h2>
        <label htmlFor="nh-details" style={{ fontWeight: 400 }}>{DETAILS_PROMPT}</label>
        <textarea id="nh-details" rows={4} value={form.details} onChange={(e) => onChange({ details: e.target.value })} style={textareaStyle} />
      </div>

      <div className="card">
        <h2 style={sectionTitle}>Your choice</h2>
        {CHOICES.map((c) => (
          <label key={String(c.value)} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400, fontSize: 14.5, padding: '8px 0' }}>
            <input
              type="radio"
              name="nh-choice"
              checked={form.wantsAssessment === c.value}
              onChange={() => onChange({ wantsAssessment: c.value })}
              style={tickStyle}
            />
            {c.text}
          </label>
        ))}
      </div>

      <div className="card">
        <h2 style={sectionTitle}>Signature</h2>
        <label htmlFor="nh-sign">Type your full name</label>
        <input id="nh-sign" value={form.signedName} onChange={(e) => onChange({ signedName: e.target.value })} autoComplete="name" />
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          Date: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400, fontSize: 14.5 }}>
          <input
            type="checkbox"
            checked={form.confirmed}
            onChange={(e) => onChange({ confirmed: e.target.checked })}
            style={tickStyle}
          />
          My answers are true to the best of my knowledge.
        </label>

        {problems.length > 0 && (
          <p role="alert" style={{ fontSize: 14, color: 'var(--wf-overdue)', margin: '12px 0 0' }}>
            Before sending: {problems.join('; ')}.
          </p>
        )}
        {saveError && <p role="alert" style={{ fontSize: 14, color: 'var(--wf-overdue)', margin: '12px 0 0' }}>{saveError}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="submit" disabled={saving} style={{ flex: 1 }}>{saving ? 'Sending…' : 'Send to the office'}</button>
          {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0' }}>
          Only you and the office admins handling health assessments can see your answers. They are not added to your staff record.
        </p>
      </div>
    </form>
  );
}
