// Detailed reports: a visit written up room by room, and a month of visits
// at one property gathered into a single report for the letting agent.
//
// The pure parts live here so they can be tested without the API or the
// database: which rooms a report covers, what to ask the model for, how to
// read its answer back, and how a month's visits add up.

// More than the eight a standard report sends: a visit is photographed on
// arrival and again when done, and each room wants a picture of both.
// Photos are resized to 1600px on upload, so this is still a small request.
export const MAX_DETAILED_PHOTOS = 14;

// At most this many photos per room in the PDF (before and after each), so
// a month of visits stays a document someone will open rather than an album.
export const MAX_PHOTOS_PER_ROOM = 2;

// When a visit has no room report to choose photos from, the PDF still
// shows some of what was seen.
export const MAX_PHOTOS_PER_VISIT = 4;

export const CONDITIONS = {
  good: 'Good',
  fair: 'Fair',
  needs_attention: 'Needs attention',
  not_photographed: 'No photo taken',
};

// Checks a letting agent reads before anything else. They lead the report,
// and a missing photo of one is called out rather than passed over.
const SAFETY_CHECK = /^(fire alarm|fire door|bins?\b)/i;
export function isSafetyCheck(room) {
  return SAFETY_CHECK.test(String(room || '').trim());
}

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

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

// When each photo was taken, against when the cleaner arrived and left.
// The model is told this because the content alone can't separate a "before"
// photo of a messy kitchen from an "after" one that wasn't finished - and
// mistaking one for the other blames the cleaner for the tenants' mess.
export function photoTimeline(photos, checkins) {
  const ins = (checkins || []).map((c) => c.checked_in_at).filter(Boolean).sort();
  const outs = (checkins || []).map((c) => c.checked_out_at).filter(Boolean).sort();
  const arrived = ins[0] || null;
  const left = outs[outs.length - 1] || null;
  const lines = photos.map((p, i) => {
    if (!p.created_at) return `Photo ${i + 1}: time not recorded`;
    const sinceArrival = arrived ? Math.round((new Date(p.created_at) - new Date(arrived)) / 60000) : null;
    const beforeLeaving = left ? Math.round((new Date(left) - new Date(p.created_at)) / 60000) : null;
    const parts = [clock(p.created_at)];
    if (sinceArrival != null) parts.push(`${sinceArrival} min after arriving`);
    if (beforeLeaving != null) parts.push(`${beforeLeaving} min before leaving`);
    return `Photo ${i + 1}: ${parts.join(', ')}`;
  });
  return {
    arrived: arrived ? clock(arrived) : null,
    left: left ? clock(left) : null,
    lines,
  };
}

