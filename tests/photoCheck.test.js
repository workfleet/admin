import { describe, it, expect } from 'vitest';
import {
  areasForJob,
  buildPhotoCheckPrompt,
  normalisePhotoCheck,
  parsePhotoCheckText,
  missingAreas,
  runPhotoCheck,
} from '../lib/photoCheck';

// The check stands between a cleaner and the door. If it names the wrong
// room, or lets a missing one through, it is either a nuisance they learn to
// click past or a gate that guards nothing.

describe('areasForJob', () => {
  it('uses the checklist rooms, in order, with their tasks as detail', () => {
    const items = [
      { room: 'Kitchen', task: 'Wipe surfaces', sort_order: 1 },
      { room: 'Kitchen', task: 'Empty bin', sort_order: 2 },
      { room: 'Bathroom', task: 'Clean toilet', sort_order: 3 },
    ];
    expect(areasForJob(items, [{ description: 'Ignored' }])).toEqual([
      { area: 'Kitchen', details: ['Wipe surfaces', 'Empty bin'] },
      { area: 'Bathroom', details: ['Clean toilet'] },
    ]);
  });

  it('trims and skips blank rooms', () => {
    expect(areasForJob([{ room: '  Hall ', task: '' }, { room: '', task: 'x' }], [])).toEqual([
      { area: 'Hall', details: [] },
    ]);
  });

  it('falls back to the to-do list when there is no checklist', () => {
    expect(areasForJob([], [{ description: 'Hoover stairs' }, { description: '' }])).toEqual([
      { area: 'Hoover stairs', details: [] },
    ]);
  });

  it('is empty when there is nothing to check against', () => {
    expect(areasForJob([], [])).toEqual([]);
    expect(areasForJob(null, null)).toEqual([]);
  });
});

describe('normalisePhotoCheck', () => {
  const areas = [{ area: 'Kitchen', details: [] }, { area: 'Bathroom', details: [] }];

  it('keeps every requested area, in order, matched case-insensitively', () => {
    const raw = { areas: [{ area: 'bathroom', covered: true, note: '' }, { area: 'KITCHEN', covered: false, note: ' bin full ' }], summary: ' ok ' };
    expect(normalisePhotoCheck(raw, areas)).toEqual({
      areas: [
        { area: 'Kitchen', covered: false, note: 'bin full' },
        { area: 'Bathroom', covered: true, note: '' },
      ],
      summary: 'ok',
    });
  });

  it('treats an area the model forgot as not covered', () => {
    // A room the model never mentioned must not pass by omission.
    const raw = { areas: [{ area: 'Kitchen', covered: true, note: '' }], summary: '' };
    expect(normalisePhotoCheck(raw, areas).areas[1]).toEqual({ area: 'Bathroom', covered: false, note: '' });
  });

  it('drops areas that were not asked about', () => {
    const raw = { areas: [{ area: 'Garage', covered: true, note: '' }], summary: '' };
    expect(normalisePhotoCheck(raw, areas).areas.map((a) => a.area)).toEqual(['Kitchen', 'Bathroom']);
  });

  it('only counts an explicit true as covered', () => {
    const raw = { areas: [{ area: 'Kitchen', covered: 'yes', note: '' }, { area: 'Bathroom', covered: 1, note: '' }], summary: '' };
    expect(normalisePhotoCheck(raw, areas).areas.every((a) => a.covered === false)).toBe(true);
  });

  it('survives a malformed answer', () => {
    expect(normalisePhotoCheck(null, areas).areas.length).toBe(2);
    expect(normalisePhotoCheck({ areas: 'nope' }, areas).summary).toBe('');
  });
});

describe('parsePhotoCheckText', () => {
  it('reads plain JSON and fenced JSON alike', () => {
    expect(parsePhotoCheckText('{"areas":[],"summary":"x"}').summary).toBe('x');
    expect(parsePhotoCheckText('```json\n{"areas":[],"summary":"y"}\n```').summary).toBe('y');
  });

  it('throws on anything else', () => {
    expect(() => parsePhotoCheckText('Sure! Here is the JSON')).toThrow();
  });
});

describe('missingAreas', () => {
  it('names the areas without a photo', () => {
    expect(missingAreas({ areas: [{ area: 'A', covered: true }, { area: 'B', covered: false }] })).toEqual(['B']);
    expect(missingAreas(null)).toEqual([]);
  });
});

describe('buildPhotoCheckPrompt', () => {
  it('lists the areas with their detail and the photo count', () => {
    const prompt = buildPhotoCheckPrompt({
      address: '1 High St',
      areas: [{ area: 'Kitchen', details: ['Wipe surfaces', 'Empty bin'] }, { area: 'Hall', details: [] }],
      photoCount: 3,
    });
    expect(prompt).toContain('1 High St');
    expect(prompt).toContain('3 photo(s)');
    expect(prompt).toContain('1. Kitchen (Wipe surfaces; Empty bin)');
    expect(prompt).toContain('2. Hall\n');
  });
});

describe('runPhotoCheck', () => {
  const areas = [{ area: 'Kitchen', details: [] }];
  const fakeClient = (message) => ({ messages: { create: async () => message } });

  it('returns a normalised result from the model text', async () => {
    const client = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"areas":[{"area":"Kitchen","covered":true,"note":""}],"summary":"All good."}' }],
    });
    const out = await runPhotoCheck({ client, address: 'x', areas, imageBlocks: [] });
    expect(out).toEqual({ ok: true, result: { areas: [{ area: 'Kitchen', covered: true, note: '' }], summary: 'All good.' } });
  });

  it('reports a refusal rather than pretending everything is covered', async () => {
    const client = fakeClient({ stop_reason: 'refusal', content: [] });
    expect(await runPhotoCheck({ client, address: 'x', areas, imageBlocks: [] })).toEqual({ ok: false, reason: 'refusal' });
  });

  it('reports an unparseable answer', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] });
    expect(await runPhotoCheck({ client, address: 'x', areas, imageBlocks: [] })).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('sends the schema and the images with the prompt', async () => {
    let captured;
    const client = { messages: { create: async (params) => { captured = params; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"areas":[],"summary":""}' }] }; } } };
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } };
    await runPhotoCheck({ client, address: 'x', areas, imageBlocks: [image] });
    expect(captured.model).toBe('claude-opus-5');
    expect(captured.output_config.format.type).toBe('json_schema');
    expect(captured.messages[0].content[1]).toBe(image);
  });
});
