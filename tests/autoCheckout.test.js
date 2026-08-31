import { describe, it, expect } from 'vitest';
import {
  classifyFix,
  nextDepartureState,
  shouldAutoCheckOut,
  autoCheckoutTimestamp,
  withinAutoCheckoutGrace,
  MIN_ACCURACY_METERS,
  DEPARTURE_DWELL_MS,
  MIN_ONSITE_MS,
  AUTO_CHECKOUT_GRACE_MS,
} from '../lib/autoCheckout';

// Automatic check-out writes the time a shift ended, which becomes the hours
// someone is paid for. Closing a shift too early takes money off a cleaner
// who is still working; closing it at the wrong time invents a shift that
// never happened. Both are worth a test.

const property = { lat: 51.6584, lng: -4.0447 }; // Penllergaer, Swansea

// Roughly 1 metre of latitude, for nudging a fix a known distance away.
const METRE = 1 / 111_320;
const at = (lat, lng, accuracy = 10) => ({ lat, lng, accuracy });
const metresNorth = (m, accuracy) => at(property.lat + m * METRE, property.lng, accuracy);

describe('classifyFix', () => {
  it('reads a fix on the doorstep as inside', () => {
    expect(classifyFix(metresNorth(10), property)).toBe('inside');
  });

  it('reads a fix well down the road as outside', () => {
    expect(classifyFix(metresNorth(400), property)).toBe('outside');
  });

  it('reads the band between the two radii as unknown, not as left', () => {
    // 75m is the geofence, 150m triggers check-out. In between, the app does
    // not know - and must not treat "not sure" as evidence of leaving.
    expect(classifyFix(metresNorth(110), property)).toBe('near');
  });

  it('discards a fix too vague to mean anything', () => {
    // A 500m-accurate fix from the middle of the property still cannot show
    // someone left, so it must not be allowed to.
    expect(classifyFix(metresNorth(400, MIN_ACCURACY_METERS + 1), property)).toBe('unknown');
  });

  it('is unknown when either end has no coordinates', () => {
    expect(classifyFix(metresNorth(10), { lat: null, lng: null })).toBe('unknown');
    expect(classifyFix(null, property)).toBe('unknown');
    expect(classifyFix({ lat: null, lng: null }, property)).toBe('unknown');
  });
});

describe('nextDepartureState', () => {
  const t0 = new Date('2026-08-30T09:00:00Z');
  const t1 = new Date('2026-08-30T09:05:00Z');

  it('records when they were last seen on site', () => {
    expect(nextDepartureState({}, 'inside', t0)).toEqual({ lastInsideAt: t0, outsideSince: null });
  });

  it('starts the departure clock on the first confident outside reading', () => {
    expect(nextDepartureState({}, 'outside', t0).outsideSince).toBe(t0);
  });

  it('does not restart the departure clock on later outside readings', () => {
    // Otherwise the dwell timer never elapses and nobody is ever checked out.
    const started = nextDepartureState({}, 'outside', t0);
    expect(nextDepartureState(started, 'outside', t1).outsideSince).toBe(t0);
  });

  it('clears the departure clock if they come back inside', () => {
    const started = nextDepartureState({}, 'outside', t0);
    expect(nextDepartureState(started, 'inside', t1).outsideSince).toBeNull();
  });

  it('holds state through bad signal, so a patchy walk out does not reset it', () => {
    const started = nextDepartureState({}, 'outside', t0);
    expect(nextDepartureState(started, 'unknown', t1)).toBe(started);
    expect(nextDepartureState(started, 'near', t1)).toBe(started);
  });
});

describe('shouldAutoCheckOut', () => {
  const checkedInAt = new Date('2026-08-30T09:00:00Z');
  const outsideSince = new Date('2026-08-30T10:00:00Z');

  it('waits out the dwell period before closing the shift', () => {
    const justUnder = new Date(outsideSince.getTime() + DEPARTURE_DWELL_MS - 1000);
    const justOver = new Date(outsideSince.getTime() + DEPARTURE_DWELL_MS);

    expect(shouldAutoCheckOut({ outsideSince }, checkedInAt, justUnder)).toBe(false);
    expect(shouldAutoCheckOut({ outsideSince }, checkedInAt, justOver)).toBe(true);
  });

  it('never fires while they are still on site', () => {
    expect(shouldAutoCheckOut({ outsideSince: null }, checkedInAt, new Date('2026-08-30T18:00:00Z'))).toBe(false);
  });

  it('will not close a shift that has barely started', () => {
    // Someone who checks in, moves their car 30 seconds later and is away for
    // the full dwell period has still only been on the job three and a half
    // minutes - short of the minimum time on site, so the shift stays open.
    const arrived = new Date('2026-08-30T09:00:00Z');
    const wanderedOff = new Date(arrived.getTime() + 30_000);
    const now = new Date(wanderedOff.getTime() + DEPARTURE_DWELL_MS);

    expect(now - arrived).toBeLessThan(MIN_ONSITE_MS);
    expect(shouldAutoCheckOut({ outsideSince: wanderedOff }, arrived, now)).toBe(false);

    // Once they have been on the clock past the minimum, the same departure
    // does close it.
    const later = new Date(arrived.getTime() + MIN_ONSITE_MS + 1000);
    expect(shouldAutoCheckOut({ outsideSince: wanderedOff }, arrived, later)).toBe(true);
  });
});

