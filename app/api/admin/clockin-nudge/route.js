import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendPushToSubscriptions } from '../../../../lib/webPush';
import { NUDGE_AFTER_MINUTES } from '../../../../lib/missedClockin';

export const runtime = 'nodejs';

// Prevention, for the forgotten clock-in that migration 0076 exists to cure.
//
// A cure that runs weeks later is a poor second to a phone buzzing while the
// cleaner is still standing in the building - at that point the fix is one
// tap on Check In, costs nobody an approval, and leaves a real clock-in in
// the record instead of a declared one. So this sweeps for jobs that have
// started with nobody checked in and prods whoever is assigned.
//
// Same two ways in as api/admin/enforce-retention: Vercel Cron with the
// CRON_SECRET it injects, or an admin's own session for a manual run.
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

// Server-side, so the hour has to be spelled out. Same reasoning as the
// formatShiftTime comment in api/notify: the server runs in UTC, and a
// notification naming the wrong hour is worse than no notification.
function formatShiftTime(value) {
  return new Date(value).toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
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

async function runNudgeSweep(request) {
  if (!(await isAuthorised(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  const startedBefore = new Date(now.getTime() - NUDGE_AFTER_MINUTES * 60000).toISOString();

  // Only jobs still at 'scheduled'. A job at 'in_progress' has somebody
  // checked into it, and 'completed'/'missed' are both past the point where
  // a nudge helps - the second of those is what the claim path is for.
  //
  // The 24-hour floor keeps a first run (or one after an outage) from firing
  // a week of stale alerts at everyone at once. Anything older than that has
  // already been through the missed path and belongs to an admin, not a
  // notification.
  const { data: jobs } = await supabaseAdmin
    .from('jobs')
    .select('id, scheduled_at, status, clockin_nudge_sent_at, properties(address), job_assignments(cleaner_id)')
    .eq('status', 'scheduled')
    .is('clockin_nudge_sent_at', null)
    .lt('scheduled_at', startedBefore)
    .gt('scheduled_at', new Date(now.getTime() - 24 * 60 * 60000).toISOString());

  const nudged = [];
  const skipped = [];

  for (const job of jobs || []) {
    const cleanerIds = (job.job_assignments || []).map((a) => a.cleaner_id).filter(Boolean);

    // Nobody assigned is a rota problem, not a clock-in problem - there is
    // no one to tell, and the unassigned count on the rota already says so.
    if (cleanerIds.length === 0) { skipped.push({ id: job.id, why: 'unassigned' }); continue; }

    // Belt and braces against the status column being behind: a check-in
    // row is the thing that actually means somebody is here.
    const { count } = await supabaseAdmin
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id)
      .not('checked_in_at', 'is', null);
    if (count > 0) { skipped.push({ id: job.id, why: 'already_checked_in' }); continue; }

    const address = job.properties?.address || 'Your shift';

    await pushToUserIds(cleanerIds, {
      title: "You haven't clocked in",
      body: `${address} started at ${formatShiftTime(job.scheduled_at)}. Tap to check in — your hours are paid from this.`,
      tag: `clockin-missing-${job.id}`,
      url: `/cleaner/jobs/${job.id}`,
    });

    // In-app too, since push needs an opted-in subscription and not everyone
    // has one. This is the copy that survives a phone with notifications off.
    await supabaseAdmin.from('notifications').insert(
      cleanerIds.map((id) => ({
        user_id: id,
        message: `You haven't clocked in at ${address} (${formatShiftTime(job.scheduled_at)}). Check in now, or tell the office if you've already finished.`,
      }))
    );

    // Stamped last and unconditionally: a push that failed to deliver is not
    // a reason to send the same alert again on the next run, and this column
    // is the only thing standing between a quarter-hourly cron and a cleaner
    // being buzzed every 15 minutes all afternoon.
    await supabaseAdmin.from('jobs').update({ clockin_nudge_sent_at: now.toISOString() }).eq('id', job.id);
    nudged.push(job.id);
  }

  return NextResponse.json({ ok: true, checked: (jobs || []).length, nudged, skipped });
}

export async function GET(request) {
  return runNudgeSweep(request);
}

export async function POST(request) {
  return runNudgeSweep(request);
}
