import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  checklistRooms, parseRooms, monthBounds, monthLabel, recentMonths,
  minutesOnSite, formatDuration, summariseVisits, photosToPrint, roomPromptSection,
} from '../lib/detailedReport.js';
import ReportPdfDocument from '../lib/reportPdfDocument.js';

describe('checklistRooms', () => {
  it('keeps the office order and drops repeats and blanks', () => {
    expect(checklistRooms([
      { room: 'Kitchen', task: 'a' }, { room: 'Bathroom' }, { room: 'kitchen' }, { room: ' ' }, { room: null },
    ])).toEqual(['Kitchen', 'Bathroom']);
  });
});

describe('roomPromptSection', () => {
  it('names the rooms when there is a checklist, and asks the model to find them when not', () => {
    expect(roomPromptSection({ rooms: ['Kitchen'], photoCount: 3 })).toContain('in this order: Kitchen');
    expect(roomPromptSection({ rooms: [], photoCount: 3 })).toContain('There is no room list');
  });
});

describe('parseRooms', () => {
  const ids = ['p1', 'p2', 'p3'];

  it('turns photo numbers into ids and never gives one photo to two rooms', () => {
    const rooms = parseRooms([
      { room: 'Kitchen', condition: 'good', work_done: 'Wiped', issues: 'None noted.', photos: [1, 2] },
      { room: 'Bathroom', condition: 'needs_attention', work_done: 'Scrubbed', issues: 'Mould', photos: [2, 3, 9] },
    ], ids);
    expect(rooms[0].photo_ids).toEqual(['p1', 'p2']);
    expect(rooms[1].photo_ids).toEqual(['p3']);
    expect(rooms[1].condition).toBe('needs_attention');
  });

  it('drops malformed rooms and settles unknown conditions on fair', () => {
    const rooms = parseRooms([{ room: '' }, null, { room: 'Hall', condition: 'sparkling' }], ids);
    expect(rooms).toEqual([{ room: 'Hall', condition: 'fair', work_done: '', issues: '', photo_ids: [] }]);
  });

  it('is null when the model sent nothing usable', () => {
    expect(parseRooms(undefined, ids)).toBeNull();
    expect(parseRooms([], ids)).toBeNull();
  });
});

describe('months', () => {
  it('bounds a month, including December into January', () => {
    expect(monthBounds('2026-10')).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' });
    expect(monthBounds('2026-12').end).toBe('2027-01-01T00:00:00.000Z');
    expect(monthBounds('2026-13')).toBeNull();
    expect(monthBounds('nonsense')).toBeNull();
  });

  it('labels and lists months newest first', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(recentMonths(3, new Date(2026, 0, 15))).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});

describe('time on site', () => {
  it('adds up finished check-ins only', () => {
    expect(minutesOnSite([
      { checked_in_at: '2026-10-01T09:00:00Z', checked_out_at: '2026-10-01T10:30:00Z' },
      { checked_in_at: '2026-10-01T09:00:00Z', checked_out_at: null },
      { checked_in_at: '2026-10-01T09:00:00Z', checked_out_at: '2026-10-01T09:45:00Z' },
    ])).toBe(135);
    expect(formatDuration(135)).toBe('2h 15m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(0)).toBe('—');
  });
});

// A real PNG so react-pdf actually decodes an image, the part most likely
// to throw.
const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon-192.png'));

const roomReport = {
  summary: 'Left clean and tidy.',
  issues: 'Bathroom extractor fan not working.',
  suggestions: 'Arrange an electrician.',
  template: 'detailed',
  rooms: [
    { room: 'Kitchen', condition: 'good', work_done: 'Surfaces and floor cleaned.', issues: 'None noted.', photo_ids: ['a'] },
    { room: 'Bathroom', condition: 'needs_attention', work_done: 'Descaled.', issues: 'Fan not working.', photo_ids: ['b', 'missing'] },
  ],
};

const visits = [
  { id: 'v1', scheduled_at: '2026-10-02T09:00:00Z', status: 'completed', staff: ['Ben'], minutes: 90, report: roomReport, photos: [{ id: 'a' }, { id: 'b' }] },
  { id: 'v2', scheduled_at: '2026-10-09T09:00:00Z', status: 'completed', staff: [], minutes: 0, report: null, photos: [{ id: 'c' }] },
  { id: 'v3', scheduled_at: '2026-10-16T09:00:00Z', status: 'missed', staff: ['Ben'], minutes: 0, report: null, photos: [] },
  { id: 'v4', scheduled_at: '2026-10-23T09:00:00Z', status: 'completed', staff: ['Sal'], minutes: 60, report: { summary: 'Standard clean.', issues: 'None.', suggestions: 'None.', template: 'standard', rooms: null }, photos: [] },
];

const property = { address: '7 Clarice Street, Aberavon', clients: { name: 'TKR Management' } };
const photos = ['a', 'b', 'c'].map((id) => ({ id, data: png, format: 'png' }));

describe('summariseVisits and photosToPrint', () => {
  it('counts the month and lists rooms needing attention', () => {
    const s = summariseVisits(visits);
    expect(s).toMatchObject({ visitCount: 3, missedCount: 1, minutes: 150, reportCount: 2 });
    expect(s.roomsNeedingAttention).toEqual([{ date: '2026-10-02T09:00:00Z', room: 'Bathroom', issues: 'Fan not working.' }]);
  });

  it('prints room photos for a room report and the latest photos otherwise', () => {
    expect(photosToPrint(visits[0]).map((p) => p.id)).toEqual(['a', 'b']);
    expect(photosToPrint(visits[1]).map((p) => p.id)).toEqual(['c']);
  });
});

describe('ReportPdfDocument', () => {
  it('renders a month with room reports, a plain report, no report and a missed visit', async () => {
    const buffer = await renderToBuffer(createElement(ReportPdfDocument, {
      property, visits, month: '2026-10', photos, printed: new Map([['v2', ['c']]]),
    }));
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a single visit, and an empty month', async () => {
    const one = await renderToBuffer(createElement(ReportPdfDocument, { property, visits: [visits[0]], photos }));
    expect(one.subarray(0, 4).toString()).toBe('%PDF');
    const none = await renderToBuffer(createElement(ReportPdfDocument, { property, visits: [], month: '2026-10' }));
    expect(none.subarray(0, 4).toString()).toBe('%PDF');
  });
});
