import { describe, it, expect } from 'vitest';
import { buildCleanerRows, coworkersOf, firstName, formatHours, freeGaps, formatGap, UNASSIGNED_ROW_ID } from '../lib/rotaGrid';

// The by-cleaner rota is a row per person with the days across. A job that
// lands on the wrong row, or on no row, is a job the office can't see.

const monday = new Date('2026-09-14T00:00:00');
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + i);
  return d;
});

const amira = { id: 'amira', full_name: 'Amira Shah' };
const ben = { id: 'ben', full_name: 'Ben Okafor' };
const cleaners = [amira, ben];

const on = (id, name) => ({ cleaner_id: id, profiles: { full_name: name } });
const job = (id, when, minutes, who = []) => ({
  id,
  scheduled_at: when,
  duration_minutes: minutes,
  job_assignments: who,
});

describe('buildCleanerRows', () => {
  it('puts the unassigned row first, then staff in the order given', () => {
    const rows = buildCleanerRows([], cleaners, weekDays);
    expect(rows.map((r) => r.id)).toEqual([UNASSIGNED_ROW_ID, 'amira', 'ben']);
    expect(rows[0].name).toBe('Needs a cleaner');
    expect(rows.every((r) => r.days.length === 7)).toBe(true);
  });

  it('files a job under its day on every cleaner who is on it', () => {
    const shared = job('j1', '2026-09-15T10:00:00', 180, [on('amira', 'Amira Shah'), on('ben', 'Ben Okafor')]);
    const rows = buildCleanerRows([shared], cleaners, weekDays);
    const [, a, b] = rows;
    expect(a.days[1].map((j) => j.id)).toEqual(['j1']);
    expect(b.days[1].map((j) => j.id)).toEqual(['j1']);
    expect(a.days[0]).toEqual([]);
  });

  it('puts a job with nobody on it on the unassigned row only', () => {
    const rows = buildCleanerRows([job('j1', '2026-09-16T09:00:00', 60)], cleaners, weekDays);
    expect(rows[0].days[2].map((j) => j.id)).toEqual(['j1']);
    expect(rows[1].days[2]).toEqual([]);
    expect(rows[2].days[2]).toEqual([]);
  });

  it('sorts a day by start time however the jobs arrived', () => {
    const jobs = [
      job('late', '2026-09-14T14:00:00', 60, [on('amira', 'Amira Shah')]),
      job('early', '2026-09-14T07:00:00', 60, [on('amira', 'Amira Shah')]),
      job('mid', '2026-09-14T10:30:00', 60, [on('amira', 'Amira Shah')]),
    ];
    const rows = buildCleanerRows(jobs, cleaners, weekDays);
    expect(rows[1].days[0].map((j) => j.id)).toEqual(['early', 'mid', 'late']);
  });

  it('totals hours and jobs per person, defaulting a blank duration to two hours', () => {
    const jobs = [
      job('j1', '2026-09-14T07:00:00', 90, [on('amira', 'Amira Shah')]),
      job('j2', '2026-09-15T07:00:00', null, [on('amira', 'Amira Shah')]),
      job('j3', '2026-09-15T12:00:00', 60, [on('ben', 'Ben Okafor')]),
    ];
    const rows = buildCleanerRows(jobs, cleaners, weekDays);
    expect(rows[1].minutes).toBe(210);
    expect(rows[1].jobCount).toBe(2);
    expect(rows[2].minutes).toBe(60);
    expect(rows[0].minutes).toBe(0);
  });

  it('gives someone who has left but still holds a job a row after current staff', () => {
    const jobs = [job('j1', '2026-09-18T08:00:00', 120, [on('zed', 'Zed Former')])];
    const rows = buildCleanerRows(jobs, cleaners, weekDays);
    expect(rows.map((r) => r.id)).toEqual([UNASSIGNED_ROW_ID, 'amira', 'ben', 'zed']);
    expect(rows[3].name).toBe('Zed Former');
    expect(rows[3].current).toBe(false);
    expect(rows[3].days[4].map((j) => j.id)).toEqual(['j1']);
  });

  it('ignores a job outside the seven days it was given', () => {
    const rows = buildCleanerRows([job('j1', '2026-09-21T08:00:00', 60, [on('amira', 'Amira Shah')])], cleaners, weekDays);
    expect(rows[1].jobCount).toBe(0);
  });
});

describe('coworkersOf', () => {
  it('names everyone on the job except the cleaner whose row it is', () => {
    const j = job('j1', '2026-09-14T07:00:00', 60, [on('amira', 'Amira Shah'), on('ben', 'Ben Okafor')]);
    expect(coworkersOf(j, 'amira')).toEqual(['Ben Okafor']);
    expect(coworkersOf(j, 'ben')).toEqual(['Amira Shah']);
    expect(coworkersOf(j, null)).toEqual(['Amira Shah', 'Ben Okafor']);
  });
});

describe('labels', () => {
  it('shortens a name to what the office calls them', () => {
    expect(firstName('Amira Shah')).toBe('Amira');
    expect(firstName('  Ben ')).toBe('Ben');
    expect(firstName('')).toBe('');
  });

  it('writes hours as a plain number', () => {
    expect(formatHours(480)).toBe('8');
    expect(formatHours(390)).toBe('6.5');
    expect(formatHours(0)).toBe('0');
  });
});

describe('freeGaps', () => {
  const at = (time, minutes) => ({ scheduled_at: `2026-09-15T${time}:00`, duration_minutes: minutes });

  it('is the whole working day when there is nothing on', () => {
    expect(freeGaps([])).toEqual([{ start: 420, end: 1080 }]);
  });

  it('finds the gaps between jobs and at either end of the day', () => {
    const gaps = freeGaps([at('09:00', 120), at('13:00', 120)]);
    expect(gaps).toEqual([
      { start: 420, end: 540 },
      { start: 660, end: 780 },
      { start: 900, end: 1080 },
    ]);
  });

  it('drops a gap shorter than the minimum', () => {
    const gaps = freeGaps([at('07:00', 120), at('09:20', 60)]);
    expect(gaps).toEqual([{ start: 620, end: 1080 }]);
  });

  it('merges overlapping jobs rather than opening a gap between them', () => {
    const gaps = freeGaps([at('09:00', 180), at('10:00', 60)]);
    expect(gaps).toEqual([{ start: 420, end: 540 }, { start: 720, end: 1080 }]);
  });

  it('counts only the working window', () => {
    const gaps = freeGaps([at('05:00', 60), at('17:00', 180)]);
    expect(gaps).toEqual([{ start: 420, end: 1020 }]);
  });

  it('treats a blank duration as two hours', () => {
    expect(freeGaps([{ scheduled_at: '2026-09-15T07:00:00', duration_minutes: null }])).toEqual([{ start: 540, end: 1080 }]);
  });
});

describe('formatGap', () => {
  it('writes a length the way the office says it', () => {
    expect(formatGap(90)).toBe('1h 30m');
    expect(formatGap(120)).toBe('2h');
    expect(formatGap(45)).toBe('45m');
  });
});
