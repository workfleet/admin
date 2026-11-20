import { describe, it, expect } from 'vitest';
import { parseRoomList, numberedRooms, roomsApply, overdueRooms, roomMinutesFor, trackerRows, ticked } from '../lib/roomRefresh';
import { buildInvoiceBreakdown, propertyLineText, refreshLineText } from '../lib/invoiceBreakdown';

const slate = { id: 'slate', address: '23 Slate Street, Swansea', rooms: ['Room 1', 'Room 2', 'Room 3'], rooms_tracked_since: '2026-11-20' };
const job = (over) => ({ id: Math.random().toString(36), property_id: 'slate', status: 'completed', duration_minutes: 60, room_refreshes: [], ...over });
const plan = (...rooms) => rooms.map((room) => ({ room, minutes: 15 }));

describe('room lists', () => {
  it('reads a typed list, one per line or comma separated, without repeats', () => {
    expect(parseRoomList('Room 1, Room 2\nroom 2\n\n  Attic  room ')).toEqual(['Room 1', 'Room 2', 'Attic room']);
  });
  it('numbers rooms', () => {
    expect(numberedRooms(3)).toEqual(['Room 1', 'Room 2', 'Room 3']);
    expect(numberedRooms('x')).toEqual([]);
  });
  it('applies only from the day tracking started', () => {
    expect(roomsApply(slate, '2026-11-19T23:30:00Z')).toBe(false);
    expect(roomsApply(slate, '2026-11-20T00:30:00Z')).toBe(true);
  });
  it('defaults to 15 minutes a room', () => {
    expect(roomMinutesFor(null)).toBe(15);
    expect(roomMinutesFor({ room_refresh_minutes: 20 })).toBe(20);
  });
  it('does not count a room the office marked as not done', () => {
    expect([...ticked(job({ room_refreshes: [{ room: 'Room 1', minutes: 15 }, { room: 'Room 2', minutes: 15, skipped: true }] }))]).toEqual(['Room 1']);
  });
});

describe('tracker', () => {
  const jobs = [
    job({ id: 'a', scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: plan('Room 1', 'Room 2') }),
    job({ id: 'b', scheduled_at: '2026-12-10T14:00:00Z', status: 'scheduled', room_refreshes: plan('Room 3') }),
  ];
  const byLabel = (today) => Object.fromEntries(trackerRows({ property: slate, jobs, today }).rows.map((r) => [r.label, r]));

  it('shows when each was last done and next booked', () => {
    const r = byLabel('2026-12-01');
    expect(r['Communal areas']).toMatchObject({ last: '2026-11-26', next: '2026-12-10', status: 'booked' });
    // Rooms are done on move-out: no due date, booked or nothing.
    expect(r['Room 1']).toMatchObject({ last: '2026-11-26', lastJobId: 'a', next: null, dueDay: null, status: 'none' });
    expect(r['Room 3']).toMatchObject({ last: null, next: '2026-12-10', nextJobId: 'b', status: 'booked' });
  });

  it('turns the communal row amber when due soon with nothing booked, red once past due', () => {
    const noVisit = [jobs[0]];
    const comm = (today) => trackerRows({ property: slate, jobs: noVisit, today }).rows[0];
    expect(comm('2026-12-07').status).toBe('due');
    expect(comm('2026-12-11').status).toBe('overdue');
    expect(trackerRows({ property: slate, jobs: noVisit, today: '2027-03-01' }).rows.find((x) => x.label === 'Room 1').status).toBe('none');
  });

  it('says when a planned room was marked not done', () => {
    const missed = [job({ id: 'c', scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: [{ room: 'Room 2', minutes: 15, skipped: true }] })];
    const row = trackerRows({ property: slate, jobs: missed, today: '2026-12-01' }).rows.find((x) => x.label === 'Room 2');
    expect(row).toMatchObject({ last: null, missedOn: '2026-11-26', lastPlannedJobId: 'c' });
  });

  it('counts refreshes done before tracking started', () => {
    const before = [job({ id: 'old', scheduled_at: '2026-11-12T14:00:00Z', room_refreshes: plan('Room 1') })];
    const row = trackerRows({ property: slate, jobs: before, today: '2026-11-21' }).rows.find((x) => x.label === 'Room 1');
    expect(row).toMatchObject({ last: '2026-11-12', lastJobId: 'old', status: 'none' });
  });

  it('lists only what is overdue for the dashboard', () => {
    const [house] = overdueRooms({ properties: [slate], jobs, today: '2026-12-11' });
    // The 10 Dec visit was never closed, so the communal clean is late;
    // rooms are never overdue.
    expect(house.items.map((i) => i.label)).toEqual(['Communal areas']);
    expect(overdueRooms({ properties: [{ id: 'x', rooms: [] }], jobs: [], today: '2027-01-01' })).toEqual([]);
  });
});

describe('invoicing planned rooms', () => {
  const build = (jobs) => buildInvoiceBreakdown({ properties: [slate], jobs, rate: 24 });

  it('shows the communal clean and each room on its own line', () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', duration_minutes: 90, room_refreshes: plan('Room 1', 'Room 2') })]);
    expect(propertyLineText(b.lines[0])).toBe('23 Slate Street - communal areas, 1 visit: 26 November 2026');
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes.map(refreshLineText)).toEqual([
      'Room refresh - Room 1, 23 Slate Street - 26 November 2026',
      'Room refresh - Room 2, 23 Slate Street - 26 November 2026',
    ]);
    expect(b.total).toBe(36);
  });

  it("doesn't charge a room marked not done, as a refresh or as communal time", () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', duration_minutes: 90, room_refreshes: [{ room: 'Room 1', minutes: 15 }, { room: 'Room 2', minutes: 15, skipped: true }] })]);
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes.map((r) => r.room)).toEqual(['Room 1']);
    expect(b.total).toBe(30);
    expect(b.warnings.join(' ')).toMatch(/Room 2 wasn't refreshed/);
  });
});
