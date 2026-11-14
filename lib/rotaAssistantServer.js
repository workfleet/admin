// Server side of the chat's rota tools: lookups, and checking each proposed
// change before it is shown. Read-only - nothing here writes to the rota.
// Confirmed changes are made in the browser as the person who confirmed
// them (lib/rotaActions.js).
import { supabaseAdmin } from './supabaseAdmin';
import { BOOKABLE_ROLES } from './staffRoles';
import { shortAddress } from './shortAddress';
import { londonToUtcIso, utcToLondonLocal, overlaps, actionHeadline, actionDetails, describeWhen } from './rotaAssistant';

const LOCKED = new Set(['completed', 'missed']);
const JOB_COLUMNS = 'id, scheduled_at, duration_minutes, status, series_id, notes, property_id, properties(address, clients(name)), job_assignments(cleaner_id, profiles(full_name))';

// "The Eagle Inn (The Eagle)" rather than the full nine-part address - the
// way the rota writes it, so the card is easy to recognise.
function siteLabel(job) {
  const address = shortAddress(job?.properties?.address) || 'Unknown site';
  const client = job?.properties?.clients?.name;
  return client ? `${address} (${client})` : address;
}

function like(s) {
  return `%${String(s || '').replace(/[%_,()]/g, ' ').trim()}%`;
}

export async function findStaff(name) {
  const { data } = await supabaseAdmin
    .from('profiles').select('id, full_name').in('role', BOOKABLE_ROLES).eq('active', true)
    .ilike('full_name', like(name)).order('full_name').limit(10);
  return (data || []).map((p) => ({ id: p.id, name: p.full_name }));
}

export async function findSites(query) {
  const [{ data: byAddress }, { data: clients }] = await Promise.all([
    supabaseAdmin.from('properties').select('id, address, clients(name)').ilike('address', like(query)).limit(15),
    supabaseAdmin.from('clients').select('id').ilike('name', like(query)).limit(10),
  ]);
  let byClient = [];
  if (clients?.length) {
    const { data } = await supabaseAdmin.from('properties').select('id, address, clients(name)').in('client_id', clients.map((c) => c.id)).limit(20);
    byClient = data || [];
  }
  const seen = new Set();
  return [...(byAddress || []), ...byClient]
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, 20)
    .map((p) => ({ id: p.id, address: p.address, client: p.clients?.name || null }));
}

function describeJob(j) {
  return {
    id: j.id,
    start: utcToLondonLocal(j.scheduled_at),
    duration_minutes: j.duration_minutes,
    site: siteLabel(j),
    site_id: j.property_id,
    cleaners: (j.job_assignments || []).map((a) => ({ id: a.cleaner_id, name: a.profiles?.full_name || 'Unknown' })),
    status: j.status,
    repeats: Boolean(j.series_id),
    notes: j.notes || null,
  };
}

export async function listJobs({ from_date: from, to_date: to, staff_id: staffId, site_id: siteId }) {
  const start = londonToUtcIso(`${from}T00:00`);
  const endDay = londonToUtcIso(`${to}T00:00`);
  if (!start || !endDay) return { error: 'Dates must be YYYY-MM-DD.' };
  const end = new Date(new Date(endDay).getTime() + 86400000).toISOString();
  if (new Date(end) - new Date(start) > 62 * 86400000) return { error: 'Ask for two months or less at a time.' };

  let q = supabaseAdmin
    .from('jobs')
    .select(staffId ? `${JOB_COLUMNS}, assigned:job_assignments!inner(cleaner_id)` : JOB_COLUMNS)
    .gte('scheduled_at', start).lt('scheduled_at', end)
    .not('property_id', 'is', null)
    .order('scheduled_at').limit(60);
  if (staffId) q = q.eq('assigned.cleaner_id', staffId);
  if (siteId) q = q.eq('property_id', siteId);
  const { data, error } = await q;
  if (error) return { error: 'Couldn\'t read the rota.' };
  const jobs = (data || []).map(describeJob);
  // A busy week has more than 60 visits: say so, so the AI narrows the
  // search (a day, a cleaner, a site) instead of thinking it saw them all.
  return jobs.length === 60
    ? { jobs, more_not_shown: true, note: 'Only the first 60 are shown - narrow it to a day, a cleaner or a site.' }
    : { jobs };
}

// Clashes for one person at a time: another visit overlapping it, or
// approved time off that day. The same two checks the Rota page asks about.
async function staffWarnings(staffId, staffName, startIso, minutes, excludeJobId) {
  const warnings = [];
  const day = utcToLondonLocal(startIso).slice(0, 10);
  const dayStart = londonToUtcIso(`${day}T00:00`);
  const dayEnd = new Date(new Date(dayStart).getTime() + 86400000).toISOString();
  const [{ data: theirs }, { data: off }] = await Promise.all([
    supabaseAdmin.from('job_assignments')
      .select('jobs!inner(id, scheduled_at, duration_minutes, properties(address))')
      .eq('cleaner_id', staffId)
      .gte('jobs.scheduled_at', dayStart).lt('jobs.scheduled_at', dayEnd),
    supabaseAdmin.from('time_off_requests')
      .select('type, start_date, end_date')
      .eq('cleaner_id', staffId).eq('status', 'approved')
      .lte('start_date', day).gte('end_date', day),
  ]);
  const clash = (theirs || []).map((r) => r.jobs).find((j) => j && j.id !== excludeJobId && overlaps(startIso, minutes, j.scheduled_at, j.duration_minutes));
  if (clash) warnings.push(`${staffName} is already booked at ${shortAddress(clash.properties?.address) || 'another site'} then (${describeWhen(clash.scheduled_at, clash.duration_minutes)}).`);
  if (off?.length) warnings.push(`${staffName} has approved ${off[0].type === 'holiday' ? 'holiday' : 'time off'} that day.`);
  return warnings;
}

