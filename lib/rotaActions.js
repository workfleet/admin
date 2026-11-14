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

export async function runRotaAction(card) {
  if (card.type === 'create_job') {
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({ property_id: card.property_id, scheduled_at: card.start, duration_minutes: card.duration_minutes, notes: card.notes || null })
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
