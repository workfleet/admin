// Rota changes the help chat can propose. The chat never changes the rota
// itself: it looks things up, then proposes changes, which are shown as
// cards. Only when someone presses Confirm does the page make the change -
// as that person, through lib/rotaActions.js, so the same database rules
// apply as on the Rota page (finished jobs can't be changed, and so on).
//
// Kept deliberately small: book one visit, move a visit, put someone on or
// take someone off a visit, set a visit's notes. Deleting visits and
// changing whole repeating series stay on the Rota page, where they have
// their own "this visit or this and later" questions.

export const ROTA_ACTION_TYPES = ['create_client', 'create_site', 'create_job', 'move_job', 'add_staff', 'remove_staff', 'set_notes'];

// The sectors a client can be filed under - the same list as the New client
// form (lib/clientIndustries.js).
export { INDUSTRY_OPTIONS } from './clientIndustries';
import { INDUSTRY_OPTIONS } from './clientIndustries';

const TZ = 'Europe/London';

// '2026-11-20T18:00' (London wall clock) -> UTC ISO string, or null.
export function londonToUtcIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const wall = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  };
  const offset = wall(guess) - guess;
  let t = guess - offset;
  // Across a clock change the first guess can be an hour out; one more pass.
  const offset2 = wall(t) - t;
  if (offset2 !== offset) t = guess - offset2;
  const back = new Date(t);
  if (Number.isNaN(back.getTime())) return null;
  return back.toISOString();
}

// UTC ISO -> 'YYYY-MM-DDTHH:MM' in London.
export function utcToLondonLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "Thu 20 Nov, 18:00-20:00"
export function describeWhen(iso, durationMinutes) {
  const start = new Date(iso);
  const end = new Date(start.getTime() + (durationMinutes || 0) * 60000);
  const day = start.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const t = (d) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return durationMinutes ? `${day}, ${t(start)}-${t(end)}` : `${day}, ${t(start)}`;
}

export function overlaps(aStart, aMinutes, bStart, bMinutes) {
  const a0 = new Date(aStart).getTime();
  const a1 = a0 + (aMinutes || 120) * 60000;
  const b0 = new Date(bStart).getTime();
  const b1 = b0 + (bMinutes || 120) * 60000;
  return a0 < b1 && b0 < a1;
}

export function hoursLabel(minutes) {
  const h = (minutes || 0) / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')}h`;
}

// The card's headline for one validated action.
export function actionHeadline(a) {
  switch (a.type) {
    case 'create_client': return `Add a new client: ${a.name}`;
    case 'create_site': return `Add a site for ${a.clientName}`;
    case 'create_job': return `Book a visit at ${a.site}`;
    case 'move_job': return `Move the visit at ${a.site}`;
    case 'add_staff': return `Put ${a.staffName} on the visit at ${a.site}`;
    case 'remove_staff': return `Take ${a.staffName} off the visit at ${a.site}`;
    case 'set_notes': return `Change the notes on the visit at ${a.site}`;
    default: return 'Change the rota';
  }
}

// The detail lines under the headline.
export function actionDetails(a) {
  const lines = [];
  if (a.type === 'create_client') {
    if (a.contact_name) lines.push(`Contact: ${a.contact_name}`);
    if (a.phone) lines.push(`Phone: ${a.phone}`);
    if (a.email) lines.push(`Email: ${a.email}`);
    if (a.billing_address) lines.push(`Billing address: ${a.billing_address}`);
    if (a.industry) lines.push(`Sector: ${a.industry}`);
    if (a.notes) lines.push(`Notes: ${a.notes}`);
  } else if (a.type === 'create_site') {
    lines.push(a.address);
    lines.push(a.lat != null ? 'Map pin found - check it is the right place.' : 'No map pin.');
  } else if (a.type === 'create_job') {
    lines.push(describeWhen(a.start, a.duration_minutes) + ` (${hoursLabel(a.duration_minutes)})`);
    lines.push(a.staffNames?.length ? `Cleaners: ${a.staffNames.join(', ')}` : 'No one on it yet');
    if (a.notes) lines.push(`Notes: ${a.notes}`);
  } else if (a.type === 'move_job') {
    lines.push(`From ${describeWhen(a.fromStart, a.fromDuration)}`);
    lines.push(`To ${describeWhen(a.start, a.duration_minutes)}`);
  } else if (a.type === 'add_staff' || a.type === 'remove_staff') {
    lines.push(describeWhen(a.jobStart, a.jobDuration));
  } else if (a.type === 'set_notes') {
    lines.push(describeWhen(a.jobStart, a.jobDuration));
    lines.push(a.notes ? `New notes: ${a.notes}` : 'Clear the notes');
  }
  if (a.inSeries) lines.push('This visit only - the rest of the repeating job stays as it is.');
  return lines;
}

