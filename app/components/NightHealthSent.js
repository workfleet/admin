'use client';

import { QUESTIONS, OUTCOME_LABELS, yesAnswers, formatDay } from '../../lib/nightHealth';

// A cleaner's own questionnaires, newest first, with the office's outcome.
export default function NightHealthSent({ rows, onFillAgain }) {
  return (
    <div className="card">
      <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Sent</h2>
      {rows.map((q) => {
        const yes = yesAnswers(q).length;
        return (
          <div key={q.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>Sent {formatDay(q.signed_on)}</strong>
              <span className={`badge ${q.outcome ? 'completed' : 'scheduled'}`}>
                {q.outcome ? 'Reviewed' : 'With the office'}
              </span>
            </div>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {q.wants_assessment ? 'You asked for a health assessment.' : "You didn't want an assessment at the time."}
              {' '}{yes === 0 ? 'No to every question.' : `Yes to ${yes} of ${QUESTIONS.length}.`}
            </span>
            {q.outcome && (
              <span style={{ fontSize: 13.5 }}>
                {OUTCOME_LABELS[q.outcome]}{q.reviewed_on ? `, ${formatDay(q.reviewed_on)}` : ''}.
                {q.next_review_due ? ` Next review due by ${formatDay(q.next_review_due)}.` : ''}
              </span>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '10px 0' }}>
        You can ask for a health assessment at any time, or fill this in again if anything has changed.
      </p>
      <button type="button" className="btn-secondary" onClick={onFillAgain}>Fill it in again</button>
    </div>
  );
}
