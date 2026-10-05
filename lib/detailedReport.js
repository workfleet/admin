// Detailed reports: a visit written up room by room, and a month of visits
// at one property gathered into a single report for the letting agent.
//
// The pure parts live here so they can be tested without the API or the
// database: which rooms a report covers, what to ask the model for, how to
// read its answer back, and how a month's visits add up.

// More than the eight a standard report sends, because each room wants a
// picture. Photos are resized to 1600px on upload, so this is still a small
// request.
export const MAX_DETAILED_PHOTOS = 12;

// At most this many photos per room in the PDF, so a month of visits stays
// a document someone will open rather than a photo album.
export const MAX_PHOTOS_PER_ROOM = 2;

// When a visit has no room report to choose photos from, the PDF still
// shows some of what was seen.
export const MAX_PHOTOS_PER_VISIT = 4;

export const CONDITIONS = {
  good: 'Good',
  fair: 'Fair',
  needs_attention: 'Needs attention',
};

// The rooms the office has written down for this property (the checklist,
// 0054), in their order. Empty when there is no checklist, and the model
// then names the rooms from what it can see and what the notes say.
export function checklistRooms(checklistItems) {
  const seen = new Set();
  const rooms = [];
  (checklistItems || []).forEach((item) => {
    const room = String(item.room || '').trim();
    if (!room || seen.has(room.toLowerCase())) return;
    seen.add(room.toLowerCase());
    rooms.push(room);
  });
  return rooms;
}

export function roomPromptSection({ rooms, photoCount }) {
  const roomLine = rooms.length > 0
    ? `Write one entry for each of these rooms, in this order: ${rooms.join(', ')}. Add an entry for any other area that the notes or photos clearly cover (for example a communal hallway or the bins).`
    : 'There is no room list for this property. Write one entry per room or area that the notes or photos show - use plain names a letting agent would use (Kitchen, Bathroom, Bedroom 1, Living room, Hallway and stairs, Communal areas, Bins and outside). Do not invent rooms that nothing shows.';

  return `This report is written room by room.
${roomLine}

The photos are numbered 1 to ${photoCount} in the order they are attached.

Also include a "rooms" array, each entry in exactly this shape:
{"room": "Kitchen", "condition": "good" | "fair" | "needs_attention", "work_done": "...", "issues": "...", "photos": [1, 3]}
- "condition" is the state the room was left in. Use "needs_attention" only for something the agent should act on.
- "work_done" is one or two sentences on what was cleaned there.
- "issues" is anything wrong in that room, or "None noted." if nothing.
- "photos" lists the numbers of the photos that clearly show that room (an empty list if none do). Use each number for at most one room.
- If a room is on the list but nothing in the notes or photos covers it, still include it, with condition "fair", work_done "Not recorded on this visit.", and an empty photos list. Never describe a room you cannot see or read about.`;
}

// The model's rooms, checked and with photo numbers turned into photo ids.
// Anything malformed is dropped rather than failing the whole report.
export function parseRooms(rawRooms, photoIds) {
  if (!Array.isArray(rawRooms)) return null;
  const used = new Set();

  const rooms = rawRooms
    .filter((r) => r && typeof r.room === 'string' && r.room.trim())
    .map((r) => {
      const ids = (Array.isArray(r.photos) ? r.photos : [])
        .map((n) => photoIds[Number(n) - 1])
        .filter((id) => id && !used.has(id));
      ids.forEach((id) => used.add(id));

      return {
        room: r.room.trim(),
        condition: CONDITIONS[r.condition] ? r.condition : 'fair',
        work_done: typeof r.work_done === 'string' ? r.work_done.trim() : '',
        issues: typeof r.issues === 'string' ? r.issues.trim() : '',
        photo_ids: ids,
      };
    });

  return rooms.length > 0 ? rooms : null;
}

// "2026-10" -> the first moment of that month and of the next, as ISO
// strings for a scheduled_at range. Month boundaries are taken in UTC; jobs
// are daytime cleans, so the hour of BST at either end never moves one.
export function monthBounds(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return null;
  return {
    start: new Date(Date.UTC(year, index, 1)).toISOString(),
    end: new Date(Date.UTC(year, index + 1, 1)).toISOString(),
  };
}

