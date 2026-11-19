// Sends the "you didn't clock in - did you work it?" reminders
// (lib/hoursCheckReminders.js). Server only: it uses the service key.
//
// Runs from the daily 08:00 cron, riding on payroll-reminder like the
// accident-book reminders do, to stay inside the Vercel plan's cron
// allowance. A second run the same day is a no-op: the bell row it wrote is
// how it knows.

import { supabaseAdmin } from './supabaseAdmin';
import { sendPushToSubscriptions } from './webPush';
import { withoutTestAccounts } from './testAccounts';
import { BOOKABLE_ROLES } from './staffRoles';
import {
  LOOKBACK_DAYS,
  MESSAGE_PREFIX,
  hoursCheckReminders,
  pushFor,
  reminderMessage,
} from './hoursCheckReminders';

export async function sendHoursCheckReminders(now = new Date()) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: jobs, error } = await supabaseAdmin
    .from('jobs')
    .select('id, status, scheduled_at, duration_minutes, start_window_minutes, properties(address, clients(name)), job_assignments(cleaner_id)')
    .in('status', ['missed', 'scheduled'])
    .gte('scheduled_at', since)
    .lt('scheduled_at', now.toISOString());
  if (error) return { sent: 0, error: error.message };
  if (!jobs || jobs.length === 0) return { sent: 0 };

  const jobIds = jobs.map((j) => j.id);
  const cleanerIds = [...new Set(jobs.flatMap((j) => (j.job_assignments || []).map((a) => a.cleaner_id)).filter(Boolean))];
  if (cleanerIds.length === 0) return { sent: 0 };

  const [{ data: claims }, { data: outcomes }, { data: told, error: toldError }, { data: active }] = await Promise.all([
    supabaseAdmin.from('missed_clockin_claims').select('job_id, cleaner_id, status').in('job_id', jobIds),
    supabaseAdmin.from('missed_shift_outcomes').select('job_id, cleaner_id').in('job_id', jobIds),
    supabaseAdmin.from('notifications').select('job_id, user_id').in('job_id', jobIds).like('message', `${MESSAGE_PREFIX}%`),
    supabaseAdmin.from('profiles').select('id').in('id', cleanerIds).eq('active', true).in('role', BOOKABLE_ROLES),
  ]);
  // Without notifications.job_id (0145) there is no way to remember who was
  // told, so every run would repeat itself. Send nothing instead.
  if (toldError) return { sent: 0, error: toldError.message };

  const reminders = hoursCheckReminders({
    jobs,
    claims: claims || [],
    outcomes: outcomes || [],
    alreadyTold: told || [],
    recipients: withoutTestAccounts(active || []).map((p) => p.id),
    now,
  });
  if (reminders.length === 0) return { sent: 0 };

  // Marked pushed: the push below is the phone copy, with a better link than
  // the bell sweep in api/notify would give it.
  const stamp = now.toISOString();
  const { error: insertError } = await supabaseAdmin.from('notifications').insert(
    reminders.map(({ cleanerId, job }) => ({ user_id: cleanerId, job_id: job.id, message: reminderMessage(job), pushed_at: stamp }))
  );
  if (insertError) return { sent: 0, error: insertError.message };

  const byCleaner = new Map();
  reminders.forEach((r) => {
    if (!byCleaner.has(r.cleanerId)) byCleaner.set(r.cleanerId, []);
    byCleaner.get(r.cleanerId).push(r);
  });

  let pushed = 0;
  const gone = [];
  for (const [cleanerId, theirs] of byCleaner) {
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', cleanerId);
    if (!subs || subs.length === 0) continue;
    const result = await sendPushToSubscriptions(subs, pushFor(theirs));
    pushed += result.sent;
    gone.push(...result.gone);
  }
  if (gone.length > 0) await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', gone);

  return { sent: reminders.length, people: byCleaner.size, pushed };
}