// The JSON the model must return (structured outputs), so a reply that
// doesn't parse can't reach the database.
export const DETAILED_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['photos', 'summary', 'landlord', 'housekeeping', 'rooms'],
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'shows', 'when'],
        properties: {
          number: { type: 'integer' },
          shows: { type: 'string' },
          when: { type: 'string', enum: ['before', 'after', 'unclear'] },
        },
      },
    },
    summary: { type: 'string' },
    landlord: { type: 'string' },
    housekeeping: { type: 'string' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['room', 'condition', 'on_arrival', 'work_done', 'issues', 'before_photos', 'after_photos'],
        properties: {
          room: { type: 'string' },
          condition: { type: 'string', enum: Object.keys(CONDITIONS) },
          on_arrival: { type: 'string' },
          work_done: { type: 'string' },
          issues: { type: 'string' },
          before_photos: { type: 'array', items: { type: 'integer' } },
          after_photos: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
};

// The whole request for a room-by-room report. Written for the person who
// reads it - a letting agent who wasn't there and should be able to act on
// it without ringing anyone.
export function buildDetailedPrompt({ address, date, staff, timeline, taskList, notes, rooms, photoCount, photoCheckText = '' }) {
  const roomLine = rooms.length > 0
    ? `The property's checklist has these areas, in this order: ${rooms.join(', ')}. Write one entry for each, in that order. Add an entry for any other area a photo clearly shows.`
    : 'There is no checklist for this property. Write one entry per area the photos or notes show, using plain names (Hallway, Stairs, Kitchen, Bathroom, Bins).';

  return `You are writing a visit report for the letting agent who manages this property - a shared house cleaned by our company. The agent wasn't there. The report should tell them how the property was found, what we did, and what they need to deal with, so they can act on it without phoning us.

Property: ${address}
Date: ${date}
Cleaner${staff.length === 1 ? '' : 's'}: ${staff.join(', ') || 'not recorded'}
Arrived: ${timeline.arrived || 'not recorded'}. Left: ${timeline.left || 'not recorded'}.

To-do list for the visit, as ticked off by the cleaner ([x] = done). Each item starts with its area:
${taskList}

Notes from the cleaner or office (may be informal or dictated):
${notes?.trim() || '(none)'}
${photoCheckText}
${photoCount} photos are attached, numbered in the order listed here, with when each was taken:
${timeline.lines.join('\n')}

How to read the photos:
- Cleaners photograph areas as they find them on arrival ("before") and again when finished ("after"). Use the time and what the photo shows: photos in the first part of the visit are usually before, photos near the end are usually after. A messy room photographed soon after arriving is how the tenants left it, not the cleaner's work.
- Describe every photo in the "photos" list first: what area it shows and whether it's before, after or unclear.
- Only put a photo under an area if you're confident it shows that area. A wrong photo is worse than none. Each photo goes under one area at most - except that the fire alarm panel, fire doors and bins can share a photo with the room they're in.

${roomLine}

For each area:
- "condition": how it was left, from the after photos. "needs_attention" only for something the agent must act on. "not_photographed" when no photo shows the area - then don't guess its state.
- "on_arrival": one sentence on how it was found, from before photos. Empty string if there is no before photo.
- "work_done": what was done there, from the ticked to-do items and the after photos, as one plain sentence ("Hoovered and mopped the floor; wiped door handles and switches."). If nothing is ticked for that area and there's no after photo, write "Not recorded."
- "issues": anything in that area the landlord or agent needs to deal with - damage, repairs, damp or mould, leaks, pests, safety. Not tenants' mess, and not observations that all is well (those go in work_done). Empty string if nothing is wrong.
- Fire alarm panel: say in work_done whether the lights show normal, only if you can read them; a fault light is an issue. Its condition is "good" only when you can see the lights showing normal - if they can't be read, it's "fair" and work_done says so. Fire doors: say in work_done that they were seen shut; any wedged or propped open, damaged, or not closing is an issue. Bins: say in work_done how full they were; overflowing bins or rubbish left outside go in housekeeping.

Then the three sections the agent reads first:
- "summary": two or three sentences. How the property was left, and the most important thing the agent needs to know.
- "landlord": things the landlord or agent needs to arrange, most urgent first, one per line, each starting with the area ("Fire doors: kitchen fire door wedged open - removed the wedge; tenants need reminding."). Don't list areas that weren't photographed or couldn't be checked - the report shows those separately. Write "None." if there is nothing.
- "housekeeping": how the tenants are keeping the shared areas, from what was found on arrival, one per line starting with the area ("Kitchen: dishes and pans left piled on the worktops."). Factual, no blame. Write "Nothing to note." if the house was found in good order.

Write in plain British English, in short sentences. Don't pad, and don't state anything the photos, to-do list or notes don't support.`;
}

const asText = (v) => (typeof v === 'string' ? v.trim() : '');

// The model's answer, checked, with photo numbers turned into photo ids and
// each photo's description kept as its caption. Anything malformed is
// dropped rather than failing the whole report.
export function parseDetailedReport(raw, photoIds) {
  const captions = new Map();
  (Array.isArray(raw?.photos) ? raw.photos : []).forEach((p) => {
    const id = photoIds[Number(p?.number) - 1];
    if (id) captions.set(id, asText(p.shows));
  });

  const used = new Set();
  const take = (numbers, shared) => (Array.isArray(numbers) ? numbers : [])
    .map((n) => photoIds[Number(n) - 1])
    .filter((id) => id && (shared || (!used.has(id) && used.add(id))))
    .map((id) => ({ id, caption: captions.get(id) || '' }));

  const rooms = (Array.isArray(raw?.rooms) ? raw.rooms : [])
    .filter((r) => r && asText(r.room))
    .map((r) => {
      // The fire alarm panel, fire doors and bins can share a photo with
      // the room they're in; rooms can't share with each other.
      const shared = isSafetyCheck(r.room);
      const after = take(r.after_photos, shared);
      const before = take(r.before_photos, shared);
      return {
        room: asText(r.room),
        condition: CONDITIONS[r.condition] ? r.condition : (after.length ? 'fair' : 'not_photographed'),
        on_arrival: asText(r.on_arrival),
        work_done: asText(r.work_done),
        issues: asText(r.issues),
        before,
        after,
        // Every photo on the room, after first - what older readers of
        // job_reports.rooms (0122) look at.
        photo_ids: [...after, ...before].map((p) => p.id),
      };
    });

  return {
    summary: asText(raw?.summary),
    landlord: asText(raw?.landlord),
    housekeeping: asText(raw?.housekeeping),
    rooms: rooms.length > 0 ? rooms : null,
  };
}

// The rooms from the first version of room-by-room reports (photos only,
// no before/after) still read: their photos count as after photos.
export function roomPhotos(room) {
  if (Array.isArray(room?.after) || Array.isArray(room?.before)) {
    return { before: room.before || [], after: room.after || [] };
  }
  return { before: [], after: (room?.photo_ids || []).map((id) => ({ id, caption: '' })) };
}

// "55, Brunswick Street, Brynmill, Uplands, Swansea, Wales, SA1 4JP, United
// Kingdom" -> "55 Brunswick Street, Swansea SA1 4JP". The long form comes
// from the map lookup; nobody writes an address like that on a report.
export function shortAddress(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean)
    .filter((p) => !/^(united kingdom|uk|wales|cymru|england)$/i.test(p));
  if (parts.length === 0) return '';
  const postcodeAt = parts.findIndex((p) => /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(p));
  let postcode = postcodeAt >= 0 ? parts.splice(postcodeAt, 1)[0].toUpperCase() : '';
  // "Port Tenant SA1 8NF" - a postcode run into the last part.
  if (!postcode) {
    const tail = /\s+([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})$/i.exec(parts[parts.length - 1]);
    if (tail) { postcode = tail[1].toUpperCase(); parts[parts.length - 1] = parts[parts.length - 1].slice(0, tail.index).trim(); }
  }
  let first = parts.shift();
  if (/^\d+[a-z]?$/i.test(first) && parts.length) first = `${first} ${parts.shift()}`;
  // "Flat 2, 3 The Promenade" - the flat and the building go together.
  else if (/^(flat|apartment|unit|room)\b/i.test(first) && parts.length) first = `${first}, ${parts.shift()}`;
  else if (!/\d/.test(first) && parts.length && /\b(street|road|terrace|crescent|avenue|lane|close|place|way|drive|promenade|court|row|hill|walk|gardens|square)\b/i.test(parts[0])) first = `${first}, ${parts.shift()}`;
  const town = parts.length ? parts[parts.length - 1] : '';
  return [first, [town, postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
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
  // Safety checks (fire alarm panel, fire doors, bins) a visit has no photo
  // of - the agent can't see they were checked.
  const missingChecks = [];
  completed.forEach((v) => {
    (v.report?.rooms || []).forEach((r) => {
      if (r.condition === 'needs_attention') roomsNeedingAttention.push({ date: v.scheduled_at, room: r.room, issues: r.issues });
      if (r.condition === 'not_photographed' && isSafetyCheck(r.room)) missingChecks.push({ date: v.scheduled_at, room: r.room });
    });
  });

  return {
    visitCount: completed.length,
    missedCount: missed.length,
    minutes: completed.reduce((t, v) => t + v.minutes, 0),
    reportCount: completed.filter((v) => v.report).length,
    roomsNeedingAttention,
    missingChecks,
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
// matched to each room (a few before and a few after per room), or failing
// that the last few taken.
export function photosToPrint(visit) {
  const byId = new Map(visit.photos.map((p) => [p.id, p]));
  if (visit.report?.rooms?.length) {
    return visit.report.rooms.flatMap((r) => {
      const { before, after } = roomPhotos(r);
      return [...before.slice(0, MAX_PHOTOS_PER_ROOM), ...after.slice(0, MAX_PHOTOS_PER_ROOM)]
        .map((p) => byId.get(p.id)).filter(Boolean);
    });
  }
  return visit.photos.slice(-MAX_PHOTOS_PER_VISIT);
}
