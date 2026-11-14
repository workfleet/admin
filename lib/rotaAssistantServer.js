// Server side of the chat's rota tools: lookups, and checking each proposed
// change before it is shown. Read-only - nothing here writes to the rota.
// Confirmed changes are made in the browser as the person who confirmed
// them (lib/rotaActions.js).
import { supabaseAdmin } from './supabaseAdmin';
import { BOOKABLE_ROLES } from './staffRoles';
import { shortAddress } from './shortAddress';
import { londonToUtcIso, utcToLondonLocal, overlaps, actionHeadline, actionDetails, describeWhen, INDUSTRY_OPTIONS } from './rotaAssistant';

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

export async function findClients(name) {
  const { data } = await supabaseAdmin
    .from('clients').select('id, name, contact_name, properties(address)')
    .ilike('name', like(name)).order('name').limit(10);
  return (data || []).map((c) => ({ id: c.id, name: c.name, contact: c.contact_name || null, sites: (c.properties || []).map((p) => shortAddress(p.address)) }));
}

// The same free map lookup the Clients page uses (OpenStreetMap Nominatim,
// UK only), from the server. Results with a house number first, as there.
// Every result is remembered for this request, so a proposed site is checked
// against what the map actually returned - the AI never supplies a pin.
export async function lookupAddress(query, lookups) {
  const q = String(query || '').trim().slice(0, 200);
  if (q.length < 3) return { matches: [] };
  const failed = { error: "The map lookup didn't answer. Try again, or add the site on the client's page." };
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=gb&limit=5&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'WorkFleet cleaning rota app', 'Accept-Language': 'en-GB' },
    });
    if (!res.ok) return failed;
    const data = await res.json();
    const matches = [...(data || [])]
      .sort((a, b) => (b.address?.house_number ? 1 : 0) - (a.address?.house_number ? 1 : 0))
      .map((r) => ({ address: r.display_name, lat: Number(r.lat), lng: Number(r.lon), has_house_number: Boolean(r.address?.house_number) }));
    matches.forEach((m) => lookups?.set(m.address, m));
    return { matches };
  } catch {
    return failed;
  }
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
export async function checkChange(c, ctx = {}) {
  const base = { type: c.type, warnings: [] };
  const batch = ctx.batch || [];
  const offset = ctx.offset || 0;
  const fail = (error, extra = {}) => ({ ...base, ...extra, error, headline: extra.headline || 'This change can\'t be made', details: [] });

  if (c.type === 'create_client') {
    const name = String(c.name || '').trim().slice(0, 200);
    if (!name) return fail('A client needs a name.');
    const email = String(c.email || '').trim().slice(0, 200) || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email address doesn't look right.");
    const action = {
      ...base,
      name,
      contact_name: String(c.contact_name || '').trim().slice(0, 200) || null,
      email,
      phone: String(c.phone || '').trim().slice(0, 50) || null,
      billing_address: String(c.billing_address || '').trim().slice(0, 500) || null,
      industry: INDUSTRY_OPTIONS.includes(c.industry) ? c.industry : null,
      notes: String(c.notes || '').trim().slice(0, 1000) || null,
    };
    const similar = await findClients(name.split(/\s+/).slice(0, 2).join(' '));
    const exact = similar.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (exact) return fail(`There is already a client called ${exact.name}.`, { headline: actionHeadline(action) });
    if (similar.length) action.warnings.push(`Similar clients already exist: ${similar.slice(0, 3).map((x) => x.name).join(', ')}. Check this isn't one of them.`);
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'update_client') {
    const { data: client } = c.client_id
      ? await supabaseAdmin.from('clients').select('id, name, contact_name, email, phone, billing_address, industry, notes').eq('id', c.client_id).maybeSingle()
      : { data: null };
    if (!client) return fail("That client wasn't found.");
    const FIELDS = [
      ['name', 'Name', 200], ['contact_name', 'Contact', 200], ['phone', 'Phone', 50], ['email', 'Email', 200],
      ['billing_address', 'Billing address', 500], ['industry', 'Sector', 100], ['notes', 'Notes', 1000],
    ];
    const changes = {};
    const diff = [];
    for (const [key, label, max] of FIELDS) {
      if (c[key] == null) continue;
      const value = String(c[key]).trim().slice(0, max);
      if (!value || value === (client[key] || '')) continue;
      changes[key] = value;
      diff.push({ label, from: client[key] || '', to: value });
    }
    if (changes.industry && !INDUSTRY_OPTIONS.includes(changes.industry)) return fail('That sector isn\'t one of the options on the client form.', { headline: `Change ${client.name}'s details` });
    if (changes.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(changes.email)) return fail("That email address doesn't look right.", { headline: `Change ${client.name}'s details` });
    if (!diff.length) return fail('Nothing would change - those details are already saved.', { headline: `Change ${client.name}'s details` });
    const action = { ...base, client_id: client.id, clientName: client.name, changes, diff };
    if (changes.name) {
      const clash = (await findClients(changes.name)).find((x) => x.id !== client.id && x.name.trim().toLowerCase() === changes.name.toLowerCase());
      if (clash) return fail(`There is already another client called ${clash.name}.`, { headline: actionHeadline(action) });
      action.warnings.push('Renaming changes the name on quotes, reports and the client portal from now on.');
    }
    if (changes.notes && client.notes) action.warnings.push('This replaces the existing notes - it does not add to them.');
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'update_site') {
    const { data: site } = c.site_id
      ? await supabaseAdmin.from('properties').select('id, address, client_id, clients(name)').eq('id', c.site_id).maybeSingle()
      : { data: null };
    if (!site) return fail("That site wasn't found.");
    const clientName = site.clients?.name || 'this client';
    let match = ctx.lookups?.get(String(c.address || '').trim());
    if (!match) {
      const found = await lookupAddress(c.address, ctx.lookups);
      match = found.matches?.[0] || null;
    }
    if (!match) return fail("That address couldn't be found on the map. Change it on the client's page, where you can type it in full.", { headline: `Change a site's address for ${clientName}` });
    if (match.address === site.address) return fail('That is already the address saved for this site.', { headline: `Change a site's address for ${clientName}` });
    const action = { ...base, site_id: site.id, clientName, fromAddress: site.address, address: match.address, lat: match.lat, lng: match.lng };
    const { count } = await supabaseAdmin.from('jobs').select('id', { count: 'exact', head: true }).eq('property_id', site.id).gte('scheduled_at', new Date().toISOString());
    action.warnings.push(`Cleaners' clock-in location check will use the new pin${count ? ` - ${count} upcoming visit${count === 1 ? ' is' : 's are'} booked here` : ''}.`);
    if (!match.has_house_number) action.warnings.push('The map only matched the street or area, not the exact building, so the pin may be a little off.');
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'create_site') {
    let clientId = null;
    let clientName = null;
    let dependsOn = null;
    if (Number.isInteger(c.client_ref)) {
      const ref = batch[c.client_ref];
      if (!ref || ref.type !== 'create_client' || ref.error) return fail("The new client this site belongs to couldn't be added.");
      dependsOn = offset + c.client_ref;
      clientName = ref.name;
    } else {
      const { data: client } = c.client_id ? await supabaseAdmin.from('clients').select('id, name').eq('id', c.client_id).maybeSingle() : { data: null };
      if (!client) return fail("That client wasn't found.");
      clientId = client.id;
      clientName = client.name;
    }
    // Only a pin the map lookup returned is used; if the AI's address isn't
    // one of those, look it up here and take the best match.
    let match = ctx.lookups?.get(String(c.address || '').trim());
    if (!match) {
      const found = await lookupAddress(c.address, ctx.lookups);
      match = found.matches?.[0] || null;
    }
    if (!match) return fail("That address couldn't be found on the map. Add the site on the client's page, where you can type it in full.", { headline: `Add a site for ${clientName}` });
    const action = { ...base, client_id: clientId, clientName, dependsOn, address: match.address, lat: match.lat, lng: match.lng };
    if (!match.has_house_number) action.warnings.push("The map only matched the street or area, not the exact building, so the pin may be a little off. Cleaners' clock-in location check uses it.");
    if (clientId) {
      const { data: existing } = await supabaseAdmin.from('properties').select('address').eq('client_id', clientId);
      const same = (existing || []).find((x) => shortAddress(x.address).toLowerCase() === shortAddress(match.address).toLowerCase());
      if (same) action.warnings.push(`${clientName} already has a site at ${shortAddress(same.address)}.`);
    }
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  if (c.type === 'create_job' && Number.isInteger(c.site_ref)) {
    const ref = batch[c.site_ref];
    if (!ref || ref.type !== 'create_site' || ref.error) return fail("The new site this visit is for couldn't be added.");
    const start = londonToUtcIso(c.start);
    if (!start) return fail("The start time wasn't clear.");
    const minutes = Number(c.duration_minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return fail('The length must be between 15 minutes and 12 hours.');
    const ids = [...new Set(c.staff_ids || [])];
    const staff = await loadStaff(ids);
    if (staff.length !== ids.length || staff.some((s) => !BOOKABLE_ROLES.includes(s.role) || s.active === false)) return fail("One of the cleaners wasn't found, or can't be booked.");
    const action = {
      ...base,
      site: `${shortAddress(ref.address)} (${ref.clientName})`,
      property_id: null,
      dependsOn: offset + c.site_ref,
      start,
      duration_minutes: minutes,
      staff_ids: ids,
      staffNames: staff.map((s) => s.full_name),
      notes: (c.notes || '').trim().slice(0, 1000) || null,
    };
    if (new Date(start) < new Date()) action.warnings.push('This time is in the past.');
    for (const s of staff) action.warnings.push(...await staffWarnings(s.id, s.full_name, start, minutes, null));
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

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
export async function runRotaTool(name, input, ctx = {}) {
  if (name === 'find_staff') return { staff: await findStaff(input.name) };
  if (name === 'find_clients') return { clients: await findClients(input.name) };
  if (name === 'lookup_address') return lookupAddress(input.query, ctx.lookups);
  if (name === 'find_sites') return { sites: await findSites(input.query) };
  if (name === 'list_jobs') return listJobs(input);
  return { error: 'Unknown tool.' };
}
