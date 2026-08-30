// Closing a cleaner's shift for them when they leave the property.
//
// The rules live here rather than in the two places that apply them (the
// live watch on the job page, and the catch-up pass that runs when the app
// is next opened) so both can't drift into disagreeing about what counts
// as "gone" - the sort of split that ends with one screen saying someone
// is still on site and another saying they left an hour ago.
//
// What browsers can and can't do shapes all of this. There is no
// background geofencing on the web: a location watch only runs while the
// page is alive and awake, and a locked phone in a pocket stops reporting
// almost immediately. So departure is detected on a best-effort basis and
// every auto-written check-out is flagged as one - see 0072.
import { supabase } from './supabaseClient';
import { distanceMeters, GEOFENCE_RADIUS_METERS } from './geo';

// Deliberately wider than the radius that lets someone check IN. Checking
// in is a one-off with the phone in hand; leaving is judged from readings
// taken over an hour or more, where drift of a few tens of metres is
// routine. A single band would flip someone in and out of their own shift
// while they stood still, so 75m gets you on site and it takes 150m to be
// counted as having left.
export const AUTO_CHECKOUT_RADIUS_METERS = 150;

// A fix this vague can read as 200m away while someone stands in the
// kitchen - indoors on a bad day that's most of them. Better to hold the
// last confident answer than to end a shift on a guess.
export const MIN_ACCURACY_METERS = 100;

// How long they have to stay outside before it counts. Covers the walk to
// the van for more kit, and the corner shop at lunch.
export const DEPARTURE_DWELL_MS = 3 * 60 * 1000;

// Never end a shift in the first few minutes: the first fix after
// check-in is often the worst one of the day, and being auto-checked-out
// seconds after arriving is the failure that would make cleaners stop
// trusting the button.
export const MIN_ONSITE_MS = 5 * 60 * 1000;

// How long a cleaner has to undo an automatic check-out by walking back
// in. Long enough to cover the errand that triggered it, short enough
// that finished work settles into history the same day. Mirrored in
// resume_auto_checkout() - change one, change both.
export const AUTO_CHECKOUT_GRACE_MS = 30 * 60 * 1000;

// How often the live watch writes "still here" to the row. Frequent
// enough that a page dying mid-shift doesn't lose much, rare enough not
// to be a write every few seconds for hours.
export const INSIDE_PERSIST_INTERVAL_MS = 2 * 60 * 1000;

// Three-way on purpose. The band between the two radii is "can't tell",
// not "left" - and it doesn't refresh last-seen-inside either, so a
// borderline reading never becomes evidence in either direction.
export function classifyFix(fix, property) {
  if (!property || property.lat == null || property.lng == null) return 'unknown';
  if (!fix || fix.lat == null || fix.lng == null) return 'unknown';
  if (fix.accuracy != null && fix.accuracy > MIN_ACCURACY_METERS) return 'unknown';

  const distance = distanceMeters(fix.lat, fix.lng, property.lat, property.lng);
  if (distance <= GEOFENCE_RADIUS_METERS) return 'inside';
  if (distance > AUTO_CHECKOUT_RADIUS_METERS) return 'outside';
  return 'near';
}

// Departure state advanced one fix at a time: { lastInsideAt, outsideSince }.
// Anything other than a confident reading holds the current state, so a
// spell of bad signal on the way out doesn't restart the dwell timer.
export function nextDepartureState(state, classification, at) {
  if (classification === 'inside') return { lastInsideAt: at, outsideSince: null };
  if (classification === 'outside') return { ...state, outsideSince: state.outsideSince || at };
  return state;
}

export function shouldAutoCheckOut(state, checkedInAt, now) {
  if (!state.outsideSince) return false;
  if (now - new Date(checkedInAt) < MIN_ONSITE_MS) return false;
  return now - state.outsideSince >= DEPARTURE_DWELL_MS;
}

function scheduledEnd(job, now) {
  if (!job?.scheduled_at) return now;
  const end = new Date(job.scheduled_at).getTime() + (job.duration_minutes || 0) * 60000;
  return new Date(end);
}

// What time to write down, which depends entirely on what was actually
// witnessed:
//
//   - A watch that saw them inside and then outside knows roughly when
//     they left, so it says so.
//   - The catch-up pass knows only that they're elsewhere NOW. It could
//     have been five minutes or five hours ago, and last-seen-inside is
//     no help - on a locked phone that's usually a few seconds after
//     check-in, which would write down a shift that never happened. So it
//     falls back to the job's allocated end, which is the same assumption
//     reconcile_job_statuses() and lib/hoursWorked.js already make.
//
// Clamped either way: never before they arrived, never in the future.
export function autoCheckoutTimestamp({ observedDepartureAt, checkin, job, now = new Date() }) {
  const arrived = new Date(checkin.checked_in_at).getTime();
  const lastInside = checkin.last_seen_inside_at ? new Date(checkin.last_seen_inside_at).getTime() : 0;
  const candidate = observedDepartureAt
    ? new Date(observedDepartureAt)
    // Whichever is later: someone who ran over their allotted time and was
    // still being seen on site at 4pm didn't leave at the 3pm they were
    // booked until.
    : new Date(Math.max(scheduledEnd(job, now).getTime(), lastInside));
  const clamped = Math.min(Math.max(candidate.getTime(), arrived), now.getTime());
  return new Date(clamped).toISOString();
}

// The `is('checked_out_at', null)` guard is what makes this safe to call
// from two places at once: if they pressed Check Out on another tab a
// second ago, this updates nothing rather than overwriting the time they
// chose with the one we inferred.
export async function closeCheckin(checkinId, at) {
  const { data, error } = await supabase
    .from('checkins')
    .update({ checked_out_at: at, auto_checked_out: true, auto_checked_out_at: new Date().toISOString() })
    .eq('id', checkinId)
    .is('checked_out_at', null)
    .select('id')
    .maybeSingle();

  return { closed: !error && !!data, error };
}

// Whether an automatic check-out is still fresh enough to walk back from.
// Measured from when the app made the call, not from the time it wrote
// down - the catch-up pass records a departure at the job's allotted end,
// which can be hours before it actually ran.
export function withinAutoCheckoutGrace(checkin, now = new Date()) {
  if (!checkin?.auto_checked_out || !checkin.checked_out_at) return false;
  if (!checkin.auto_checked_out_at) return false;
  return now - new Date(checkin.auto_checked_out_at) <= AUTO_CHECKOUT_GRACE_MS;
}

export async function markSeenInside(checkinId, at) {
  await supabase
    .from('checkins')
    .update({ last_seen_inside_at: at })
    .eq('id', checkinId)
    .is('checked_out_at', null);
}
