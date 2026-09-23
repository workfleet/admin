import { describe, it, expect } from 'vitest';
import { BOOKABLE_ROLES, isBookableRole } from '../lib/staffRoles';
import { buildCleanerRows } from '../lib/rotaGrid';

// Who the office can put on a job. This stopped being "the cleaners" when
// the stock take went on the rota: the person who does it holds the
// 'inventory' role, and leaving them out of the staff list is what made the
// rota call them former staff.

describe('BOOKABLE_ROLES', () => {
  it('covers cleaners and whoever does the stock take', () => {
    expect(isBookableRole('cleaner')).toBe(true);
    expect(isBookableRole('inventory')).toBe(true);
  });

  it('is not a way into the office or the client portal', () => {
    expect(isBookableRole('admin')).toBe(false);
    expect(isBookableRole('supervisor')).toBe(false);
    expect(isBookableRole('client')).toBe(false);
    expect(isBookableRole(null)).toBe(false);
    expect(isBookableRole(undefined)).toBe(false);
  });

  it('is a list the rota query can hand straight to .in()', () => {
    expect(Array.isArray(BOOKABLE_ROLES)).toBe(true);
    expect(BOOKABLE_ROLES).toEqual(['cleaner', 'inventory']);
  });
});

// The label itself is drawn from row.current (CleanerWeekGrid), which is
// only true for people in the staff list the page loaded. This is the bug
// the roles list fixes, held in place.
describe('the rota row for someone who is not a cleaner', () => {
  const monday = new Date('2026-09-14T00:00:00');
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  const stockTake = {
    id: 'j1',
    scheduled_at: '2026-09-19T11:00:00',
    duration_minutes: 60,
    job_assignments: [{ cleaner_id: 'ben', profiles: { full_name: 'Ben Davies' } }],
  };

  it('is current staff when the staff list includes them', () => {
    const staff = [{ id: 'amira', full_name: 'Amira Shah' }, { id: 'ben', full_name: 'Ben Davies' }];
    const row = buildCleanerRows([stockTake], staff, weekDays).find((r) => r.id === 'ben');
    expect(row.current).toBe(true);
    expect(row.days[5].map((j) => j.id)).toEqual(['j1']);
    expect(row.minutes).toBe(60);
  });

  it('is former staff when the staff list leaves them out', () => {
    const staff = [{ id: 'amira', full_name: 'Amira Shah' }];
    const row = buildCleanerRows([stockTake], staff, weekDays).find((r) => r.id === 'ben');
    expect(row.current).toBe(false);
  });
});
