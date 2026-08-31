// Jobs that run at the same time, and the ones that shouldn't.
//
// Two separate questions live here, and the rota needs both:
//
//   1. Which jobs in a day share a slice of clock? Drawn as separate bars
//      they sit on top of each other and the week becomes unreadable, so
//      the calendar draws one block per overlapping run instead.
//   2. Is the same person on two of them? That isn't a drawing problem,
//      it's a mistake - nobody can be at two properties at once - so it
//      gets its own colour and says whose diary is clashing.
//
// A job with no duration set is treated as two hours, matching the rota
// and the dashboard's own fallbacks.

export const DEFAULT_DURATION_MINUTES = 120;

function startOf(job) {
  return new Date(job.scheduled_at).getTime();
}

function endOf(job) {
  return startOf(job) + (job.duration_minutes || DEFAULT_DURATION_MINUTES) * 60000;
}

function cleanerIds(job) {
  return (job.job_assignments || []).map((a) => a.cleaner_id).filter(Boolean);
}

function cleanerName(job, cleanerId) {
  const match = (job.job_assignments || []).find((a) => a.cleaner_id === cleanerId);
  return match?.profiles?.full_name || 'Someone';
}

// "Jane Kaminski" -> "J. Kaminski". A grouped block gives each entry one
// short line, and a full name pushes the address out of it.
export function abbreviateName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

export function jobsOverlap(a, b) {
  return startOf(a) < endOf(b) && startOf(b) < endOf(a);
}

// The same cleaner on two jobs that genuinely overlap each other - not
// merely two jobs that landed in the same group. A group is built
// transitively (9-10, 9:30-11, 10:30-12 is one run), so its first and
// last members need not overlap at all; flagging those as double-booked
// would put a red block on a diary that's actually fine.
function findDoubleBooking(jobs) {
  for (let i = 0; i < jobs.length; i += 1) {
    for (let j = i + 1; j < jobs.length; j += 1) {
      if (!jobsOverlap(jobs[i], jobs[j])) continue;
      const shared = cleanerIds(jobs[i]).find((id) => cleanerIds(jobs[j]).includes(id));
      if (shared) return { cleanerId: shared, name: cleanerName(jobs[i], shared) };
    }
  }
  return null;
}

// Groups a single day's jobs into runs of overlapping time. A run of one
// is still returned as a group - the caller draws it as an ordinary card -
// so there's only ever one list to render from.
export function groupOverlappingJobs(jobs) {
  const sorted = [...(jobs || [])].sort((a, b) => startOf(a) - startOf(b));
  const groups = [];

  sorted.forEach((job) => {
    const current = groups[groups.length - 1];
    // Compared against the run's furthest end, not the previous job's, so a
    // long job early on still catches everything that starts underneath it.
    if (current && startOf(job) < current.end) {
      current.jobs.push(job);
      current.end = Math.max(current.end, endOf(job));
      return;
    }
    groups.push({ jobs: [job], start: startOf(job), end: endOf(job) });
  });

  return groups.map((group) => {
    const clash = group.jobs.length > 1 ? findDoubleBooking(group.jobs) : null;
    return {
      id: group.jobs.map((j) => j.id).join('+'),
      jobs: group.jobs,
      start: new Date(group.start),
      end: new Date(group.end),
      doubleBooked: !!clash,
      doubleBookedName: clash ? clash.name : null,
    };
  });
}

// Week-level count for the stat row and for anywhere that wants to warn
// before saving. Counts groups, not jobs, so one three-way clash is one
// problem to go and fix rather than three.
export function countDoubleBookings(jobs) {
  const byDay = new Map();
  (jobs || []).forEach((job) => {
    const key = new Date(job.scheduled_at).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(job);
  });

  let count = 0;
  byDay.forEach((dayJobs) => {
    groupOverlappingJobs(dayJobs).forEach((g) => { if (g.doubleBooked) count += 1; });
  });
  return count;
}

// Side-by-side lanes for an opened-out group. The block collapses a run of
// jobs into a list because bars drawn on the clock would cover each other;
// opened out, the jobs go back onto their real start times, so they need
// somewhere to sit that isn't on top of one another.
//
// Greedy by start time: a job takes the first lane whose previous occupant
// has already finished. Jobs that merely share a group - 9-10 and 10:30-12
// in the same transitive run - therefore share a lane rather than each
// claiming their own, which keeps the cards as wide as they can be.
//
// Every job in the group is measured against the same lane count, so the
// column reads as a grid rather than as cards that change width partway
// down. That costs some width where only one job is running, and buys a
// straight edge to scan down.
export function assignLanes(jobs) {
  const sorted = [...(jobs || [])].sort(
    (a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)
  );
  const laneEnds = [];
  const placed = sorted.map((job) => {
    const start = new Date(job.scheduled_at).getTime();
    const end = start + (job.duration_minutes || DEFAULT_DURATION_MINUTES) * 60000;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    return { job, lane };
  });

  // A lane count fixed by the busiest minute would leave the quiet end of a
  // run on a quarter of the column for no reason - and at that width a card
  // shows one letter of the client's name. So each card then reaches right
  // across any lane that holds nothing overlapping it. Stopping at the first
  // lane that does is what keeps this from putting two cards in one place.
  const lanes = Math.max(1, laneEnds.length);
  placed.forEach((entry) => {
    let span = 1;
    for (let lane = entry.lane + 1; lane < lanes; lane += 1) {
      const blocked = placed.some(
        (other) => other.lane === lane && jobsOverlap(entry.job, other.job)
      );
      if (blocked) break;
      span += 1;
    }
    entry.span = span;
  });

  return { lanes, placed };
}
