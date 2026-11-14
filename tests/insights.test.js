import { describe, it, expect } from 'vitest';
import { buildInsights, lastWeeks, weekStart } from '../lib/insights';

// Friday 13 Nov 2026, mid-afternoon.
const NOW = new Date(2026, 10, 13, 15, 0);
const at = (y, m, d, h = 9, min = 0) => new Date(y, m, d, h, min).toISOString();

const job = (id, when, status, minutes = 120, clientId = 'c1', clientName = 'Acme') => ({
  id, scheduled_at: when, status, duration_minutes: minutes,
  properties: { client_id: clientId, clients: { name: clientName } },
});
const assign = (j, cleaner, paid = null) => ({
  job_id: j.id, cleaner_id: cleaner, paid_minutes: paid,
  jobs: { id: j.id, duration_minutes: j.duration_minutes, status: j.status, scheduled_at: j.scheduled_at },
});

describe('weeks', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart(NOW).getDay()).toBe(1);
    expect(weekStart(NOW).getDate()).toBe(9);
  });

  it('lists twelve Mondays ending with this week', () => {
    const weeks = lastWeeks(NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks[11].getDate()).toBe(9);
    expect(weeks[10].getDate()).toBe(2);
  });
});

describe('buildInsights', () => {
  it('splits a shared job between the people on it, as payroll does', () => {
    const j = job('j1', at(2026, 10, 10), 'completed', 120);
    const out = buildInsights({ jobs: [j], assignments: [assign(j, 'a'), assign(j, 'b')], now: NOW });
    expect(out.hoursByWeek[11].hours).toBe(2); // 1h each, 2h in all
  });

  it("uses the office's set minutes when there are some", () => {
    const j = job('j1', at(2026, 10, 10), 'completed', 120);
    const out = buildInsights({ jobs: [j], assignments: [assign(j, 'a', 90)], now: NOW });
    expect(out.hoursByWeek[11].hours).toBe(1.5);
  });

  it('only counts hours on completed visits', () => {
    const j = job('j1', at(2026, 10, 10), 'missed', 120);
    const out = buildInsights({ jobs: [j], assignments: [assign(j, 'a')], now: NOW });
    expect(out.hoursByWeek[11].hours).toBe(0);
  });

  it('counts visits done and missed in the right week', () => {
    const jobs = [
      job('a', at(2026, 10, 10), 'completed'),
      job('b', at(2026, 10, 11), 'missed'),
      job('c', at(2026, 10, 3), 'completed'),
      job('d', at(2026, 10, 14), 'scheduled'),
    ];
    const out = buildInsights({ jobs, now: NOW });
    expect(out.visitsByWeek[11]).toMatchObject({ completed: 1, missed: 1 });
    expect(out.visitsByWeek[10]).toMatchObject({ completed: 1, missed: 0 });
  });

  it('ranks clients by hours over the last four weeks', () => {
    const jobs = [
      job('a', at(2026, 10, 10), 'completed', 60, 'c1', 'Acme'),
      job('b', at(2026, 10, 11), 'completed', 180, 'c2', 'Bravo'),
      job('c', at(2026, 10, 12), 'completed', 60, 'c1', 'Acme'),
      job('old', at(2026, 8, 1), 'completed', 600, 'c1', 'Acme'), // outside the window
    ];
    const out = buildInsights({ jobs, now: NOW });
    expect(out.clients.map((c) => [c.name, c.hours])).toEqual([['Bravo', 3], ['Acme', 2]]);
  });

  it('counts a clock-in up to five minutes after the start as on time', () => {
    const j1 = job('j1', at(2026, 10, 10, 9, 0), 'completed');
    const j2 = job('j2', at(2026, 10, 11, 9, 0), 'completed');
    const checkins = [
      { job_id: 'j1', cleaner_id: 'a', checked_in_at: at(2026, 10, 10, 9, 5) },
      { job_id: 'j2', cleaner_id: 'a', checked_in_at: at(2026, 10, 11, 9, 20) },
      // a second, later tap on the same visit is ignored
      { job_id: 'j1', cleaner_id: 'a', checked_in_at: at(2026, 10, 10, 11, 0) },
    ];
    const out = buildInsights({ jobs: [j1, j2], checkins, names: new Map([['a', 'Ann']]), now: NOW });
    expect(out.punctuality).toEqual([{ id: 'a', name: 'Ann', onTime: 1, total: 2, rate: 0.5 }]);
    expect(out.kpis.onTimeRate.now).toBe(0.5);
  });

  it('compares the last four weeks with the four before', () => {
    const jobs = [
      job('now1', at(2026, 10, 10), 'completed'),
      job('now2', at(2026, 10, 11), 'missed'),
      job('prev', at(2026, 9, 1), 'completed'),
    ];
    const out = buildInsights({ jobs, now: NOW });
    expect(out.kpis.visits).toEqual({ now: 1, before: 1 });
    expect(out.kpis.missedRate.now).toBe(0.5);
    expect(out.kpis.missedRate.before).toBe(0);
  });

  it('has no rate rather than 0% when there is nothing to measure', () => {
    const out = buildInsights({ now: NOW });
    expect(out.kpis.missedRate.now).toBe(null);
    expect(out.kpis.onTimeRate.now).toBe(null);
  });
});
