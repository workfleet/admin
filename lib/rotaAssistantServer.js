// Server side of the chat's rota tools: lookups, and checking each proposed
// change before it is shown. Read-only - nothing here writes to the rota.
// Confirmed changes are made in the browser as the person who confirmed
// them (lib/rotaActions.js).
import { supabaseAdmin } from './supabaseAdmin';
import { BOOKABLE_ROLES } from './staffRoles';
import { shortAddress } from './shortAddress';
import { readableKind } from './projectAi';
import { loadLibraryFile, loadProjectFile } from './aiServer';

// Enough for a long policy or tender pack; past this the read is cut.
const MAX_READ_CHARS = 120000;
import { londonToUtcIso, utcToLondonLocal, overlaps, actionHeadline, actionDetails, describeWhen, INDUSTRY_OPTIONS, MAX_DELETE } from './rotaAssistant';

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
    series_id: j.series_id || null,
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

// Documents the chat may read: the whole Documents library, and files on
// projects whose AI switch is on (0138) - a tender that bans AI stays out.
// Signed worker contracts (category "contract") hold pay and personal
// details. Like cleaners' records and payroll, only admins see them here.
export async function findDocuments(query, role) {
  const q = String(query || '').trim();
  let lib = supabaseAdmin.from('company_documents').select('id, title, file_name, category, folder_id').is('client_id', null).order('title').limit(40);
  if (role !== 'admin') lib = lib.neq('category', 'contract');
  // A folder name finds everything in it ("what's in Insurance?").
  const { data: folderRows } = await supabaseAdmin.from('document_folders').select('id, name');
  const folderName = new Map((folderRows || []).map((f) => [f.id, f.name]));
  const matchingFolders = q ? (folderRows || []).filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).map((f) => f.id) : [];
  if (q) lib = lib.or([`title.ilike.${like(q)}`, `file_name.ilike.${like(q)}`, ...(matchingFolders.length ? [`folder_id.in.(${matchingFolders.join(',')})`] : [])].join(','));
  let proj = supabaseAdmin.from('project_files').select('id, file_name, project_id, projects!inner(name, ai_enabled)').eq('projects.ai_enabled', true).limit(25);
  if (q) proj = proj.or(`file_name.ilike.${like(q)}`);
  const [libRes, { data: projRows }] = await Promise.all([lib, proj]);
  let libRows = libRes.data;
  // Before folders exist (0141 not run): the same search without them.
  if (libRes.error) {
    let plain = supabaseAdmin.from('company_documents').select('id, title, file_name, category').is('client_id', null).order('title').limit(40);
    if (role !== 'admin') plain = plain.neq('category', 'contract');
    if (q) plain = plain.or(`title.ilike.${like(q)},file_name.ilike.${like(q)}`);
    libRows = (await plain).data;
  }
  return {
    documents: [
      ...(libRows || []).map((d) => ({ source: 'library', id: d.id, title: d.title, file: d.file_name, folder: folderName.get(d.folder_id) || null, category: d.category, readable: Boolean(readableKind(d.file_name)) })),
      ...(projRows || []).map((f) => ({ source: 'project', id: f.id, title: f.file_name, file: f.file_name, project: f.projects?.name, readable: Boolean(readableKind(f.file_name)) })),
    ],
  };
}

// The tool result for one document: its text (or the PDF/image itself),
// capped so one long file can't use up the time a question has.
export async function readDocument({ source, id }, role) {
  let loaded;
  let title;
  if (source === 'project') {
    const { data: row } = await supabaseAdmin.from('project_files').select('id, file_name, project_id, projects(name, ai_enabled)').eq('id', id).maybeSingle();
    if (!row) return { error: 'That file was not found.' };
    if (!row.projects?.ai_enabled) return { error: `AI tools are switched off for the project "${row.projects?.name || ''}", so its files can't be read.` };
    loaded = await loadProjectFile(row.project_id, row.id);
    title = `${row.file_name} (project: ${row.projects?.name})`;
  } else {
    const { data: row } = await supabaseAdmin.from('company_documents').select('id, title, category').eq('id', id).maybeSingle();
    if (!row) return { error: 'That document was not found.' };
    if (row.category === 'contract' && role !== 'admin') return { error: 'Contracts can only be read by admins.' };
    loaded = await loadLibraryFile(row.id);
    title = row.title;
  }
  if (loaded.error) return { error: loaded.error };
  const block = loaded.block;
  if (block.type === 'document' && block.source.type === 'text') {
    const text = block.source.data;
    const cut = text.length > MAX_READ_CHARS;
    return { text: `Document: ${title}\n\n${cut ? `${text.slice(0, MAX_READ_CHARS)}\n\n(Only the first part of this document is shown.)` : text}` };
  }
  // A PDF or picture goes back as itself, with its name.
  return { blocks: [{ type: 'text', text: `Document: ${title}` }, block] };
}

