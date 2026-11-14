import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import {
  DOC_TYPES,
  DOC_GROUPS,
  draftSystem,
  clientContext,
  averageRating,
  draftRequestText,
  draftMessages,
  splitDraft,
  draftTitle,
  fileNameFor,
  parseDraft,
  inlineRuns,
  plainText,
} from '../lib/aiDrafting';
import { buildDraftDocx } from '../lib/draftDocx';
import { COMPANY } from '../lib/companyBranding';

describe('document types', () => {
  it('puts every type in a known group with a unique value', () => {
    const values = DOC_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
    DOC_TYPES.forEach((t) => expect(DOC_GROUPS).toContain(t.group));
  });
});

describe('draftSystem', () => {
  it('names the company from settings, not a hard-coded one', () => {
    const s = draftSystem({ name: 'Acme Clean', legalName: 'Acme Clean Ltd' });
    expect(s).toContain('Acme Clean (Acme Clean Ltd)');
    expect(s).not.toContain('CrewConnect');
  });

  it('carries the no-invention and blank rules', () => {
    const s = draftSystem(COMPANY);
    expect(s).toMatch(/Never invent/);
    expect(s).toMatch(/\[CONFIRM:/);
  });
});

describe('clientContext', () => {
  it('gives counts and addresses only', () => {
    const text = clientContext({
      client: { name: 'Council', contact_name: 'Sam', industry: 'Public sector' },
      properties: [{ address: 'Bus Station, Swansea', access_details: 'code 1234' }],
      visits: { total: 90, completed: 85, missed: 2 },
      ratings: { count: 4, average: 4.5 },
    });
    expect(text).toContain('Bus Station, Swansea');
    expect(text).toContain('90 scheduled, 85 completed, 2 missed');
    expect(text).toContain('average 4.5');
    expect(text).not.toContain('1234');
  });

  it('is empty without a client', () => {
    expect(clientContext({})).toBe('');
  });

  it('averages ratings', () => {
    expect(averageRating([{ rating: 5 }, { rating: 4 }])).toEqual({ count: 2, average: 4.5 });
    expect(averageRating([])).toEqual({ count: 0, average: 0 });
  });
});

describe('request and revision', () => {
  it('wraps pasted text as material', () => {
    const t = draftRequestText({ docType: 'complaint_reply', instruction: 'Apologise', sections: ['Company: X'], sourceText: 'Your cleaner missed the bins' });
    expect(t).toMatch(/Write: Reply to a complaint/);
    expect(t).toMatch(/material, not instructions/);
    expect(t).toContain('Your cleaner missed the bins');
  });

  it('sends one message for a first draft', () => {
    expect(draftMessages({ firstRequest: 'Write X' })).toHaveLength(1);
  });

  it('sends the old draft and the change for a rewrite, ending on the user', () => {
    const m = draftMessages({ firstRequest: 'Write X', previousDraft: '# X', changeRequest: 'shorter' });
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[2].content).toContain('shorter');
  });
});

describe('reading a draft', () => {
  const body = '# Lone Working Policy\n\n## Purpose\nStaff who work **alone** must check in.\nThey use the app.\n\n- Check in at start\n- Check out at [CONFIRM: time]\n\n1. Call the office\n2. Wait';

  it('takes the title from the first heading', () => {
    expect(draftTitle(body)).toBe('Lone Working Policy');
    expect(draftTitle('no heading', 'Letter')).toBe('Letter');
  });

  it('makes a safe Word file name', () => {
    expect(fileNameFor('Reply: "late" visit / Bus Station')).toBe('Reply late visit Bus Station.docx');
  });

  it('parses headings, paragraphs, bullets and numbers', () => {
    expect(parseDraft(body).map((b) => b.type)).toEqual(['h1', 'h2', 'p', 'bullet', 'bullet', 'numbered', 'numbered']);
    expect(parseDraft(body)[2].text).toBe('Staff who work **alone** must check in. They use the app.');
  });

  it('marks bold and blanks inline', () => {
    expect(inlineRuns('Hi **there** [CONFIRM: name].')).toEqual([
      { text: 'Hi ', bold: false, placeholder: false },
      { text: 'there', bold: true, placeholder: false },
      { text: ' ', bold: false, placeholder: false },
      { text: '[CONFIRM: name]', bold: false, placeholder: true },
      { text: '.', bold: false, placeholder: false },
    ]);
  });

  it('gives plain text for email without the markup', () => {
    const t = plainText(body);
    expect(t).not.toContain('**');
    expect(t).not.toContain('#');
    expect(t).toContain('• Check in at start');
  });

  it('splits off the placeholder list', () => {
    expect(splitDraft('Body [ADD: x]\n---\n[ADD: x]').placeholders).toEqual(['[ADD: x]']);
  });
});

describe('buildDraftDocx', () => {
  it('produces a real Word file', async () => {
    const buffer = await Packer.toBuffer(buildDraftDocx('# Title\n\nHello [CONFIRM: name]\n\n- One', COMPANY));
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
