// What a client should be told about a visit right now.
//
// The check-in rows already say when each cleaner arrived and left. The
// client portal showed them as a log after the fact and nothing while it
// was happening, so "is anyone at my house?" was a phone call to the
// office. This turns those rows into one live line per visit: who is on
// site and since when, who has finished, or that nobody has arrived yet.
//
// Pure, so the wording and the edge cases (two cleaners, one gone and one
// still there; an automatic check-out; a job closed with no check-in) can
// be tested without a browser.

export const DEFAULT_DURATION_MINUTES = 120;

function nameOf(row) {
  return row?.profiles?.full_name || 'Your cleaner';
}

function clock(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || 'Your cleaner';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// One of: 'on_site' | 'finished' | 'expected' | 'late' | 'missed' | 'past'
export function siteStatusFor(job, checkins, now = new Date()) {
  const rows = (checkins || []).filter((c) => c && c.checked_in_at);
  const onSite = rows.filter((c) => !c.checked_out_at);
  const gone = rows.filter((c) => c.checked_out_at);
  const start = new Date(job.scheduled_at);
  const end = new Date(start.getTime() + (job.duration_minutes || DEFAULT_DURATION_MINUTES) * 60000);

  if (onSite.length > 0) {
    const earliest = onSite.reduce((min, c) => (new Date(c.checked_in_at) < min ? new Date(c.checked_in_at) : min), new Date(onSite[0].checked_in_at));
    const names = onSite.map(nameOf);
    return {
      state: 'on_site',
      label: `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} on site`,
      detail: `since ${clock(earliest)}`,
      since: earliest,
    };
  }

  if (gone.length > 0) {
    const latest = gone.reduce((max, c) => (new Date(c.checked_out_at) > max ? new Date(c.checked_out_at) : max), new Date(gone[0].checked_out_at));
    const names = [...new Set(gone.map(nameOf))];
    return {
      state: 'finished',
      label: `${joinNames(names)} ${names.length === 1 ? 'has' : 'have'} finished`,
      detail: `left at ${clock(latest)}`,
      since: latest,
    };
  }

  if (job.status === 'missed') {
    return { state: 'missed', label: 'This visit was missed', detail: 'the office has been told', since: null };
  }

  if (job.status === 'completed') {
    // Completed with no check-in row that has a time - recorded by the
    // office after the fact. Say it happened, not when.
    return { state: 'finished', label: 'This visit was completed', detail: '', since: null };
  }

  if (now < start) {
    return { state: 'expected', label: 'Not arrived yet', detail: `expected at ${clock(start)}`, since: null };
  }
  if (now <= end) {
    return { state: 'late', label: 'Not arrived yet', detail: `was expected at ${clock(start)}`, since: null };
  }
  return { state: 'past', label: 'No arrival recorded', detail: `was booked for ${clock(start)}`, since: null };
}

// The visits a client cares about on the dashboard right now: anything
// today, plus anything from earlier still showing someone on site (an
// overnight job, or a check-out that never came). Earliest first.
export function visitsToShow(jobs, checkinsByJob, now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);

  return (jobs || [])
    .filter((job) => {
      const at = new Date(job.scheduled_at);
      if (at >= dayStart && at < dayEnd) return true;
      const rows = checkinsByJob?.[job.id] || [];
      return at < dayStart && rows.some((c) => c.checked_in_at && !c.checked_out_at);
    })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
}
