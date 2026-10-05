import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  checklistRooms, parseDetailedReport, monthBounds, monthLabel, recentMonths,
  minutesOnSite, formatDuration, summariseVisits, photosToPrint, buildDetailedPrompt,
  photoTimeline, shortAddress, isSafetyCheck, roomPhotos,
} from '../lib/detailedReport.js';
import ReportPdfDocument from '../lib/reportPdfDocument.js';

describe('checklistRooms', () => {
  it('keeps the office order and drops repeats and blanks', () => {
    expect(checklistRooms([
      { room: 'Kitchen', task: 'a' }, { room: 'Bathroom' }, { room: 'kitchen' }, { room: ' ' }, { room: null },
    ])).toEqual(['Kitchen', 'Bathroom']);
  });
});

describe('photoTimeline', () => {
  it('times each photo against arrival and leaving, so before and after can be told apart', () => {
    const t = photoTimeline(
      [{ created_at: '2026-10-05T10:55:00Z' }, { created_at: '2026-10-05T12:17:00Z' }, {}],
      [{ checked_in_at: '2026-10-05T10:39:00Z', checked_out_at: '2026-10-05T12:40:00Z' }],
    );
    expect(t.arrived).toBe('11:39');
    expect(t.left).toBe('13:40');
    expect(t.lines[0]).toBe('Photo 1: 11:55, 16 min after arriving, 105 min before leaving');
    expect(t.lines[1]).toContain('23 min before leaving');
    expect(t.lines[2]).toBe('Photo 3: time not recorded');
  });
});

describe('buildDetailedPrompt', () => {
  const base = { address: '7 Clarice Street', date: 'Monday', staff: ['Laura'], timeline: { arrived: '11:00', left: '12:00', lines: ['Photo 1: 11:05'] }, taskList: '- [x] Kitchen - Mop', notes: '', photoCount: 1 };
  it('names the checklist areas when there are some, and asks the model to find them when not', () => {
    expect(buildDetailedPrompt({ ...base, rooms: ['Fire alarm panel', 'Kitchen'] })).toContain('in this order: Fire alarm panel, Kitchen');
    expect(buildDetailedPrompt({ ...base, rooms: [] })).toContain('There is no checklist');
  });
  it('covers the checks TKR asked for', () => {
    const p = buildDetailedPrompt({ ...base, rooms: [] });
    expect(p).toMatch(/Fire alarm panel/);
    expect(p).toMatch(/Fire doors/);
    expect(p).toMatch(/Bins/);
  });
});

describe('parseDetailedReport', () => {
  const ids = ['p1', 'p2', 'p3', 'p4'];

  it('turns photo numbers into ids with captions, before and after, never one photo twice', () => {
    const out = parseDetailedReport({
      photos: [{ number: 1, shows: 'Kitchen worktops piled with dishes', when: 'before' }, { number: 2, shows: 'Kitchen cleared', when: 'after' }],
      summary: 'Left clean.', landlord: 'None.', housekeeping: 'Kitchen: dishes left out.',
      rooms: [
        { room: 'Kitchen', condition: 'good', on_arrival: 'Dishes piled up.', work_done: 'Cleared and mopped.', issues: '', before_photos: [1], after_photos: [2] },
        { room: 'Hallway', condition: 'good', on_arrival: '', work_done: 'Hoovered.', issues: '', before_photos: [], after_photos: [2, 3, 9] },
      ],
    }, ids);
    expect(out.rooms[0].before).toEqual([{ id: 'p1', caption: 'Kitchen worktops piled with dishes' }]);
    expect(out.rooms[0].after).toEqual([{ id: 'p2', caption: 'Kitchen cleared' }]);
    expect(out.rooms[0].photo_ids).toEqual(['p2', 'p1']);
    expect(out.rooms[1].after.map((p) => p.id)).toEqual(['p3']);
    expect(out.landlord).toBe('None.');
    expect(out.housekeeping).toBe('Kitchen: dishes left out.');
  });

  it('drops malformed rooms, and a room with no photo and no valid condition is "no photo taken"', () => {
    const out = parseDetailedReport({ rooms: [{ room: '' }, null, { room: 'Bins', condition: 'sparkling' }] }, ids);
    expect(out.rooms).toHaveLength(1);
    expect(out.rooms[0].condition).toBe('not_photographed');
  });

  it('gives no rooms when the model sent nothing usable', () => {
    expect(parseDetailedReport({}, ids).rooms).toBeNull();
  });
});

describe('roomPhotos', () => {
  it('reads the first room-by-room reports, which had photos but no before/after', () => {
    expect(roomPhotos({ photo_ids: ['a'] })).toEqual({ before: [], after: [{ id: 'a', caption: '' }] });
  });
});

describe('isSafetyCheck', () => {
  it('picks out the fire alarm panel, fire doors and bins', () => {
    expect(['Fire alarm panel', 'Fire doors', 'Bins', 'Bin store', 'Kitchen', 'Cabinets'].map(isSafetyCheck))
      .toEqual([true, true, true, true, false, false]);
  });
});

describe('shortAddress', () => {
  it('writes addresses the way a person would', () => {
    expect(shortAddress('55, Brunswick Street, Brynmill, Uplands, Swansea, Wales, SA1 4JP, United Kingdom')).toBe('55 Brunswick Street, Swansea SA1 4JP');
    expect(shortAddress('158 Danygraig road, Port Tenant SA1 8NF')).toBe('158 Danygraig road, Port Tenant SA1 8NF');
    expect(shortAddress('Flat 2, 3 The Promenade, Mount pleasant SA1 6EN')).toBe('Flat 2, 3 The Promenade, Mount pleasant SA1 6EN');
    expect(shortAddress('Hillside, Crown Street, Morriston, Swansea, SA6 8BD')).toBe('Hillside, Crown Street, Swansea SA6 8BD');
    expect(shortAddress("Compass House, Baldwin's Crescent, Swansea")).toBe("Compass House, Baldwin's Crescent, Swansea");
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