describe('autoCheckoutTimestamp', () => {
  const checkin = { checked_in_at: '2026-08-30T09:00:00.000Z' };
  const job = { scheduled_at: '2026-08-30T09:00:00.000Z', duration_minutes: 120 };

  it('writes down the departure the watcher actually saw', () => {
    const observed = new Date('2026-08-30T10:45:00.000Z');
    const stamp = autoCheckoutTimestamp({
      observedDepartureAt: observed,
      checkin,
      job,
      now: new Date('2026-08-30T10:50:00.000Z'),
    });
    expect(stamp).toBe('2026-08-30T10:45:00.000Z');
  });

  it('falls back to the allotted end when nothing was witnessed', () => {
    // The catch-up pass knows only that they are elsewhere now. Last-seen-
    // inside on a locked phone is usually seconds after check-in, and writing
    // that down would record a shift that never happened.
    const stamp = autoCheckoutTimestamp({
      observedDepartureAt: null,
      checkin: { ...checkin, last_seen_inside_at: '2026-08-30T09:00:30.000Z' },
      job,
      now: new Date('2026-08-30T16:00:00.000Z'),
    });
    expect(stamp).toBe('2026-08-30T11:00:00.000Z');
  });

  it('prefers a later sighting over the allotted end for a shift that ran over', () => {
    // Still being seen on site at 12:30 means they did not leave at the 11:00
    // they were booked until.
    const stamp = autoCheckoutTimestamp({
      observedDepartureAt: null,
      checkin: { ...checkin, last_seen_inside_at: '2026-08-30T12:30:00.000Z' },
      job,
      now: new Date('2026-08-30T16:00:00.000Z'),
    });
    expect(stamp).toBe('2026-08-30T12:30:00.000Z');
  });

  it('never writes a check-out before they arrived', () => {
    const stamp = autoCheckoutTimestamp({
      observedDepartureAt: new Date('2026-08-30T08:00:00.000Z'),
      checkin,
      job,
      now: new Date('2026-08-30T12:00:00.000Z'),
    });
    expect(stamp).toBe(checkin.checked_in_at);
  });

  it('never writes a check-out in the future', () => {
    const now = new Date('2026-08-30T09:30:00.000Z');
    const stamp = autoCheckoutTimestamp({
      observedDepartureAt: new Date('2026-08-30T23:00:00.000Z'),
      checkin,
      job,
      now,
    });
    expect(stamp).toBe(now.toISOString());
  });
});

describe('withinAutoCheckoutGrace', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');
  const auto = (minutesAgo) => ({
    auto_checked_out: true,
    checked_out_at: '2026-08-30T09:00:00.000Z',
    auto_checked_out_at: new Date(now.getTime() - minutesAgo * 60000).toISOString(),
  });

  it('lets a cleaner walk back a recent automatic check-out', () => {
    expect(withinAutoCheckoutGrace(auto(5), now)).toBe(true);
  });

  it('measures from when the app made the call, not the time it wrote down', () => {
    // The catch-up pass records a departure at the allotted end, which can be
    // hours before it actually ran - measuring from that would expire the
    // grace period before the cleaner ever saw it.
    const stale = auto(1);
    stale.checked_out_at = '2026-08-30T04:00:00.000Z';
    expect(withinAutoCheckoutGrace(stale, now)).toBe(true);
  });

  it('closes the window once the grace period has passed', () => {
    expect(withinAutoCheckoutGrace(auto(AUTO_CHECKOUT_GRACE_MS / 60000 + 1), now)).toBe(false);
  });

  it('does not offer to undo a check-out the cleaner made themselves', () => {
    expect(withinAutoCheckoutGrace({ ...auto(5), auto_checked_out: false }, now)).toBe(false);
  });

  it('is false for a shift still open, or one with no record of when it closed', () => {
    expect(withinAutoCheckoutGrace({ auto_checked_out: true, checked_out_at: null }, now)).toBe(false);
    expect(withinAutoCheckoutGrace({ ...auto(5), auto_checked_out_at: null }, now)).toBe(false);
    expect(withinAutoCheckoutGrace(null, now)).toBe(false);
  });
});
