import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NightHealthForm from '../app/components/NightHealthForm';
import NightHealthSent from '../app/components/NightHealthSent';
import { Answers, ReviewForm } from '../app/components/NightHealthReview';
import { ToastProvider } from '../app/components/ToastProvider';
import { QUESTIONS, emptyAnswers } from '../lib/nightHealth';

// The pages render behind a login, so nothing else runs these. Render each
// piece once with the shapes the pages hand them, so a crash on render is
// caught here rather than on a cleaner's phone.

const row = {
  id: 'q1', profile_id: 'p1', role_and_site: 'Cleaner, Bus Station', shift_pattern: 'Mon–Fri 10pm–6am',
  ...Object.fromEntries(QUESTIONS.map((q) => [q.key, q.key === 'sleep'])),
  details: 'Some trouble sleeping in summer.', wants_assessment: true,
  signed_name: 'Chris Example', signed_on: '2026-11-15', submitted_at: '2026-11-15T10:00:00Z',
  reviewed_by: null, reviewed_on: null, outcome: null, office_notes: null, next_review_due: null,
  person: { full_name: 'Chris Example' },
};

describe('night health questionnaire renders', () => {
  it('draws every question from the Word form, blank', () => {
    const form = {
      roleAndSite: '', shiftPattern: '', answers: emptyAnswers(), details: '',
      wantsAssessment: null, signedName: 'Chris', confirmed: false,
    };
    const html = renderToStaticMarkup(createElement(NightHealthForm, {
      form, onChange: () => {}, onSubmit: () => {}, problems: ['tick the box to confirm your answers'],
    }));
    for (const q of QUESTIONS) expect(html).toContain(q.text.replace(/'/g, '&#x27;'));
    expect(html).toContain('Working Time Regulations 1998');
    expect(html).toContain('I would like a health assessment');
    expect(html).toContain('Before sending: tick the box');
  });

  it("draws a cleaner's sent list, before and after review", () => {
    const reviewed = { ...row, id: 'q2', outcome: 'fit', reviewed_on: '2026-11-16', next_review_due: '2027-11-16' };
    const html = renderToStaticMarkup(createElement(NightHealthSent, { rows: [reviewed, row], onFillAgain: () => {} }));
    expect(html).toContain('With the office');
    expect(html).toContain('Fit for night work');
    expect(html).toContain('Yes to 1 of 12');
  });

  it("draws the office's view and review box", () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(Answers, { q: row, reviewerName: null }),
      createElement(ReviewForm, { q: row, select: 'id', onSaved: () => {} })));
    expect(html).toContain('Some trouble sleeping');
    expect(html).toContain('For office use only');
    expect(html).toContain('Referred to a health professional');
  });
});
