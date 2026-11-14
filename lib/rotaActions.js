// Carries out a rota change the office confirmed in the help chat. Runs in
// the browser as the person who pressed Confirm, so the database's own rules
// (who may edit the rota, finished visits locked by 0128) apply exactly as
// they do on the Rota page. Cleaners are told the same way the Rota page
// tells them.
import { supabase } from './supabaseClient';
import { notify } from './notify';
import { describeWhen } from './rotaAssistant';

const OPEN = '(completed,missed)';

function addressOf(card) {
  return String(card.site || '').replace(/\s*\([^)]*\)\s*$/, '');
}

// `resolved` carries ids made by earlier cards in the same answer: a site
// for a client added a moment ago, a visit at that new site.
// Returns { ok, message, createdId } - createdId is the new client's or
// site's id, for the cards that build on it.
export async function runRotaAction(card, resolved = {}) {
  if (card.type === 'create_client') {
    const { data, error } = await supabase
      .from('clients')
      .insert({
        name: card.name,
        contact_name: card.contact_name,
        email: card.email,
        phone: card.phone,
        billing_address: card.billing_address,
        industry: card.industry,
        notes: card.notes,
      })
      .select('id')
      .single();
    if (error || !data) return { ok: false, message: 'The client couldn\'t be added.' };
    return { ok: true, createdId: data.id, message: `${card.name} added. Open them from Clients to add access details.` };
  }

  if (card.type === 'update_client') {
    const { data, error } = await supabase.from('clients').update(card.changes).eq('id', card.client_id).select('id');
    if (error || !data?.length) return { ok: false, message: 'The client couldn\'t be updated.' };
    return { ok: true, message: `${card.clientName} updated.` };
  }

  if (card.type === 'update_site') {
    const { data, error } = await supabase
      .from('properties')
      .update({ address: card.address, lat: card.lat, lng: card.lng })
      .eq('id', card.site_id)
      .select('id');
    if (error || !data?.length) return { ok: false, message: 'The site couldn\'t be updated.' };
    return { ok: true, message: 'Address and map pin updated.' };
  }

  if (card.type === 'create_site') {
    const clientId = card.client_id || resolved.client_id;
    if (!clientId) return { ok: false, message: 'Add the client first.' };
    const { data, error } = await supabase
      .from('properties')
      .insert({ client_id: clientId, address: card.address, lat: card.lat, lng: card.lng })
      .select('id')
      .single();
    if (error || !data) return { ok: false, message: 'The site couldn\'t be added.' };
    return { ok: true, createdId: data.id, message: 'Site added with its map pin. Add door codes and access notes on the client\'s page.' };
  }

  if (card.type === 'create_job') {
    const propertyId = card.property_id || resolved.property_id;
    if (!propertyId) return { ok: false, message: 'Add the site first.' };
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({ property_id: propertyId, scheduled_at: card.start, duration_minutes: card.duration_minutes, notes: card.notes || null })
      .select('id, scheduled_at')
      .single();
    if (error || !job) return { ok: false, message: 'The visit couldn\'t be booked. Nothing was saved.' };
    if (card.staff_ids.length) {
      const { error: assignError } = await supabase.from('job_assignments').insert(card.staff_ids.map((cid) => ({ job_id: job.id, cleaner_id: cid })));
      if (assignError) return { ok: true, partial: true, message: 'Booked, but the cleaners couldn\'t be put on it. Add them on the Rota page.' };
      card.staff_ids.forEach((cid) => notify({ type: 'shift_assigned', cleanerId: cid, address: addressOf(card), scheduledAt: job.scheduled_at }));
    }
    return { ok: true, message: `Booked for ${describeWhen(job.scheduled_at, card.duration_minutes)}${card.staff_ids.length ? ' - cleaners told' : ''}.` };
  }

  // Deleting. Only visits still upcoming and not finished; the database
  // refuses finished ones anyway (0128) and logs each delete with who did it
  // (0107).
  if (card.type === 'delete_job') {
    const { data, error } = await supabase
      .from('jobs').delete()
      .in('id', card.job_ids).not('status', 'in', OPEN).gt('scheduled_at', new Date().toISOString())
      .select('id');
    if (error || !data?.length) return { ok: false, message: 'Nothing was deleted - the visit may have started or finished meanwhile.' };
    return { ok: true, message: data.length === card.job_ids.length
      ? `${data.length} visit${data.length === 1 ? '' : 's'} deleted.`
      : `${data.length} of ${card.job_ids.length} deleted - the rest had started or finished.` };
  }

  // This visit and every later one. As on the Rota's series editor, the
  // database's bell tells each cleaner about moved visits (0086); no email
  // per visit, which would be dozens at once.
  if (card.scope === 'later') {
    if (card.type === 'move_job') {
      const results = await Promise.all(card.moves.map((m) => supabase
        .from('jobs').update({ scheduled_at: m.start, duration_minutes: card.duration_minutes })
        .eq('id', m.id).not('status', 'in', OPEN).select('id')));
      const done = results.filter((r) => !r.error && r.data?.length).length;
      if (card.duration_minutes !== card.fromDuration && card.series_id) {
        await supabase.from('job_series').update({ duration_minutes: card.duration_minutes }).eq('id', card.series_id);
      }
      if (!done) return { ok: false, message: 'None of the visits could be changed.' };
      return { ok: done === card.moves.length, message: done === card.moves.length ? `All ${done} visits changed. Cleaners see the new time in the app.` : `${done} of ${card.moves.length} visits changed - check the rota for the rest.` };
    }
    if (card.type === 'add_staff') {
      const { error } = await supabase.from('job_assignments').insert(card.job_ids.map((id) => ({ job_id: id, cleaner_id: card.staff_id })));
      if (error) return { ok: false, message: `${card.staffName} couldn't be put on them.` };
      notify({ type: 'shift_assigned', cleanerId: card.staff_id, address: addressOf(card), scheduledAt: card.firstAt, count: card.job_ids.length });
      return { ok: true, message: `${card.staffName} is on ${card.job_ids.length} visits and has been told.` };
    }
    if (card.type === 'remove_staff') {
      const { data, error } = await supabase.from('job_assignments').delete().eq('cleaner_id', card.staff_id).in('job_id', card.job_ids).select('job_id');
      if (error || !data?.length) return { ok: false, message: `${card.staffName} couldn't be taken off.` };
      return { ok: true, message: `${card.staffName} is off ${data.length} visit${data.length === 1 ? '' : 's'}.` };
    }
    if (card.type === 'set_notes') {
      const { data, error } = await supabase.from('jobs').update({ notes: card.notes }).in('id', card.job_ids).not('status', 'in', OPEN).select('id');
      if (error || !data?.length) return { ok: false, message: 'The notes couldn\'t be saved.' };
      return { ok: true, message: `Notes saved on ${data.length} visit${data.length === 1 ? '' : 's'}.` };
    }
  }

  if (card.type === 'move_job') {
    const { data, error } = await supabase
      .from('jobs')
      .update({ scheduled_at: card.start, duration_minutes: card.duration_minutes })
      .eq('id', card.job_id).not('status', 'in', OPEN)
      .select('id');
    if (error || !data?.length) return { ok: false, message: 'The visit couldn\'t be moved - it may have been finished or changed meanwhile.' };
    (card.staff_ids || []).forEach((cid) => notify({ type: 'shift_rescheduled', cleanerId: cid, jobId: card.job_id, address: addressOf(card), previousAt: card.previousAt, scheduledAt: card.start }));
    return { ok: true, message: `Moved to ${describeWhen(card.start, card.duration_minutes)}${card.staff_ids?.length ? ' - cleaners told' : ''}.` };
  }

  if (card.type === 'add_staff') {
    const { error } = await supabase.from('job_assignments').insert({ job_id: card.job_id, cleaner_id: card.staff_id });
    if (error) return { ok: false, message: `${card.staffName} couldn't be put on it.` };
    notify({ type: 'shift_assigned', cleanerId: card.staff_id, address: addressOf(card), scheduledAt: card.jobStart });
    return { ok: true, message: `${card.staffName} is on it and has been told.` };
  }

  if (card.type === 'remove_staff') {
    const { data, error } = await supabase.from('job_assignments').delete().eq('job_id', card.job_id).eq('cleaner_id', card.staff_id).select('job_id');
    if (error || !data?.length) return { ok: false, message: `${card.staffName} couldn't be taken off - the visit may be finished.` };
    return { ok: true, message: `${card.staffName} is off the visit.` };
  }

  if (card.type === 'set_notes') {
    const { data, error } = await supabase.from('jobs').update({ notes: card.notes }).eq('id', card.job_id).not('status', 'in', OPEN).select('id');
    if (error || !data?.length) return { ok: false, message: 'The notes couldn\'t be saved.' };
    return { ok: true, message: 'Notes saved.' };
  }

  return { ok: false, message: 'That change isn\'t supported.' };
}
