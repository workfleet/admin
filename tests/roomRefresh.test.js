import { describe, it, expect } from 'vitest';
import { parseRoomList, numberedRooms, roomsApply, overdueRooms, roomMinutesFor, plannedMinutes } from '../lib/roomRefresh';
import { buildInvoiceBreakdown } from '../lib/invoiceBreakdown';

const slate = { id: 'slate', address: '23 Slate Street, Swansea', rooms: ['Room 1', 'Room 2', 'Room 3'], rooms_tracked_since: '2026-11-20' };
const job = (over) => ({ id: Math.random().toString(36), property_id: 'slate', status: 'completed', duration_minutes: 105, room_refreshes: [], ...over });
const tick = (...rooms) => rooms.map((room) => ({ room, minutes: 15, done_at: '2026-11-26T14:30:00Z' }));

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
    expect(roomsApply({ ...slate, rooms: [] }, '2026-12-01T10:00:00Z')).toBe(false);
  });
  it('defaults to 15 minutes a room and plans the booking', () => {
    expect(roomMinutesFor(null)).toBe(15);
    expect(roomMinutesFor({ room_refresh_minutes: 20 })).toBe(20);
    expect(plannedMinutes(slate, null)).toBe(105);
  });
});

describe('overdue rooms', () => {
  it('lists rooms and communal areas not done for a fortnight', () => {
    const jobs = [
      job({ scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: tick('Room 1', 'Room 2') }),
      job({ scheduled_at: '2026-12-10T14:00:00Z', status: 'scheduled' }),
    ];
    const [house] = overdueRooms({ properties: [slate], jobs, today: '2026-12-10' });
    expect(house.items.map((i) => i.label)).toEqual(['Communal areas', 'Room 1', 'Room 2', 'Room 3']);
    expect(house.items.find((i) => i.label === 'Room 3')).toMatchObject({ last: null, days: 20 });
  });
  it('is quiet while everything is in date', () => {
    const jobs = [job({ scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: tick('Room 1', 'Room 2', 'Room 3') })];
    expect(overdueRooms({ properties: [slate], jobs, today: '2026-12-09' })).toEqual([]);
  });
  it('ignores properties without a list', () => {
    expect(overdueRooms({ properties: [{ id: 'x', rooms: [] }], jobs: [], today: '2027-01-01' })).toEqual([]);
  });
});

describe('invoicing tracked rooms', () => {
  const build = (jobs) => buildInvoiceBreakdown({ properties: [slate], jobs, rate: 24, roomMinutes: 15 });

  it('charges the communal clean and each ticked room', () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: tick('Room 1', 'Room 2', 'Room 3') })]);
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes.map((r) => r.room)).toEqual(['Room 1', 'Room 2', 'Room 3']);
    expect(b.total).toBe(42);
    expect(b.warnings).toEqual([]);
  });

  it("doesn't charge a room that wasn't ticked, and says so", () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: tick('Room 1') })]);
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes).toHaveLength(1);
    expect(b.total).toBe(30);
    expect(b.warnings.join(' ')).toMatch(/Room 2, Room 3 weren't ticked/);
  });

  it('charges the client minutes, not whatever is stored on the tick', () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', room_refreshes: [{ room: 'Room 1', minutes: 90 }] })]);
    expect(b.refreshes[0].minutes).toBe(15);
  });

  it('leaves visits before tracking started as they were', () => {
    const b = build([job({ scheduled_at: '2026-10-23T12:00:00Z', duration_minutes: 60 })]);
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes).toEqual([]);
    expect(b.warnings).toEqual([]);
  });

  it('warns when the booking barely covers the rooms', () => {
    const b = build([job({ scheduled_at: '2026-11-26T14:00:00Z', duration_minutes: 45, room_refreshes: tick('Room 1', 'Room 2', 'Room 3') })]);
    expect(b.lines).toEqual([]);
    expect(b.warnings.join(' ')).toMatch(/barely covers 3 rooms/);
  });
});
