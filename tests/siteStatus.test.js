import { describe, it, expect } from 'vitest';
import { siteStatusFor, visitsToShow } from '../lib/siteStatus';

// This is the line a client reads to decide whether to ring the office.
// "On site" when nobody is there, or "not arrived" while someone is
// hoovering the landing, is the kind of wrong that gets the app switched off.

const job = (overrides = {}) => ({
  id: 'j1',
  scheduled_at: '2026-09-09T09:00:00',
  duration_minutes: 120,
  status: 'scheduled',
  ...overrides,
});
const row = (name, inAt, outAt = null) => ({ profiles: { full_name: name }, checked_in_at: inAt, checked_out_at: outAt });
const at = (time) => new Date(`2026-09-09T${time}:00`);

describe('siteStatusFor', () => {
  it('says who is on site and since when', () => {
    const s = siteStatusFor(job({ status: 'in_progress' }), [row('Laura', '2026-09-09T09:02:00')], at('09:30'));
    expect(s.state).toBe('on_site');
    expect(s.label).toBe('Laura is on site');
    expect(s.detail).toMatch(/since 9:02/);
  });

  it('names both when two are on site, from the earlier arrival', () => {
    const s = siteStatusFor(job({ status: 'in_progress' }), [row('Laura', '2026-09-09T09:05:00'), row('Sam', '2026-09-09T09:02:00')], at('09:30'));
    expect(s.label).toBe('Laura and Sam are on site');
    expect(s.detail).toMatch(/9:02/);
  });

  it('keeps saying on site while one of two is still there', () => {
    const s = siteStatusFor(job({ status: 'in_progress' }), [row('Laura', '2026-09-09T09:00:00', '2026-09-09T10:30:00'), row('Sam', '2026-09-09T09:00:00')], at('10:45'));
    expect(s.state).toBe('on_site');
    expect(s.label).toBe('Sam is on site');
  });

  it('says finished once everyone has left, at the last departure', () => {
    const s = siteStatusFor(job({ status: 'completed' }), [row('Laura', '2026-09-09T09:00:00', '2026-09-09T11:05:00')], at('12:00'));
    expect(s.state).toBe('finished');
    expect(s.label).toBe('Laura has finished');
    expect(s.detail).toMatch(/11:05/);
  });

  it('falls back to "your cleaner" when the name is not readable', () => {
    const s = siteStatusFor(job({ status: 'in_progress' }), [{ checked_in_at: '2026-09-09T09:02:00', checked_out_at: null }], at('09:30'));
    expect(s.label).toBe('Your cleaner is on site');
  });

  it('distinguishes expected, late, and never-arrived', () => {
    expect(siteStatusFor(job(), [], at('08:30'))).toMatchObject({ state: 'expected', label: 'Not arrived yet' });
    expect(siteStatusFor(job(), [], at('09:20'))).toMatchObject({ state: 'late', label: 'Not arrived yet' });
    expect(siteStatusFor(job(), [], at('12:00'))).toMatchObject({ state: 'past', label: 'No arrival recorded' });
  });

  it('reports a missed visit and an office-completed one honestly', () => {
    expect(siteStatusFor(job({ status: 'missed' }), [], at('12:00')).state).toBe('missed');
    const s = siteStatusFor(job({ status: 'completed' }), [], at('12:00'));
    expect(s).toMatchObject({ state: 'finished', label: 'This visit was completed' });
  });
});

describe('visitsToShow', () => {
  it('shows today in time order, plus an older visit with someone still on site', () => {
    const jobs = [
      job({ id: 'later', scheduled_at: '2026-09-09T14:00:00' }),
      job({ id: 'early', scheduled_at: '2026-09-09T09:00:00' }),
      job({ id: 'yesterday', scheduled_at: '2026-09-08T09:00:00' }),
      job({ id: 'overnight', scheduled_at: '2026-09-08T22:00:00' }),
      job({ id: 'tomorrow', scheduled_at: '2026-09-10T09:00:00' }),
    ];
    const checkins = { overnight: [row('Sam', '2026-09-08T22:05:00')] };
    expect(visitsToShow(jobs, checkins, at('10:00')).map((j) => j.id)).toEqual(['overnight', 'early', 'later']);
  });

  it('is empty on a day with nothing booked', () => {
    expect(visitsToShow([job({ scheduled_at: '2026-09-10T09:00:00' })], {}, at('10:00'))).toEqual([]);
    expect(visitsToShow(null, null, at('10:00'))).toEqual([]);
  });
});
