import { describe, it, expect } from 'vitest';
import {
  SHORT_SHIFT_RATIO,
  clockedMinutes,
  describeShortfall,
  shiftShortfall,
} from '../lib/shortShift';

// The case this exists for: on 2026-09-02 a cleaner checked in at 13:10:38
// and out at 13:10:41 on a job booked for 480 minutes, and 8 hours went
// through to payroll off 3.5 seconds on site. Getting this threshold wrong in
// one direction pays shifts that never happened; in the other it holds up the
// pay of somebody who simply worked quickly.

const clock = (fromIso, toIso) => ({ checked_in_at: fromIso, checked_out_at: toIso });
const job = (duration_minutes) => ({ duration_minutes });

// A closed check-in of exactly `mins` minutes.
const spanning = (mins) => clock('2026-09-02T13:00:00.000Z', new Date(Date.parse('2026-09-02T13:00:00.000Z') + mins * 60000).toISOString());

describe('clockedMinutes', () => {
  it('adds up everyone who has finished', () => {
    expect(clockedMinutes([spanning(60), spanning(30)])).toBe(90);
  });

  it('counts an open check-in as nothing, not as time still running', () => {
    // Asked at the moment somebody checks out. An open row belongs to a
    // teammate who has not finished, and their time is not evidence yet.
    expect(clockedMinutes([spanning(60), { checked_in_at: '2026-09-02T13:00:00.000Z', checked_out_at: null }])).toBe(60);
  });

  it('is zero for no check-ins at all', () => {
    expect(clockedMinutes([])).toBe(0);
    expect(clockedMinutes(null)).toBe(0);
  });
});

describe('shiftShortfall', () => {
  it('flags the three-second check-out that started all this', () => {
    const result = shiftShortfall(job(480), [clock('2026-09-02T13:10:38.271Z', '2026-09-02T13:10:41.774Z')]);
    expect(result.isShort).toBe(true);
    expect(result.clocked).toBeLessThan(0.1);
    expect(result.booked).toBe(480);
  });

  it('lets a full shift through', () => {
    expect(shiftShortfall(job(120), [spanning(120)]).isShort).toBe(false);
  });

  it('lets a shift a shade under its booking through', () => {
    // 100 of 120 minutes is 83%, above the threshold. Somebody who finishes
    // ten minutes early should not need an admin to release their pay.
    expect(shiftShortfall(job(120), [spanning(100)]).isShort).toBe(false);
  });

  it('holds a shift that clocked less than the threshold', () => {
    // 90 of 120 is 75%.
    expect(shiftShortfall(job(120), [spanning(90)]).isShort).toBe(true);
  });

  it('treats exactly the threshold as enough', () => {
    // 96 of 120 is exactly 80%. The boundary pays rather than holds - the
    // rule is "less than", and a shift that hits the mark has met it.
    const result = shiftShortfall(job(120), [spanning(120 * SHORT_SHIFT_RATIO)]);
    expect(result.ratio).toBeCloseTo(SHORT_SHIFT_RATIO);
    expect(result.isShort).toBe(false);
  });

  it('adds up a shared job before judging it', () => {
    // Two people, an hour each, on a 2-hour job is a full shift - judging
    // either person's hour alone against 120 minutes would hold back every
    // shared job in the business.
    expect(shiftShortfall(job(120), [spanning(60), spanning(60)]).isShort).toBe(false);
  });

  it('has no opinion until somebody has actually finished', () => {
    // Mid-shift, with everyone still on site, there is nothing to compare -
    // and treating that as zero clocked would flag every job in progress.
    const result = shiftShortfall(job(480), [{ checked_in_at: '2026-09-02T13:00:00.000Z', checked_out_at: null }]);
    expect(result.ratio).toBeNull();
    expect(result.isShort).toBe(false);
  });

  it('falls back to two hours when the job has no duration', () => {
    expect(shiftShortfall(job(null), [spanning(30)]).booked).toBe(120);
  });
});

describe('describeShortfall', () => {
  it('says both halves, because a percentage alone decides nothing', () => {
    expect(describeShortfall({ clocked: 3, booked: 480 })).toBe('3m clocked of 8h booked');
  });

  it('reads minutes back on an hour', () => {
    expect(describeShortfall({ clocked: 95, booked: 150 })).toBe('1h 35m clocked of 2h 30m booked');
  });
});
