// Fortnightly room refreshes (0150). A property with a room list has its
// communal areas cleaned and every room refreshed on each visit; cleaners
// tick each room on the job, and only ticked rooms are charged.
//
// With the extension-free import style the rest of lib uses, but no imports
// of its own, so the monthly invoice script can load it straight into Node.

// Every room and the communal areas are due again after this many days.
export const REFRESH_EVERY_DAYS = 14;

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

// Does the room list apply to a visit at this time? Only from the date it
// was set up, so a past month's invoice never changes.
export function roomsApply(property, scheduledAt) {
  if (roomListOf(property).length === 0 || !property?.rooms_tracked_since) return false;
  return ukDay(scheduledAt) >= String(property.rooms_tracked_since).slice(0, 10);
}

// Rooms ticked on a visit, by name.
export function ticked(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return new Set(list.map((r) => String(r?.room || '').trim()).filter(Boolean));
}

// Communal clean plus every room: how long a visit should be booked for.
export const plannedMinutes = (property, client, communalMinutes = 60) =>
  communalMinutes + roomListOf(property).length * roomMinutesFor(client);

const DONE = ['completed', 'in_progress'];
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000);

// What is overdue at each tracked property as of `today` (YYYY-MM-DD):
// the communal clean and every room, each due REFRESH_EVERY_DAYS after it
// was last done. Until something has been done once, it's due
// REFRESH_EVERY_DAYS after tracking started. Visits after today are ignored.
export function overdueRooms({ properties, jobs, today, everyDays = REFRESH_EVERY_DAYS }) {
  const out = [];
  for (const property of properties || []) {
    const rooms = roomListOf(property);
    if (rooms.length === 0 || !property.rooms_tracked_since) continue;
    const since = String(property.rooms_tracked_since).slice(0, 10);
    const visits = (jobs || [])
      .filter((j) => j.property_id === property.id && DONE.includes(j.status))
      .map((j) => ({ day: ukDay(j.scheduled_at), rooms: ticked(j) }))
      .filter((v) => v.day >= since && v.day <= today);

    const lastCommunal = visits.reduce((d, v) => (v.day > d ? v.day : d), '');
    const items = [];
    const check = (label, last) => {
      const from = last || since;
      const age = daysBetween(from, today);
      if (age >= everyDays) items.push({ label, last: last || null, days: age });
    };
    check('Communal areas', lastCommunal);
    for (const room of rooms) {
      check(room, visits.filter((v) => v.rooms.has(room)).reduce((d, v) => (v.day > d ? v.day : d), ''));
    }
    if (items.length > 0) out.push({ propertyId: property.id, address: property.address, items });
  }
  return out;
}
