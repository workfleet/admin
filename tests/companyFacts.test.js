import { describe, it, expect } from 'vitest';
import { FACT_KEYS, factsMap, factsFilled, factsContext, neverClaimRule } from '../lib/companyFacts';
import { draftSystem, cleanPlan, answersText, blanksIn, fillBlank, PLAN_SCHEMA, MAX_QUESTIONS, DOC_TYPES } from '../lib/aiDrafting';

describe('company facts', () => {
  it('keeps known keys with something in them', () => {
    const map = factsMap([
      { key: 'insurance', value: ' £10m public liability ' },
      { key: 'areas', value: '   ' },
      { key: 'made_up', value: 'x' },
    ]);
    expect(map).toEqual({ insurance: '£10m public liability' });
    expect(factsFilled(map)).toBe(1);
  });

  it('has unique keys', () => {
    expect(new Set(FACT_KEYS).size).toBe(FACT_KEYS.length);
  });

  it('gives the AI the facts but keeps never-claim out of them', () => {
    const text = factsContext({ insurance: '£10m', never_claim: 'ISO 9001' });
    expect(text).toContain('£10m');
    expect(text).not.toContain('ISO 9001');
    expect(factsContext({})).toBe('');
  });

  it('turns never-claim into a rule in the system prompt', () => {
    expect(neverClaimRule({})).toBe('');
    const s = draftSystem({ name: 'Acme' }, { never_claim: 'ISO 9001 certification', signoff_name: 'Jess', signoff_title: 'Director', style: 'Friendly' });
    expect(s).toContain('NEVER claim');
    expect(s).toContain('ISO 9001 certification');
    expect(s).toContain('signed by Jess, Director');
    expect(s).toContain('House style: Friendly');
  });
});

describe('ask before writing', () => {
  const clients = [{ id: 'c1', name: 'Example Offices Ltd' }, { id: 'c2', name: 'Council' }];

  it('matches the client back to an id and caps the questions', () => {
    const plan = cleanPlan({
      doc_type: 'complaint_reply',
      client_name: 'example offices ltd',
      title: 'Reply to Sam',
      questions: [1, 2, 3, 4, 5, 6].map((n) => ({ question: `Q${n}?`, hint: null })),
    }, clients);
    expect(plan.doc_type).toBe('complaint_reply');
    expect(plan.client_id).toBe('c1');
    expect(plan.questions).toHaveLength(MAX_QUESTIONS);
  });

  it('falls back safely on an unknown type or client', () => {
    const plan = cleanPlan({ doc_type: 'novel', client_name: 'Someone Else', title: '', questions: [{ question: '  ' }] }, clients);
    expect(plan).toEqual({ doc_type: 'free', client_id: null, client_name: null, title: 'Something else', questions: [] });
  });

  it('only allows real document types in the schema', () => {
    expect(PLAN_SCHEMA.properties.doc_type.enum).toEqual(DOC_TYPES.map((t) => t.value));
  });

  it('lists answers and marks skipped ones for a blank', () => {
    const t = answersText([{ question: 'When can you re-clean?' }, { question: 'Who signs it?' }], ['Thursday 6pm', '']);
    expect(t).toContain('When can you re-clean? Thursday 6pm');
    expect(t).toContain('Who signs it? (not answered');
    expect(answersText([], [])).toBe('');
  });
});

describe('blanks', () => {
  const body = 'We will come on [CONFIRM: day]. Again: [CONFIRM: day]. Signed [ADD: name].';

  it('finds each blank once', () => {
    expect(blanksIn(body)).toEqual(['[CONFIRM: day]', '[ADD: name]']);
    expect(blanksIn('nothing')).toEqual([]);
  });

  it('fills every copy of a blank', () => {
    const filled = fillBlank(body, '[CONFIRM: day]', 'Thursday');
    expect(filled).toBe('We will come on Thursday. Again: Thursday. Signed [ADD: name].');
    expect(blanksIn(filled)).toEqual(['[ADD: name]']);
  });

  it('ignores an empty answer', () => {
    expect(fillBlank(body, '[ADD: name]', '  ')).toBe(body);
  });
});
