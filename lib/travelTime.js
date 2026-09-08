// Can this cleaner actually get from one job to the next?
//
// The rota has always caught two jobs on one person at the same time
// (lib/jobOverlap.js). It never caught 09:00-11:00 in Gorseinon followed by
// 11:00 in Mumbles, which is not a clash on the clock and is still a job
// somebody arrives at twenty-five minutes late. Those are the schedules
// that produce the late check-ins, the short shifts and the "can't make
// it" messages the rest of the app then has to mop up.
//
// This is an estimate, and says so. Straight-line distance between the two
// property pins, stretched for roads, at an urban average, plus a few
// minutes to park and get to the door. It will be wrong by a few minutes
// either way; it is right about which gaps are impossible, and that is the
// question the office needs answered before saving.
import { distanceMeters } from './geo';

// Roads are not straight. 1.3 is the usual planning multiplier for UK
// urban and suburban trips.
export const ROAD_FACTOR = 1.3;

// Door-to-door average including junctions and the odd queue. Deliberately
// conservative: a warning that fires on a gap that turns out fine costs a
// glance; one that stays quiet on a gap that was never achievable costs a
// late arrival.
export const AVERAGE_SPEED_KMH = 30;

// Parking, the walk in, the key safe. Paid on every leg however short.
export const DOOR_TO_DOOR_MINUTES = 5;

export const DEFAULT_DURATION_MINUTES = 120;

function hasPin(property) {
  return property && property.lat != null && property.lng != null;
}

// Minutes to travel between two properties, or null when either has no
// pin - an unknown is reported as unknown, never as "no time needed".
export function estimateTravelMinutes(from, to) {
  if (!hasPin(from) || !hasPin(to)) return null;
  const km = (distanceMeters(from.lat, from.lng, to.lat, to.lng) / 1000) * ROAD_FACTOR;
  // Same building, or next door: no drive, still the walk in.
  if (km < 0.15) return DOOR_TO_DOOR_MINUTES;
  return Math.ceil((km / AVERAGE_SPEED_KMH) * 60 + DOOR_TO_DOOR_MINUTES);
}

function startOf(job) {
  return new Date(job.scheduled_at).getTime();
}

function endOf(job) {
  return startOf(job) + (job.duration_minutes || DEFAULT_DURATION_MINUTES) * 60000;
}

function dayKey(job) {
  return new Date(job.scheduled_at).toDateString();
}

// Every place in a set of jobs where one cleaner's next job starts sooner
// than they could get there. Jobs that overlap outright are left to the
// double-booking check; this is about the gap in between.
//
// Returns one entry per (cleaner, consecutive pair), with the gap and the
// estimate, so the caller can say "10 min gap, about 25 min drive".
export function findTightTurnarounds(jobs) {
  const byCleanerDay = new Map();

  (jobs || []).forEach((job) => {
    if (!job || !job.scheduled_at) return;
    (job.job_assignments || []).forEach((a) => {
      if (!a || !a.cleaner_id) return;
      const key = `${a.cleaner_id}|${dayKey(job)}`;
      if (!byCleanerDay.has(key)) {
        byCleanerDay.set(key, { cleanerId: a.cleaner_id, name: a.profiles?.full_name || 'Someone', jobs: [] });
      }
      byCleanerDay.get(key).jobs.push(job);
    });
  });

  const tight = [];
  byCleanerDay.forEach(({ cleanerId, name, jobs: dayJobs }) => {
    const sorted = [...dayJobs].sort((a, b) => startOf(a) - startOf(b));
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const gapMinutes = Math.round((startOf(to) - endOf(from)) / 60000);
      if (gapMinutes < 0) continue; // an outright overlap - the clash check owns that
      const travelMinutes = estimateTravelMinutes(from.properties, to.properties);
      if (travelMinutes == null) continue;
      if (gapMinutes < travelMinutes) {
        tight.push({ cleanerId, name, from, to, gapMinutes, travelMinutes });
      }
    }
  });

  return tight.sort((a, b) => startOf(a.to) - startOf(b.to));
}

function clock(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// One line the office can act on.
export function describeTurnaround(t) {
  const fromAddr = t.from.properties?.address || 'the previous job';
  const toAddr = t.to.properties?.address || 'the next job';
  const gap = t.gapMinutes === 0 ? 'no gap' : `${t.gapMinutes} min gap`;
  return `${t.name}: ${fromAddr} ends ${clock(endOf(t.from))}, ${toAddr} starts ${clock(t.to.scheduled_at)} - ${gap}, about ${t.travelMinutes} min to get there.`;
}
