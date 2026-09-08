import { describe, it, expect } from 'vitest';
import {
  estimateTravelMinutes,
  findTightTurnarounds,
  describeTurnaround,
  DOOR_TO_DOOR_MINUTES,
} from '../lib/travelTime';

// A warning here is the difference between a rota that can be worked and
// one that produces a late arrival every Tuesday. Too quiet and it is
// useless; too loud and the office learns to click past it.

// Penllergaer, and points roughly 1 km and 12 km away.
const here = { lat: 51.6584, lng: -4.0447, address: 'Penllergaer' };
const KM_LAT = 1 / 111.32;
const oneKm = { lat: here.lat + KM_LAT, lng: here.lng, address: '1 km north' };
const twelveKm = { lat: here.lat + 12 * KM_LAT, lng: here.lng, address: '12 km north' };
const noPin = { address: 'Somewhere unmapped' };

const job = (id, time, minutes, property, cleaners = []) => ({
  id,
  scheduled_at: `2026-09-09T${time}:00`,
  duration_minutes: minutes,
  properties: property,
  job_assignments: cleaners.map((c) => ({ cleaner_id: c, profiles: { full_name: c === 'bea' ? 'Bea Jones' : 'Sam Lee' } })),
});

describe('estimateTravelMinutes', () => {
  it('is unknown, not zero, when either property has no pin', () => {
    expect(estimateTravelMinutes(here, noPin)).toBeNull();
    expect(estimateTravelMinutes(noPin, here)).toBeNull();
    expect(estimateTravelMinutes(null, here)).toBeNull();
  });

  it('charges only the walk in for the same building', () => {
    expect(estimateTravelMinutes(here, here)).toBe(DOOR_TO_DOOR_MINUTES);
  });

  it('scales with distance and stays conservative', () => {
    // 1 km as the crow flies is 1.3 km by road: under 3 minutes at 30 km/h,
    // plus 5 to park and get in - so 8.
    expect(estimateTravelMinutes(here, oneKm)).toBe(8);
    // 12 km -> 15.6 km by road -> ~31 min driving + 5.
    expect(estimateTravelMinutes(here, twelveKm)).toBe(37);
  });
});

describe('findTightTurnarounds', () => {
  it('flags a gap shorter than the drive', () => {
    const tight = findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '11:10', 60, twelveKm, ['bea']),
    ]);
    expect(tight).toHaveLength(1);
    expect(tight[0]).toMatchObject({ cleanerId: 'bea', name: 'Bea Jones', gapMinutes: 10, travelMinutes: 37 });
    expect(tight[0].from.id).toBe('a');
    expect(tight[0].to.id).toBe('b');
  });

  it('is quiet when the gap is enough', () => {
    expect(findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '12:00', 60, twelveKm, ['bea']),
    ])).toEqual([]);
  });

  it('leaves outright overlaps to the double-booking check', () => {
    expect(findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '10:30', 60, twelveKm, ['bea']),
    ])).toEqual([]);
  });

  it('only compares jobs on the same cleaner', () => {
    expect(findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '11:05', 60, twelveKm, ['sam']),
    ])).toEqual([]);
  });

  it('says nothing when a property has no pin', () => {
    expect(findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '11:00', 60, noPin, ['bea']),
    ])).toEqual([]);
  });

  it('checks consecutive pairs across a full day, per cleaner, per day', () => {
    const tight = findTightTurnarounds([
      job('a', '09:00', 60, here, ['bea', 'sam']),
      job('b', '10:05', 60, twelveKm, ['bea']),        // tight for Bea
      job('c', '13:00', 60, here, ['sam']),            // fine for Sam
      job('d', '14:05', 60, twelveKm, ['sam']),        // tight for Sam
      { ...job('e', '10:05', 60, twelveKm, ['bea']), scheduled_at: '2026-09-10T10:05:00' }, // next day
    ]);
    expect(tight.map((t) => [t.name, t.to.id])).toEqual([['Bea Jones', 'b'], ['Sam Lee', 'd']]);
  });

  it('copes with jobs missing assignments or a start time', () => {
    expect(findTightTurnarounds([{ id: 'x' }, job('a', '09:00', 60, here)])).toEqual([]);
    expect(findTightTurnarounds(null)).toEqual([]);
  });
});

describe('describeTurnaround', () => {
  it('reads as one line the office can act on', () => {
    const [t] = findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '11:10', 60, twelveKm, ['bea']),
    ]);
    const text = describeTurnaround(t);
    expect(text).toContain('Bea Jones: Penllergaer ends');
    expect(text).toContain('12 km north starts');
    expect(text).toContain('10 min gap, about 37 min to get there.');
  });

  it('says "no gap" rather than "0 min gap"', () => {
    const [t] = findTightTurnarounds([
      job('a', '09:00', 120, here, ['bea']),
      job('b', '11:00', 60, twelveKm, ['bea']),
    ]);
    expect(describeTurnaround(t)).toContain('no gap');
  });
});
