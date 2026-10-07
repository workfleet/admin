import { describe, it, expect } from 'vitest';
import { checkInOpensAt, tooEarlyMessage, tooEarlyToCheckIn } from '../lib/clockIn';

// Local-time constructors throughout, so the day words ("today", "tomorrow")
// are tested against the same clock the message reads from.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);

describe('check-in window', () => {
  const sundayShift = at(2026, 10, 4, 10).toISOString();

  it('refuses the case that started this: Sunday tapped on Saturday afternoon', () => {
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 3, 14, 32))).toBe(true);
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 3, 23, 59))).toBe(true);
  });

  it('opens at the start of the shift day, however early they arrive, and stays open after it', () => {
    expect(checkInOpensAt(sundayShift)).toEqual(at(2026, 10, 4, 0));
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 0))).toBe(false);
    // Two hours early and standing at the property: the geofence decides.
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 8))).toBe(false);
    // Late is never refused - a real clock-in beats a missed-shift claim.
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 18))).toBe(false);
  });

  it('does not block a job with no start time', () => {
    expect(tooEarlyToCheckIn(null)).toBe(false);
  });

  it('names the day, which is what would have told Ben', () => {
    expect(tooEarlyMessage(sundayShift, at(2026, 10, 3, 14, 32)))
      .toBe('This shift starts tomorrow at 10:00 — you can check in on the day.');
    expect(tooEarlyMessage(sundayShift, at(2026, 10, 1, 12)))
      .toBe('This shift starts on Sunday 4 October at 10:00 — you can check in on the day.');
  });
});