export function monthLabel(month) {
  const bounds = monthBounds(month);
  if (!bounds) return '';
  return new Date(bounds.start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// The last n months, newest first, for a picker.
export function recentMonths(n = 12, now = new Date()) {
  const months = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// Minutes on site across everyone who checked in and out. A check-in with
// no check-out isn't counted - it would be a guess.
export function minutesOnSite(checkins) {
  return (checkins || []).reduce((total, c) => {
    if (!c.checked_in_at || !c.checked_out_at) return total;
    const minutes = (new Date(c.checked_out_at) - new Date(c.checked_in_at)) / 60000;
    return minutes > 0 ? total + minutes : total;
  }, 0);
}

export function formatDuration(minutes) {
  const rounded = Math.round(minutes || 0);
  if (rounded <= 0) return '—';
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// What the month adds up to, for the summary at the top of the report.
// Visits are the jobs as loaded by loadDetailedReport below.
export function summariseVisits(visits) {
  const completed = visits.filter((v) => v.status === 'completed' || v.status === 'in_progress');
  const missed = visits.filter((v) => v.status === 'missed');
  const roomsNeedingAttention = [];
  completed.forEach((v) => {
    (v.report?.rooms || []).forEach((r) => {
      if (r.condition === 'needs_attention') roomsNeedingAttention.push({ date: v.scheduled_at, room: r.room, issues: r.issues });
    });
  });

  return {
    visitCount: completed.length,
    missedCount: missed.length,
    minutes: completed.reduce((t, v) => t + v.minutes, 0),
    reportCount: completed.filter((v) => v.report).length,
    roomsNeedingAttention,
  };
}

// Everything the report needs, read with the service key. `sharedOnly`
// keeps out any job report the office hasn't ticked "Add to client
// portal" on: the PDF is what the client sees, whoever downloads it.
//
// Pass either jobId (one visit) or propertyId + month.
export async function loadDetailedReport(sb, { jobId, propertyId, month, sharedOnly = true }) {
  let query = sb
    .from('jobs')
    .select('id, scheduled_at, status, property_id, properties(id, address, client_id, clients(id, name)), job_assignments(profiles(full_name))')
    .order('scheduled_at', { ascending: true });

  if (jobId) {
    query = query.eq('id', jobId);
  } else {
    const bounds = monthBounds(month);
    if (!propertyId || !bounds) return null;
    query = query
      .eq('property_id', propertyId)
      .gte('scheduled_at', bounds.start)
      .lt('scheduled_at', bounds.end)
      .in('status', ['completed', 'in_progress', 'missed']);
  }

  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) {
    if (jobId) return null;
    const { data: property } = await sb.from('properties').select('id, address, client_id, clients(id, name)').eq('id', propertyId).maybeSingle();
    return property ? { property, visits: [] } : null;
  }

  const jobIds = jobs.map((j) => j.id);
  let reportQuery = sb.from('job_reports').select('job_id, summary, issues, suggestions, rooms, template, visible_to_client').in('job_id', jobIds);
  if (sharedOnly) reportQuery = reportQuery.eq('visible_to_client', true);

  const [{ data: reports }, { data: checkins }, { data: photos }] = await Promise.all([
    reportQuery,
    sb.from('checkins').select('job_id, checked_in_at, checked_out_at').in('job_id', jobIds),
    sb.from('photos').select('id, job_id, url, created_at').in('job_id', jobIds).order('created_at', { ascending: true }),
  ]);

  const visits = jobs.map((job) => ({
    id: job.id,
    scheduled_at: job.scheduled_at,
    status: job.status,
    staff: (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean),
    minutes: minutesOnSite((checkins || []).filter((c) => c.job_id === job.id)),
    report: (reports || []).find((r) => r.job_id === job.id) || null,
    photos: (photos || []).filter((p) => p.job_id === job.id),
  }));

  return { property: jobs[0].properties, visits };
}

// The photos the PDF will print for a visit: the ones the room report
// matched to each room (a few per room), or failing that the last few
// taken.
export function photosToPrint(visit) {
  const byId = new Map(visit.photos.map((p) => [p.id, p]));
  if (visit.report?.rooms?.length) {
    return visit.report.rooms.flatMap((r) => (r.photo_ids || []).slice(0, MAX_PHOTOS_PER_ROOM).map((id) => byId.get(id)).filter(Boolean));
  }
  return visit.photos.slice(-MAX_PHOTOS_PER_VISIT);
}
