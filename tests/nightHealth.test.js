import { describe, it, expect } from 'vitest';
import {
  QUESTIONS, COLUMNS, emptyAnswers, formProblems, rowFromForm, yesAnswers,
  latestReviewDate, standing, shouldPrompt, latestByPerson,
} from '../lib/nightHealth';

const allNo = () => Object.fromEntries(QUESTIONS.map((q) => [q.key, false]));
const goodForm = () => ({
  roleAndSite: ' Cleaner, Bus Station ', shiftPattern: '', answers: allNo(), details: '  ',
  wantsAssessment: true, signedName: ' Chris Example ', confirmed: true,
});

describe('night worker questionnaire', () => {
  it('has the twelve questions from the Word form, each a column', () => {
    expect(QUESTIONS).toHaveLength(12);
    for (const q of QUESTIONS) expect(COLUMNS).toContain(q.key);
  });

  it('asks for every answer, the choice, a signature and the tick', () => {
    expect(formProblems(goodForm())).toEqual([]);
    const blank = { answers: emptyAnswers(), wantsAssessment: null, signedName: '', confirmed: false };
    expect(formProblems(blank)).toEqual([
      'answer Yes or No to 12 more questions',
      'choose whether you would like a health assessment',
      'type your name to sign it',
      'tick the box to confirm your answers',
    ]);
    const oneLeft = { ...goodForm(), answers: { ...allNo(), sleep: null } };
    expect(formProblems(oneLeft)).toEqual(['answer Yes or No to one more question']);
  });

  it('accepts "No" to wanting an assessment', () => {
    expect(formProblems({ ...goodForm(), wantsAssessment: false })).toEqual([]);
  });

  it('builds the row without office fields, trimming text', () => {
    const row = rowFromForm('u1', { ...goodForm(), answers: { ...allNo(), sleep: true } });
    expect(row.profile_id).toBe('u1');
    expect(row.role_and_site).toBe('Cleaner, Bus Station');
    expect(row.shift_pattern).toBeNull();
    expect(row.details).toBeNull();
    expect(row.signed_name).toBe('Chris Example');
    expect(row.sleep).toBe(true);
    expect(row).not.toHaveProperty('outcome');
    expect(row).not.toHaveProperty('reviewed_by');
    expect(yesAnswers(row).map((q) => q.key)).toEqual(['sleep']);
  });

  it('puts the next review at most twelve months on', () => {
    expect(latestReviewDate('2026-11-15')).toBe('2027-11-15');
    expect(latestReviewDate('2028-02-29')).toBe('2029-02-28');
  });

  it('works out where someone stands', () => {
    const today = '2026-11-15';
    expect(standing(null, today)).toBe('none');
    expect(standing({ outcome: null }, today)).toBe('waiting');
    expect(standing({ outcome: 'fit', next_review_due: '2027-11-15' }, today)).toBe('done');
    expect(standing({ outcome: 'fit', next_review_due: '2026-11-15' }, today)).toBe('due');
  });

  it('prompts night workers who have none or are due, nobody else', () => {
    const today = '2026-11-15';
    expect(shouldPrompt(false, null, today)).toBe(false);
    expect(shouldPrompt(true, null, today)).toBe(true);
    expect(shouldPrompt(true, { outcome: null }, today)).toBe(false);
    expect(shouldPrompt(true, { outcome: 'fit', next_review_due: '2026-11-01' }, today)).toBe(true);
  });

  it('keeps the newest per person', () => {
    const rows = [
      { id: 'a', profile_id: 'p', submitted_at: '2026-01-01T00:00:00Z' },
      { id: 'b', profile_id: 'p', submitted_at: '2026-06-01T00:00:00Z' },
      { id: 'c', profile_id: 'q', submitted_at: '2026-03-01T00:00:00Z' },
    ];
    const latest = latestByPerson(rows);
    expect(latest.p.id).toBe('b');
    expect(latest.q.id).toBe('c');
  });
});
