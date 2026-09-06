import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendPushToSubscriptions } from '../../../../lib/webPush';
import {
  DEFAULT_PAYROLL_SETTINGS,
  nextPeriodToClose,
  isLastDayOfPeriod,
  parseLocalDate,
  periodLabel,
  todayInZone,
} from '../../../../lib/payroll';

export const runtime = 'nodejs';

// "Payroll closes tomorrow - check your hours."
//
// A pay period locks once the office closes it (0082), and after that a
// wrong figure is an adjustment on the next run rather than a fix on this
// one. The cheapest moment to catch a missing shift is the day before, while
// the cleaner can still raise a claim and the office can still decide it. So
// on a period's last day, everyone who worked in it gets a nudge to look at
// My Hours.
//
// Daily, because that is what Vercel Cron allows on this plan (see the note
// in api/admin/clockin-nudge) and daily is all this needs: it runs every
// morning, does nothing unless today is a period's final day, and a period
// only has one of those. Same two ways in as the other sweeps: the
// CRON_SECRET Vercel injects, or an admin's own session for a manual run.
async function isAuthorised(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return false;

  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin';
}

async function pushToUserIds(userIds, payload) {
  if (userIds.length === 0) return 0;

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds);
  if (!subs || subs.length === 0) return 0;

  const { sent, gone } = await sendPushToSubscriptions(subs, payload);
  if (gone.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', gone);
  }
  return sent;
}

async function runReminder(request) {
  if (!(await isAuthorised(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [{ data: cs }, { data: lastPeriod }] = await Promise.all([
    supabaseAdmin.from('company_settings').select('payroll_frequency, payroll_week_starts_on').limit(1).maybeSingle(),
    supabaseAdmin.from('payroll_periods').select('period_end').order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Nothing closed yet means no schedule the office has committed to, and a
  // reminder about a week nobody is going to close is noise.
  if (!lastPeriod) return NextResponse.json({ sent: 0, reason: 'no_closed_periods' });

  const settings = {
    frequency: cs?.payroll_frequency || DEFAULT_PAYROLL_SETTINGS.frequency,
    weekStartsOn: cs?.payroll_week_starts_on ?? DEFAULT_PAYROLL_SETTINGS.weekStartsOn,
  };
  const period = nextPeriodToClose(lastPeriod.period_end, settings);

  // The server's clock is UTC; the office's day is London's. Compare dates,
  // not instants, so a 23:30 BST run on Thursday is still Thursday.
  const today = parseLocalDate(todayInZone('Europe/London'));
  if (!isLastDayOfPeriod(period, today)) {
    return NextResponse.json({ sent: 0, reason: 'not_last_day', period });
  }

  // Everyone with a job in the period, worked or not - a shift that reads
  // 'missed' is exactly the one they need to look at.
  const { data: assignments } = await supabaseAdmin
    .from('job_assignments')
    .select('cleaner_id, jobs!inner(scheduled_at)')
    .gte('jobs.scheduled_at', parseLocalDate(period.start).toISOString())
    .lt('jobs.scheduled_at', parseLocalDate(period.end).toISOString());

  const cleanerIds = [...new Set((assignments || []).map((a) => a.cleaner_id).filter(Boolean))];
  if (cleanerIds.length === 0) return NextResponse.json({ sent: 0, reason: 'nobody_in_period', period });

  const { data: active } = await supabaseAdmin
    .from('profiles').select('id').in('id', cleanerIds).eq('active', true).eq('role', 'cleaner');
  const recipients = (active || []).map((p) => p.id);

  const label = periodLabel(period, { withYear: false });
  const message = `Payroll for ${label} closes tomorrow - check My Hours and tell the office today if a shift is missing.`;

  if (recipients.length > 0) {
    await supabaseAdmin.from('notifications').insert(recipients.map((id) => ({ user_id: id, message })));
  }

  const sent = await pushToUserIds(recipients, {
    title: 'Payroll closes tomorrow',
    body: `Check your hours for ${label} before the office locks them.`,
    tag: `payroll-reminder-${period.start}`,
    url: '/cleaner/hours',
  });

  return NextResponse.json({ sent, notified: recipients.length, period });
}

export async function GET(request) {
  return runReminder(request);
}

export async function POST(request) {
  return runReminder(request);
}