async function loadJob(id) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  return data;
}

async function loadStaff(ids) {
  if (!ids.length) return [];
  const { data } = await supabaseAdmin.from('profiles').select('id, full_name, role, active').in('id', ids);
  return data || [];
}

// One proposed change -> a card: what it does, any warnings, and the exact
// fields the browser needs to carry it out. `error` means it can't be done.
export async function checkChange(c) {
  const base = { type: c.type, warnings: [] };
  const fail = (error, extra = {}) => ({ ...base, ...extra, error, headline: extra.headline || 'This change can\'t be made', details: [] });

  if (c.type === 'create_job') {
    const { data: site } = c.site_id
      ? await supabaseAdmin.from('properties').select('id, address, clients(name)').eq('id', c.site_id).maybeSingle()
      : { data: null };
    if (!site) return fail('That site wasn\'t found.');
    const start = londonToUtcIso(c.start);
    if (!start) return fail('The start time wasn\'t clear.');
    const minutes = Number(c.duration_minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return fail('The length must be between 15 minutes and 12 hours.');
    const ids = [...new Set(c.staff_ids || [])];
    const staff = await loadStaff(ids);
    if (staff.length !== ids.length || staff.some((s) => !BOOKABLE_ROLES.includes(s.role) || s.active === false)) return fail('One of the cleaners wasn\'t found, or can\'t be booked.');
    const action = {
      ...base, site: siteLabel({ properties: site }), property_id: site.id, start, duration_minutes: minutes,
      staff_ids: ids, staffNames: staff.map((s) => s.full_name), notes: (c.notes || '').trim().slice(0, 1000) || null,
    };
    if (new Date(start) < new Date()) action.warnings.push('This time is in the past.');
    for (const s of staff) action.warnings.push(...await staffWarnings(s.id, s.full_name, start, minutes, null));
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  const job = await loadJob(c.job_id);
  if (!job) return fail('That visit wasn\'t found.');
  if (!job.property_id) return fail('Training sessions can only be changed on the Rota page.');
  if (LOCKED.has(job.status)) return fail(`That visit is ${job.status}, so it can't be changed.`, { site: siteLabel(job) });
  const common = { ...base, job_id: job.id, site: siteLabel(job), jobStart: job.scheduled_at, jobDuration: job.duration_minutes, inSeries: Boolean(job.series_id) };
  const onIt = (job.job_assignments || []);

  if (c.type === 'move_job') {
    const start = londonToUtcIso(c.start);
    if (!start) return fail('The new time wasn\'t clear.');
    const minutes = c.duration_minutes == null ? job.duration_minutes : Number(c.duration_minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return fail('The length must be between 15 minutes and 12 hours.');
    const action = { ...common, start, duration_minutes: minutes, fromStart: job.scheduled_at, fromDuration: job.duration_minutes, previousAt: job.scheduled_at, staff_ids: onIt.map((a) => a.cleaner_id) };
    if (start === job.scheduled_at && minutes === job.duration_minutes) return fail('That is already when the visit is.', { site: action.site });
    if (new Date(start) < new Date()) action.warnings.push('The new time is in the past.');
    for (const a of onIt) action.warnings.push(...await staffWarnings(a.cleaner_id, a.profiles?.full_name || 'A cleaner', start, minutes, job.id));
    if (onIt.length) action.warnings.push(`${onIt.length} cleaner${onIt.length === 1 ? '' : 's'} will be told about the new time.`);
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'add_staff' || c.type === 'remove_staff') {
    const staffId = (c.staff_ids || [])[0];
    const [person] = await loadStaff(staffId ? [staffId] : []);
    if (!person) return fail('That cleaner wasn\'t found.');
    const already = onIt.some((a) => a.cleaner_id === person.id);
    const action = { ...common, staff_id: person.id, staffName: person.full_name };
    if (c.type === 'add_staff') {
      if (already) return fail(`${person.full_name} is already on that visit.`, { site: action.site });
      if (!BOOKABLE_ROLES.includes(person.role) || person.active === false) return fail(`${person.full_name} can't be booked.`);
      action.warnings.push(...await staffWarnings(person.id, person.full_name, job.scheduled_at, job.duration_minutes, job.id));
    } else if (!already) {
      return fail(`${person.full_name} isn't on that visit.`, { site: action.site });
    } else if (onIt.length === 1) {
      action.warnings.push('No one will be left on this visit.');
    }
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'set_notes') {
    const notes = (c.notes || '').trim().slice(0, 1000);
    const action = { ...common, notes: notes || null };
    if (/\b\d{4,}\b/.test(notes) && /code|alarm|key ?safe|pin/i.test(notes)) action.warnings.push('This looks like it might contain a code. Cleaners on the job see these notes - keep codes in the site\'s Access details instead.');
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  return fail('That kind of change isn\'t supported.');
}

// Runs one of the chat's read tools.
export async function runRotaTool(name, input) {
  if (name === 'find_staff') return { staff: await findStaff(input.name) };
  if (name === 'find_sites') return { sites: await findSites(input.query) };
  if (name === 'list_jobs') return listJobs(input);
  return { error: 'Unknown tool.' };
}