// The tools the chat is given. Read tools run on the server; propose_changes
// only shows cards.
export const ROTA_TOOLS = [
  {
    name: 'find_staff',
    description: 'Find cleaners by (part of) their name. Returns ids and full names. Use before proposing anything that names a cleaner.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } },
  },
  {
    name: 'find_sites',
    description: 'Find client sites by (part of) the address or client name. Returns ids, addresses and client names. Use before booking a visit.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    name: 'find_clients',
    description: 'Find clients by (part of) their name. Returns ids, names and their site addresses. Use before adding a client (to avoid duplicates) or a site.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } },
  },
  {
    name: 'lookup_address',
    description: 'Look an address up on the map (UK only). Returns matching addresses with map pins, those with a house number first. Use before adding a site, then pass the chosen address, lat and lng exactly as returned.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    name: 'list_jobs',
    description: 'List visits on the rota between two London dates (inclusive), optionally for one cleaner or one site. Returns job ids, London start time, length, site, cleaners, status, whether it repeats, and notes. At most 60.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['from_date', 'to_date', 'staff_id', 'site_id'],
      properties: {
        from_date: { type: 'string', description: 'YYYY-MM-DD' },
        to_date: { type: 'string', description: 'YYYY-MM-DD' },
        staff_id: { type: ['string', 'null'] },
        site_id: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'propose_changes',
    description: 'Show the office one or more changes to confirm (new clients, new sites, rota changes). Nothing changes until they press Confirm on each. Use ids from the other tools. Times are London local "YYYY-MM-DDTHH:MM".',
    // Not strict: the API caps strict schemas at 16 optional (union-typed)
    // fields and this one has more. Every change is checked field by field
    // in checkChange (lib/rotaAssistantServer.js) before a card is shown.
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'job_id', 'site_id', 'start', 'duration_minutes', 'staff_ids', 'notes', 'client_id', 'client_ref', 'site_ref', 'name', 'contact_name', 'email', 'phone', 'billing_address', 'industry', 'address', 'lat', 'lng'],
            properties: {
              type: { type: 'string', enum: ROTA_ACTION_TYPES },
              job_id: { type: ['string', 'null'], description: 'For move_job, add_staff, remove_staff, set_notes' },
              site_id: { type: ['string', 'null'], description: 'For create_job' },
              start: { type: ['string', 'null'], description: 'London local YYYY-MM-DDTHH:MM, for create_job and move_job' },
              duration_minutes: { type: ['integer', 'null'], description: 'For create_job; optional for move_job' },
              staff_ids: { type: 'array', items: { type: 'string' }, description: 'create_job: who goes on it. add_staff/remove_staff: exactly one.' },
              notes: { type: ['string', 'null'], description: 'create_job, set_notes or create_client' },
              client_id: { type: ['string', 'null'], description: 'create_site: an existing client' },
              client_ref: { type: ['integer', 'null'], description: 'create_site: the position (0-based) in this list of a create_client it belongs to' },
              site_ref: { type: ['integer', 'null'], description: 'create_job: the position (0-based) in this list of a create_site to book at' },
              name: { type: ['string', 'null'], description: 'create_client: business name' },
              contact_name: { type: ['string', 'null'] },
              email: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
              billing_address: { type: ['string', 'null'] },
              industry: { anyOf: [{ type: 'string', enum: INDUSTRY_OPTIONS }, { type: 'null' }] },
              address: { type: ['string', 'null'], description: 'create_site: as returned by lookup_address' },
              lat: { type: ['number', 'null'] },
              lng: { type: ['number', 'null'] },
            },
          },
        },
      },
    },
  },
];

export const ROTA_RULES = `
You can also look things up on the rota and propose changes to it with your tools. You cannot change anything yourself - every change is shown to the person as a card, and only happens when they press Confirm.
- What you can propose: add a new client (create_client), add a site to a client (create_site), book one visit (create_job), move a visit to a new time (move_job), put a cleaner on or take one off a visit (add_staff / remove_staff), set a visit's notes (set_notes).
- Adding a client: use find_clients first and say if a similar one already exists. Fill in only what they told you - never invent a phone number, email or contact.
- Adding a site: use lookup_address and pass the address, lat and lng exactly as returned. If there are several matches, or none with a house number, ask which is right. Never type coordinates yourself. Access details (door codes, key safes) are never added here - those go on the client's page.
- To add a client, then a site, then book there in one go, propose them in that order in one propose_changes call, linking with client_ref and site_ref (their 0-based positions in the list).
- What you can't: delete or merge clients or sites, add access details, delete visits, change a whole repeating job, set split hours, add tasks, or change finished (completed or missed) visits. For those, tell them how to do it on the Rota page.
- Always look up real ids with find_staff, find_sites and list_jobs first. Never make up an id. If a name matches more than one person or site, ask which one.
- If details are missing (date, time, how long, who), ask before proposing. Don't assume a length - ask, unless they said it.
- Today is given with each question. Work out dates like "next Thursday" from it and say the actual date back.
- After proposing, say in one line what you've put up for them to confirm, and mention any warnings (double-booking, time off).
- Visit notes are shown to the cleaners on the job, so never put door codes or alarm codes in them.`;
