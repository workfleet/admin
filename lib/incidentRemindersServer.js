// Sends the accident-book reminders that are due (lib/incidentReminders.js)
// to every active admin, once each (incident_reminders_sent, 0135). Server
// only: it uses the service key.
//
// Runs from the daily 08:00 cron (riding on payroll-reminder rather than a
// cron of its own, to stay inside the Vercel plan's cron allowance) and
// whenever an admin opens the dashboard. Both firing costs nothing: a key
// already in incident_reminders_sent is skipped.
//
// A bell row is enough to reach a phone (0086), so nothing here pushes.

import { supabaseAdmin } from './supabaseAdmin';
import { withoutTestAccounts } from './testAccounts';
import { dueReminders } from './incidentReminders';
import { londonDate } from './incidents';

const COLUMNS = 'id, kind, status, occurred_at, created_at, location, injured_party, injured_name, injured_status, treatment, off_work, back_at_work_on, riddor_category, riddor_reported_on, riddor_reference, reporter:profiles!incident_reports_reported_by_fkey(full_name)';

export async function sendIncidentReminders(today = londonDate(new Date())) {
  const { data: reports, error } = await supabaseAdmin.from('incident_reports').select(COLUMNS).neq('status', 'closed');
  if (error) return { sent: 0, error: error.message };

  const due = dueReminders(reports || [], today);
  if (due.length === 0) return { sent: 0 };

  const { data: already, error: sentError } = await supabaseAdmin
    .from('incident_reminders_sent')
    .select('report_id, reminder_key')
    .in('report_id', [...new Set(due.map((d) => d.report_id))]);
  // Before 0135 is run there is nowhere to record what went, so send
  // nothing rather than the same reminders every time.
  if (sentError) return { sent: 0, error: sentError.message };
  const seen = new Set((already || []).map((a) => `${a.report_id}|${a.reminder_key}`));
  const fresh = due.filter((d) => !seen.has(`${d.report_id}|${d.key}`));
  if (fresh.length === 0) return { sent: 0 };

  // Claim the keys first. Two runs at once (cron and a dashboard open) both
  // try; the primary key lets one through and the other gets a conflict.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('incident_reminders_sent')
    .upsert(fresh.map((d) => ({ report_id: d.report_id, reminder_key: d.key })), { onConflict: 'report_id,reminder_key', ignoreDuplicates: true })
    .select('report_id, reminder_key');
  if (claimError) return { sent: 0, error: claimError.message };
  const won = new Set((claimed || []).map((c) => `${c.report_id}|${c.reminder_key}`));
  const toSend = fresh.filter((d) => won.has(`${d.report_id}|${d.key}`));
  if (toSend.length === 0) return { sent: 0 };

  const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('role', 'admin').eq('active', true);
  const recipients = withoutTestAccounts(admins || []).map((a) => a.id);
  if (recipients.length === 0) return { sent: 0 };

  const rows = toSend.flatMap((d) => recipients.map((user_id) => ({ user_id, message: d.message })));
  await supabaseAdmin.from('notifications').insert(rows);
  return { sent: toSend.length, notified: recipients.length };
}
