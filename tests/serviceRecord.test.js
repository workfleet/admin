import { describe, expect, it } from 'vitest';
import { serviceRecordRows, serviceRecordTotals, serviceRecordCsv } from '../lib/serviceRecord';

const job = (over = {}) => ({
  id: 'j1',
  scheduled_at: '2026-11-11T12:00:00Z',
  status: 'completed',
  properties: { address: '108 Norfolk Street' },
  job_assignments: [{ profiles: { full_name: 'Natasha Crocker' } }],
  checkins: [{ checked_in_at: '2026-11-11T13:05:00Z', checked_out_at: '2026-11-11T16:07:00Z', profiles: { full_name: 'Natasha Crocker' } }],
  tasks: [{ completed: true }, { completed: true }, { completed: false }],
  ...over,
});

describe('serviceRecordRows', () => {
  it('gives arrive, leave, time on site, cleaner and checklist in UK time', () => {
    const [row] = serviceRecordRows([job()]);
    expect(row.arrived).toBe('13:05');
    expect(row.left).toBe('16:07');
    expect(row.onSite).toBe('3h 2m');
    expect(row.cleaners).toBe('Natasha Crocker');
    expect(row.checklist).toBe('2 of 3');
    expect(row.status).toBe('Done');
  });

  it('shows British Summer Time correctly', () => {
    const [row] = serviceRecordRows([job({ checkins: [{ checked_in_at: '2026-07-01T08:00:00Z', checked_out_at: '2026-07-01T09:00:00Z' }] })]);
    expect(row.arrived).toBe('09:00');
  });

  it('leaves the leaving time blank while anyone is still checked in', () => {
    const [row] = serviceRecordRows([job({
      checkins: [
        { checked_in_at: '2026-11-11T13:00:00Z', checked_out_at: '2026-11-11T14:00:00Z' },
        { checked_in_at: '2026-11-11T13:30:00Z', checked_out_at: null },
      ],
    })]);
    expect(row.arrived).toBe('13:00');
    expect(row.left).toBe('');
  });

  it('falls back to the rota names when nobody checked in, and drops cancelled visits', () => {
    const rows = serviceRecordRows([job({ status: 'missed', checkins: [] }), job({ id: 'j2', status: 'cancelled' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cleaners).toBe('Natasha Crocker');
    expect(rows[0].onSite).toBe('');
  });

  it('sorts oldest first', () => {
    const rows = serviceRecordRows([job({ id: 'b', scheduled_at: '2026-11-20T10:00:00Z' }), job({ id: 'a', scheduled_at: '2026-11-02T10:00:00Z' })]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves out booked visits still to come, keeps past ones', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    const rows = serviceRecordRows([
      job({ id: 'past' }),
      job({ id: 'future', status: 'scheduled', scheduled_at: '2026-11-23T14:00:00Z', checkins: [] }),
      job({ id: 'earlier-booked', status: 'scheduled', scheduled_at: '2026-11-18T09:00:00Z', checkins: [] }),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(['past', 'earlier-booked']);
  });
});

describe('serviceRecordTotals', () => {
  it('counts done and missed visits and done time only', () => {
    const rows = serviceRecordRows([job(), job({ id: 'j2', status: 'missed', checkins: [] })]);
    expect(serviceRecordTotals(rows)).toEqual({ visits: 1, missed: 1, minutes: 182 });
  });
});

describe('serviceRecordCsv', () => {
  it('quotes commas and defuses formulas', () => {
    const csv = serviceRecordCsv([{ date: 'Wed', address: '1 High St, Swansea', status: 'Done', arrived: '', left: '', onSite: '', cleaners: '=HYPERLINK("x")', checklist: '' }]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain('"1 High St, Swansea"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
