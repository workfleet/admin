import { describe, it, expect } from 'vitest';
import { EARLY_CHECKIN_MINUTES, checkInOpensAt, tooEarlyMessage, tooEarlyToCheckIn } from '../lib/clockIn';

// Local-time constructors throughout, so the day words ("today", "tomorrow")
// are tested against the same clock the message reads from.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);

describe('check-in window', () => {
  const sundayShift = at(2026, 10, 4, 10).toISOString();

  it('refuses the case that started this: Sunday tapped on Saturday afternoon', () => {
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 3, 14, 32))).toBe(true);
  });

  it('opens exactly an hour before the start and stays open after it', () => {
    expect(EARLY_CHECKIN_MINUTES).toBe(60);
    expect(checkInOpensAt(sundayShift)).toEqual(at(2026, 10, 4, 9));
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 8, 59))).toBe(true);
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 9))).toBe(false);
    // Late is never refused - a real clock-in beats a missed-shift claim.
    expect(tooEarlyToCheckIn(sundayShift, at(2026, 10, 4, 18))).toBe(false);
  });

  it('does not block a job with no start time', () => {
    expect(tooEarlyToCheckIn(null)).toBe(false);
  });

  it('names the day, which is what would have told Ben', () => {
    expect(tooEarlyMessage(sundayShift, at(2026, 10, 3, 14, 32)))
      .toBe('This shift starts tomorrow at 10:00 — you can check in from 09:00.');
    expect(tooEarlyMessage(sundayShift, at(2026, 10, 4, 7)))
      .toBe('This shift starts today at 10:00 — you can check in from 09:00.');
    expect(tooEarlyMessage(sundayShift, at(2026, 10, 1, 12)))
      .toBe('This shift starts on Sunday 4 October at 10:00 — you can check in from 09:00.');
  });

  it('says so when check-in opens the evening before a just-after-midnight start', () => {
    expect(tooEarlyMessage(at(2026, 10, 5, 0, 30).toISOString(), at(2026, 10, 4, 12)))
      .toBe('This shift starts tomorrow at 00:30 — you can check in from 23:30 the day before.');
  });
});
