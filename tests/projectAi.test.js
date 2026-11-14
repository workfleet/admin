import { describe, it, expect } from 'vitest';
import {
  readableKind,
  unreadableReason,
  contentBlockFor,
  cleanTaskSuggestions,
  projectContext,
  draftPrompt,
  splitDraft,
} from '../lib/projectAi';

describe('readableKind', () => {
  it('reads PDFs, text and images, not Word', () => {
    expect(readableKind('Tender pack.PDF')).toBe('pdf');
    expect(readableKind('questions.csv')).toBe('text');
    expect(readableKind('site.jpeg')).toBe('image');
    expect(readableKind('Annex 1.docx')).toBeNull();
    expect(readableKind('no-extension')).toBeNull();
  });

  it('tells the office to save Word files as PDF', () => {
    expect(unreadableReason('Annex 1.docx')).toMatch(/PDF/);
  });
});

describe('contentBlockFor', () => {
  it('sends a PDF as a base64 document', () => {
    const block = contentBlockFor('pack.pdf', Buffer.from('%PDF-1.4'));
    expect(block.type).toBe('document');
    expect(block.source).toEqual({ type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
  });

  it('sends text as plain text', () => {
    expect(contentBlockFor('notes.txt', Buffer.from('hello')).source).toEqual({ type: 'text', media_type: 'text/plain', data: 'hello' });
  });

  it('gives nothing for a file it cannot read', () => {
    expect(contentBlockFor('a.docx', Buffer.from('x'))).toBeNull();
  });
});

describe('cleanTaskSuggestions', () => {
  it('drops impossible dates to null and keeps good ones', () => {
    const out = cleanTaskSuggestions({
      summary: 'A tender.',
      tasks: [
        { title: 'Complete Annex 2', due_date: '2026-11-26', notes: null, source: 'p4' },
        { title: 'Site visit', due_date: '2026-02-30', notes: null, source: null },
        { title: 'Insurance', due_date: 'next week', notes: null, source: null },
      ],
      dates: [
        { label: 'Submission deadline - 12:00', date: '2026-11-26', source: null },
        { label: 'Bad', date: '26/11/2026', source: null },
      ],
      warnings: [],
    });
    expect(out.tasks.map((t) => t.due_date)).toEqual(['2026-11-26', null, null]);
    expect(out.dates).toEqual([{ label: 'Submission deadline - 12:00', date: '2026-11-26', source: null }]);
  });

  it('skips tasks already on the project and repeats', () => {
    const out = cleanTaskSuggestions({
      tasks: [
        { title: 'Site visit', due_date: null },
        { title: 'Complete PSQ', due_date: null },
        { title: 'complete psq ', due_date: null },
        { title: '   ', due_date: null },
      ],
    }, ['Site Visit']);
    expect(out.tasks.map((t) => t.title)).toEqual(['Complete PSQ']);
  });

  it('copes with a missing or broken answer', () => {
    expect(cleanTaskSuggestions(null)).toEqual({ summary: '', tasks: [], dates: [], warnings: [] });
    expect(cleanTaskSuggestions({ tasks: 'nope', dates: {} }).tasks).toEqual([]);
  });
});

describe('projectContext', () => {
  it('lists the project, dates, tasks and written notes but not events', () => {
    const text = projectContext({
      project: { name: 'Bus Station', due_date: '2026-11-26', clients: { name: 'Council' } },
      tasks: [{ title: 'Pricing', status: 'done', due_date: null }],
      dates: [{ label: 'Questions close', date: '2026-11-19', done: false }],
      notes: [
        { kind: 'note', body: 'Chose Balanced pricing', created_at: '2026-11-06T10:00:00Z' },
        { kind: 'event', body: 'Task done: Pricing', created_at: '2026-11-07T10:00:00Z' },
      ],
      kindLabel: 'Tender or bid',
      ownerName: 'Jess',
      today: '2026-11-14',
    });
    expect(text).toContain('Client: Council');
    expect(text).toContain('- [x] Pricing');
    expect(text).toContain('2026-11-19 Questions close');
    expect(text).toContain('Chose Balanced pricing');
    expect(text).not.toContain('Task done');
  });
});

describe('drafts', () => {
  it('names the type and the request', () => {
    const p = draftPrompt({ draftType: 'method_statement', instruction: 'Night cleaning only', context: 'Project: X' });
    expect(p).toMatch(/Write: Method statement/);
    expect(p).toMatch(/Night cleaning only/);
  });

  it('splits off the list of placeholders', () => {
    const { body, placeholders } = splitDraft('Intro text [CONFIRM: staff numbers]\n\n---\n- [CONFIRM: staff numbers]\n- [ADD: insurance number]\n');
    expect(body).toBe('Intro text [CONFIRM: staff numbers]');
    expect(placeholders).toEqual(['[CONFIRM: staff numbers]', '[ADD: insurance number]']);
  });

  it('keeps a draft with no placeholder list whole', () => {
    expect(splitDraft('Just text.')).toEqual({ body: 'Just text.', placeholders: [] });
  });
});
