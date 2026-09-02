// When the clock and the booking disagree about how long a shift was.
//
// Hours are paid from a job's booked duration_minutes, never from the
// check-in timestamps (see lib/hoursWorked.js for why - a check-out is
// frequently never recorded, and duration_minutes always exists). That is a
// reasonable rule right up until somebody checks in and out again three
// seconds later, at which point an eight-hour shift pays in full for having
// tapped a button twice. That has happened, on a real job, and nothing on any
// screen said a word about it.
//
// So the clock stops being the source of hours and becomes a witness against
// them: it cannot set the figure, but it can say the figure looks wrong.
//
// Mirrored in migration 0079. Change the ratio here, change it there.

// A shift has to clock at least this share of the time allocated to the job
// before it completes and pays on its own. Under it, the job stays open and
// the office is asked to confirm the hours.
//
// Set deliberately high: the office would rather look at a shift that
// finished early than pay one that never happened. The cost is that an
// ordinary early finish needs confirming too, so this queue is expected to
// have real traffic in it - it is a review step, not an exception report.
export const SHORT_SHIFT_RATIO = 0.8;

const DEFAULT_DURATION_MINUTES = 120;

// Total minutes actually clocked on a job, across everyone on it. Open
// check-ins count as nothing rather than as time still running: this is asked
// at the moment somebody checks out, and an open row belongs to a teammate
// who has not finished, whose time is not yet evidence of anything.
export function clockedMinutes(checkins) {
  return (checkins || []).reduce((total, c) => {
    if (!c.checked_in_at || !c.checked_out_at) return total;
    return total + (new Date(c.checked_out_at) - new Date(c.checked_in_at)) / 60000;
  }, 0);
}

// How the clocked time compares with what the job pays. `ratio` is null when
// there is nothing to compare against, which reads as "no opinion" rather
// than as zero - a job nobody has finished on, or one with no booked
// duration, must not be held back for a shortfall nobody can measure.
export function shiftShortfall(job, checkins) {
  const booked = job?.duration_minutes || DEFAULT_DURATION_MINUTES;
  const clocked = clockedMinutes(checkins);
  const anyClosed = (checkins || []).some((c) => c.checked_in_at && c.checked_out_at);

  if (!anyClosed || booked <= 0) {
    return { clocked, booked, ratio: null, isShort: false };
  }

  const ratio = clocked / booked;
  return { clocked, booked, ratio, isShort: ratio < SHORT_SHIFT_RATIO };
}

// "3m clocked of 8h booked" - the sentence an admin needs to make the call,
// with both halves in the same breath. A bare percentage would not tell them
// whether they are looking at a mis-tap or a slightly early finish.
export function describeShortfall({ clocked, booked }) {
  const fmt = (mins) => {
    const m = Math.round(mins);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  };
  return `${fmt(clocked)} clocked of ${fmt(booked)} booked`;
}
