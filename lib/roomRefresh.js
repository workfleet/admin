// Fortnightly room refreshes (0150, 0151). A property with a room list has
// its communal areas cleaned on every visit and each room refreshed at least
// once a fortnight. The office plans which rooms each visit covers and marks
// any that weren't done; the cleaner just sees the list. This works out,
// from the visits, when each room was last done and when it's next booked.
//
// No imports, so the monthly invoice script can load it straight into Node.

// Every room and the communal areas are due again after this many days.
export const REFRESH_EVERY_DAYS = 14;
// Flagged amber this many days before it falls due with nothing booked.
export const DUE_SOON_DAYS = 4;

// Booked minutes per room when the client has none set (0150's default).
export const DEFAULT_ROOM_MINUTES = 15;

export const roomMinutesFor = (client) => {
  const n = Number(client?.room_refresh_minutes);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROOM_MINUTES;
};

export const roomListOf = (property) =>
  (Array.isArray(property?.rooms) ? property.rooms : []).map((r) => String(r || '').trim()).filter(Boolean);

// "Room 1, Room 2" or one per line, as typed by the office. Duplicates and
// blanks are dropped, order kept.
export function parseRoomList(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text || '').split(/[\n,]+/)) {
    const room = part.trim().replace(/\s+/g, ' ');
    if (!room || seen.has(room.toLowerCase())) continue;
    seen.add(room.toLowerCase());
    out.push(room);
  }
  return out;
}

// "6" -> Room 1..Room 6, for a house that just numbers its rooms.
export const numberedRooms = (count) =>
  Array.from({ length: Math.max(0, Math.min(40, Math.floor(Number(count) || 0))) }, (_, i) => `Room ${i + 1}`);

// The UK calendar date of an instant, as YYYY-MM-DD.
export const ukDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);

// Does the room list apply to a visit at this time? Only from the date it
// was set up.
export function roomsApply(property, scheduledAt) {
  if (roomListOf(property).length === 0 || !property?.rooms_tracked_since) return false;
  return ukDay(scheduledAt) >= String(property.rooms_tracked_since).slice(0, 10);
}

// Rooms planned on a visit (whether or not they were then done).
export function plannedRooms(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return new Set(list.map((r) => String(r?.room || '').trim()).filter(Boolean));
}

// Rooms done on a visit: planned and not marked as not done (0151).
export function ticked(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return new Set(list.filter((r) => !r?.skipped).map((r) => String(r?.room || '').trim()).filter(Boolean));
}

// Rooms the office marked as not done on a visit.
export function skippedRooms(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return new Set(list.filter((r) => r?.skipped).map((r) => String(r?.room || '').trim()).filter(Boolean));
}

const DONE = ['completed', 'in_progress'];

// One property's tracker: the communal areas and each room, with when it
// was last done (and on which visit), the next visit it's booked on, when
// it falls due, and a status:
//   'booked'  booked on a visit on or before it falls due
//   'ok'      in date, nothing booked yet but not due for a while
//   'due'     falls due within DUE_SOON_DAYS with nothing booked in time
//   'overdue' past due with nothing booked in time
// Until something has been done once, it falls due REFRESH_EVERY_DAYS after
// tracking started.
export function trackerRows({ property, jobs, today, everyDays = REFRESH_EVERY_DAYS, soonDays = DUE_SOON_DAYS }) {
  const rooms = roomListOf(property);
  if (rooms.length === 0 || !property?.rooms_tracked_since) return { rows: [], nextVisit: null, lastVisit: null };
  const since = String(property.rooms_tracked_since).slice(0, 10);
  const mine = (jobs || [])
    .filter((j) => j.property_id === property.id)
    .map((j) => ({ ...j, day: ukDay(j.scheduled_at) }))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  // Refreshes done before tracking began count too, so "last done" is right
  // from day one; the start date only sets when a room never done falls due.
  const done = mine.filter((j) => DONE.includes(j.status) && j.day <= today);
  const upcoming = mine.filter((j) => j.status === 'scheduled' && j.day >= today);
  const lastVisit = done[done.length - 1] || null;
  const nextVisit = upcoming[0] || null;

  const row = (label, lastJob, nextJob, extra = {}) => {
    const last = lastJob?.day || null;
    const dueDay = addDays(last || since, everyDays);
    const next = nextJob?.day || null;
    const daysLeft = daysBetween(today, dueDay);
    let status;
    if (next && next <= dueDay) status = 'booked';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= soonDays) status = 'due';
    else status = 'ok';
    return { label, last, lastJobId: lastJob?.id || null, next, nextJobId: nextJob?.id || null, dueDay, daysLeft, status, ...extra };
  };

  const rows = [row('Communal areas', lastVisit, nextVisit, { communal: true })];
  for (const room of rooms) {
    const lastJob = [...done].reverse().find((j) => ticked(j).has(room)) || null;
    const nextJob = upcoming.find((j) => plannedRooms(j).has(room)) || null;
    // A room the office marked not done on the most recent visit it was
    // planned for - worth saying, so it's booked again.
    const lastPlanned = [...done].reverse().find((j) => plannedRooms(j).has(room)) || null;
    const missedOn = lastPlanned && skippedRooms(lastPlanned).has(room) ? lastPlanned.day : null;
    rows.push(row(room, lastJob, nextJob, { room, missedOn, lastPlannedJobId: lastPlanned?.id || null, lastPlannedDone: !!lastPlanned && !missedOn }));
  }
  return { rows, nextVisit, lastVisit };
}

// What is overdue at each tracked property as of `today` (YYYY-MM-DD): the
// communal clean and every room past due with nothing booked in time.
export function overdueRooms({ properties, jobs, today, everyDays = REFRESH_EVERY_DAYS }) {
  const out = [];
  for (const property of properties || []) {
    const { rows } = trackerRows({ property, jobs, today, everyDays });
    const items = rows
      .filter((r) => r.status === 'overdue')
      .map((r) => ({ label: r.label, last: r.last, days: daysBetween(r.last || String(property.rooms_tracked_since).slice(0, 10), today) }));
    if (items.length > 0) out.push({ propertyId: property.id, address: property.address, items });
  }
  return out;
}