// Time off overlapping a date range. The reason is left out on purpose: it
// can be personal (sickness, family), and the chat doesn't need it.
export async function listTimeOff({ from_date: from, to_date: to, staff_id: staffId, include_pending: includePending }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return { error: 'Dates must be YYYY-MM-DD.' };
  let q = supabaseAdmin
    .from('time_off_requests')
    .select('type, start_date, end_date, status, cleaner_id, profiles!time_off_requests_cleaner_id_fkey(full_name)')
    .lte('start_date', to).gte('end_date', from)
    .in('status', includePending ? ['approved', 'pending'] : ['approved'])
    .order('start_date').limit(60);
  if (staffId) q = q.eq('cleaner_id', staffId);
  const { data, error } = await q;
  if (error) return { error: 'Couldn\'t read time off.' };
  return {
    time_off: (data || []).map((t) => ({
      name: t.profiles?.full_name || 'Unknown', staff_id: t.cleaner_id,
      type: t.type, from: t.start_date, to: t.end_date, status: t.status,
    })),
  };
}

// The same two checks across many visits at once (a repeating job from a
// date on): one query for the person's other visits in the whole range and
// one for their time off, then counted here. `ignoreIds` are the visits
// being changed, which can't clash with themselves.
async function bulkStaffWarnings(staffId, staffName, slots, ignoreIds) {
  if (!slots.length) return [];
  const sorted = [...slots].sort((a, b) => (a.start < b.start ? -1 : 1));
  const firstDay = utcToLondonLocal(sorted[0].start).slice(0, 10);
  const lastDay = utcToLondonLocal(sorted[sorted.length - 1].start).slice(0, 10);
  const rangeStart = londonToUtcIso(`${firstDay}T00:00`);
  const rangeEnd = new Date(new Date(londonToUtcIso(`${lastDay}T00:00`)).getTime() + 86400000).toISOString();
  const [{ data: theirs }, { data: off }] = await Promise.all([
    supabaseAdmin.from('job_assignments')
      .select('jobs!inner(id, scheduled_at, duration_minutes, properties(address))')
      .eq('cleaner_id', staffId)
      .gte('jobs.scheduled_at', rangeStart).lt('jobs.scheduled_at', rangeEnd)
      .limit(2000),
    supabaseAdmin.from('time_off_requests')
      .select('start_date, end_date')
      .eq('cleaner_id', staffId).eq('status', 'approved')
      .lte('start_date', lastDay).gte('end_date', firstDay),
  ]);
  const others = (theirs || []).map((r) => r.jobs).filter((j) => j && !ignoreIds.has(j.id));
  let clashes = 0; let firstClash = null; let offCount = 0; let firstOff = null;
  for (const slot of sorted) {
    const hit = others.find((j) => j.id !== slot.excludeId && overlaps(slot.start, slot.minutes, j.scheduled_at, j.duration_minutes));
    if (hit) { clashes++; firstClash = firstClash || slot.start; }
    const day = utcToLondonLocal(slot.start).slice(0, 10);
    if ((off || []).some((t) => t.start_date <= day && t.end_date >= day)) { offCount++; firstOff = firstOff || slot.start; }
  }
  const out = [];
  const when = (iso) => describeWhen(iso).split(',')[0];
  if (clashes) out.push(`${staffName} would be double-booked on ${clashes} of these visits (first: ${when(firstClash)}).`);
  if (offCount) out.push(`${staffName} has approved time off on ${offCount} of these visits (first: ${when(firstOff)}).`);
  return out;
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

  // Deleting: upcoming visits only, never finished or past ones, at most
  // MAX_DELETE at once, and the card says exactly what goes and who was
  // booked. The database logs every deleted visit with who deleted it (0107)
  // and refuses finished ones (0128).
  if (c.type === 'delete_job') {
    if (new Date(job.scheduled_at) <= new Date()) return fail('Visits that have already started or are in the past can\'t be deleted here.', { site: siteLabel(job) });
    let targets = [job];
    if (c.scope === 'later') {
      if (!job.series_id) return fail("That visit doesn't repeat - ask to delete this visit only.", { site: siteLabel(job) });
      const coveredBy = batch.findIndex((b) => !b.error && b.type === 'delete_job' && b.scope === 'later' && b.series_id === job.series_id && b.jobStart <= job.scheduled_at);
      if (coveredBy !== -1) return fail(`Already covered by card ${coveredBy + 1} above.`, { site: siteLabel(job) });
      const { data: rows, error: rowsError } = await supabaseAdmin
        .from('jobs')
        .select('id, scheduled_at, duration_minutes, status, job_assignments(cleaner_id, profiles(full_name))')
        .eq('series_id', job.series_id).eq('status', 'scheduled').gte('scheduled_at', job.scheduled_at)
        .order('scheduled_at').limit(300);
      if (rowsError) return fail("Couldn't read the rest of the repeating job.");
      targets = rows || [];
    }
    if (!targets.length) return fail('There are no upcoming visits to delete.', { site: siteLabel(job) });
    // The cap is per answer, not per card: splitting a big delete into
    // several cards of 30 would get round it.
    const alreadyDeleting = [...(ctx.earlier || []), ...batch].filter((b) => !b.error && b.type === 'delete_job').reduce((n, b) => n + (b.count || 0), 0);
    if (alreadyDeleting + targets.length > MAX_DELETE) {
      return fail(`That would take this answer over ${MAX_DELETE} deleted visits. For more than that, use "Delete this + future" on the Rota, where every visit is on screen first.`, { site: siteLabel(job), headline: `Delete visits at ${siteLabel(job)}` });
    }
    if (targets.length > MAX_DELETE) {
      return fail(`That would delete ${targets.length} visits - more than ${MAX_DELETE} at once. Use "Delete this + future" on the visit in the Rota, where you see them all first.`, { site: siteLabel(job), headline: `Delete visits at ${siteLabel(job)}` });
    }
    const names = [...new Set(targets.flatMap((j) => (j.job_assignments || []).map((a) => a.profiles?.full_name || 'a cleaner')))];
    const action = {
      ...common,
      scope: c.scope === 'later' ? 'later' : 'this',
      series_id: job.series_id || null,
      danger: true,
      job_ids: targets.map((j) => j.id),
      count: targets.length,
      firstAt: targets[0].scheduled_at,
      lastAt: targets[targets.length - 1].scheduled_at,
      staffNames: names,
    };
    if (names.length) action.warnings.push(`${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} booked on ${targets.length === 1 ? 'it' : 'them'} and will not be told - let them know, or take them off and use Shift cover instead.`);
    return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
  }

  // "This visit and every later one" on a repeating job. Only later visits
  // still scheduled are touched (finished ones never are), as on the Rota.
  if (c.scope === 'later' && ['move_job', 'add_staff', 'remove_staff', 'set_notes'].includes(c.type)) {
    if (!job.series_id) return fail("That visit doesn't repeat - ask for this visit only.", { site: siteLabel(job) });
    const { data: laterRows, error: laterError } = await supabaseAdmin
      .from('jobs')
      .select('id, scheduled_at, duration_minutes, status, job_assignments(cleaner_id, profiles(full_name))')
      .eq('series_id', job.series_id).eq('status', 'scheduled').gte('scheduled_at', job.scheduled_at)
      .order('scheduled_at').limit(300);
    if (laterError) return fail("Couldn't read the rest of the repeating job.");
    const later = laterRows || [];
    if (!later.length) return fail('There are no upcoming visits left in this repeating job.', { site: siteLabel(job) });
    const lastAt = later[later.length - 1].scheduled_at;
    const common2 = { ...common, scope: 'later', count: later.length, lastAt };
    // A repeating job can run on several weekdays as one series, so "from
    // Monday" already covers that Friday. A second card for the same series
    // and the same change would only repeat the first.
    const coveredBy = batch.findIndex((b) => !b.error && b.scope === 'later' && b.type === c.type && b.series_id === job.series_id
      && (c.type === 'add_staff' || c.type === 'remove_staff' ? b.staff_id === (c.staff_ids || [])[0] : true)
      && b.jobStart <= job.scheduled_at);
    if (coveredBy !== -1) return fail(`Already covered by card ${coveredBy + 1} above - that one changes every later visit in this repeating job, on all its days.`, { site: siteLabel(job) });
    common2.series_id = job.series_id;

    if (c.type === 'move_job') {
      const local = String(c.start || '');
      const time = /T(\d{2}:\d{2})$/.exec(local)?.[1];
      if (!time || !londonToUtcIso(local)) return fail("The new time wasn't clear.");
      if (local.slice(0, 10) !== utcToLondonLocal(job.scheduled_at).slice(0, 10)) {
        return fail("Moving a repeating job to different days is done in the Rota's \"Edit series\" - here it can only change the time and length from this visit on.", { site: siteLabel(job) });
      }
      const minutes = c.duration_minutes == null ? job.duration_minutes : Number(c.duration_minutes);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return fail('The length must be between 15 minutes and 12 hours.');
      // Each visit keeps its own date and gets the new time of day.
      const moves = later.map((j) => ({ id: j.id, start: londonToUtcIso(`${utcToLondonLocal(j.scheduled_at).slice(0, 10)}T${time}`), from: j.scheduled_at }));
      const action = { ...common2, moves, duration_minutes: minutes, start: moves[0].start, fromStart: job.scheduled_at, fromDuration: job.duration_minutes, series_id: job.series_id };
      const people = new Map();
      later.forEach((j) => (j.job_assignments || []).forEach((a) => people.set(a.cleaner_id, a.profiles?.full_name || 'A cleaner')));
      for (const [id, name] of people) {
        const theirs = later.filter((j) => (j.job_assignments || []).some((a) => a.cleaner_id === id));
        const slots = theirs.map((j) => ({ start: moves.find((m) => m.id === j.id).start, minutes, excludeId: j.id }));
        action.warnings.push(...await bulkStaffWarnings(id, name, slots, new Set(later.map((j) => j.id))));
      }
      return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
    }

    if (c.type === 'add_staff' || c.type === 'remove_staff') {
      const staffId = (c.staff_ids || [])[0];
      const [person] = await loadStaff(staffId ? [staffId] : []);
      if (!person) return fail("That cleaner wasn't found.");
      const on = (j) => (j.job_assignments || []).some((a) => a.cleaner_id === person.id);
      const targets = c.type === 'add_staff' ? later.filter((j) => !on(j)) : later.filter(on);
      if (!targets.length) {
        return fail(c.type === 'add_staff' ? `${person.full_name} is already on every upcoming visit.` : `${person.full_name} isn't on any upcoming visit of this job.`, { site: siteLabel(job) });
      }
      const action = { ...common2, count: targets.length, lastAt: targets[targets.length - 1].scheduled_at, job_ids: targets.map((j) => j.id), staff_id: person.id, staffName: person.full_name, firstAt: targets[0].scheduled_at };
      if (c.type === 'add_staff') {
        if (!BOOKABLE_ROLES.includes(person.role) || person.active === false) return fail(`${person.full_name} can't be booked.`);
        action.warnings.push(...await bulkStaffWarnings(person.id, person.full_name, targets.map((j) => ({ start: j.scheduled_at, minutes: j.duration_minutes, excludeId: j.id })), new Set()));
      } else {
        const leftEmpty = targets.filter((j) => (j.job_assignments || []).length === 1).length;
        if (leftEmpty) action.warnings.push(`${leftEmpty} visit${leftEmpty === 1 ? '' : 's'} will have no one on ${leftEmpty === 1 ? 'it' : 'them'}.`);
      }
      return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
    }

    if (c.type === 'set_notes') {
      const notes = (c.notes || '').trim().slice(0, 1000);
      const action = { ...common2, notes: notes || null, job_ids: later.map((j) => j.id) };
      if (/\b\d{4,}\b/.test(notes) && /code|alarm|key ?safe|pin/i.test(notes)) action.warnings.push("This looks like it might contain a code. Cleaners on the job see these notes - keep codes in the site's Access details instead.");
      return { ...action, headline: actionHeadline(action), details: actionDetails(action) };
    }
  }



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
  if (name === 'list_time_off') return listTimeOff(input);
  if (name === 'find_documents') return findDocuments(input.query, ctx.role);
  if (name === 'read_document') return readDocument(input, ctx.role);
  return { error: 'Unknown tool.' };
}
