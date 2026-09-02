import { NextResponse } from 'next/server';
import { resend, EMAIL_FROM } from '../../../lib/resend';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendPushToSubscriptions } from '../../../lib/webPush';

// Any signed-in user may trigger a notification (a client sending a
// message needs to notify admin), but we still require a valid session
// so this can't be used as an open email-relay.
async function requireUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function emailForUserId(userId) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

async function adminEmails() {
  const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('role', 'admin');
  const emails = await Promise.all((admins || []).map((a) => emailForUserId(a.id)));
  return emails.filter(Boolean);
}

// Admin + supervisor, unlike adminEmails() - for an emergency alert,
// reaching whoever's actually reachable matters more than the usual
// admin-only escalation path other notification types use.
async function adminAndSupervisorEmails() {
  const { data: staff } = await supabaseAdmin.from('profiles').select('id').in('role', ['admin', 'supervisor']);
  const emails = await Promise.all((staff || []).map((a) => emailForUserId(a.id)));
  return emails.filter(Boolean);
}

async function clientEmails(clientId) {
  const { data: profiles } = await supabaseAdmin
    .from('profiles').select('id').eq('client_id', clientId).eq('role', 'client');
  const emails = await Promise.all((profiles || []).map((p) => emailForUserId(p.id)));
  return emails.filter(Boolean);
}

// Push, unlike email, isn't gated behind RESEND_API_KEY - it has its own
// independent "configured or not" check (see lib/webPush.js), so it
// still works even before anyone's set up email delivery.
async function pushToUserIds(userIds, payload) {
  if (userIds.length === 0) return;

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds);
  if (!subs || subs.length === 0) return;

  const { gone } = await sendPushToSubscriptions(subs, payload);
  if (gone.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', gone);
  }
}

// Cover offers go to every active cleaner except the person who
// released the shift - they're the one thing here where being a few
// minutes late to look at the app costs someone the shift.
async function pushActiveCleaners(excludeUserId, push) {
  const { data: cleaners } = await supabaseAdmin
    .from('profiles').select('id').eq('role', 'cleaner').eq('active', true);
  const ids = (cleaners || []).map((c) => c.id).filter((id) => id !== excludeUserId);
  await pushToUserIds(ids, push);
}

async function pushAdminsAndSupervisors(cleanerName) {
  const { data: staff } = await supabaseAdmin.from('profiles').select('id').in('role', ['admin', 'supervisor']);
  await pushToUserIds((staff || []).map((s) => s.id), {
    title: '🚨 Emergency Alert',
    body: `${cleanerName} needs help - tap to respond.`,
    tag: 'emergency-alert',
    url: '/admin',
  });
}

// Every shift time in this file goes through here. The server runs in UTC,
// so a time formatted without an explicit zone came out an hour early all
// summer - telling a cleaner their 9am shift was at 08:00. A notification
// naming the wrong hour is worse than not sending one at all.
function formatShiftTime(value) {
  return new Date(value).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

export async function POST(request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = await request.json();

  if (payload.type === 'shift_cover_needed') {
    await pushActiveCleaners(payload.releasedByCleanerId, {
      title: 'Shift needs cover',
      body: `${payload.address || 'A shift'} on ${formatShiftTime(payload.scheduledAt)} - first to accept takes it.`,
      tag: 'shift-cover',
      url: '/cleaner',
    });
  } else if (payload.type === 'shift_cover_filled') {
    if (payload.releasedByCleanerId) {
      await pushToUserIds([payload.releasedByCleanerId], {
        title: 'Your shift is covered',
        body: `Someone has picked up your shift at ${payload.address || 'the site'}.`,
        tag: 'shift-cover-filled',
        url: '/cleaner',
      });
    }
  } else if (payload.type === 'shift_rescheduled') {
    await pushToUserIds([payload.cleanerId], {
      title: 'Your shift has moved',
      body: `${payload.address || 'Your shift'} is now ${formatShiftTime(payload.scheduledAt)}`
        + (payload.previousAt ? ` (was ${formatShiftTime(payload.previousAt)}).` : '.'),
      // Tagged per job, so moving two different shifts shows two alerts but
      // moving the same one twice replaces its own rather than stacking.
      tag: `shift-moved-${payload.jobId || 'unknown'}`,
      url: '/cleaner/rota',
    });
  } else if (payload.type === 'missed_clockin_claimed') {
    // Goes to admin and supervisor both, like an emergency and unlike the
    // usual admin-only escalation: an unapproved claim is an unpaid shift
    // with a pay-run deadline on it, so whoever is actually at a screen
    // should see it.
    const { data: staff } = await supabaseAdmin.from('profiles').select('id').in('role', ['admin', 'supervisor']);
    await pushToUserIds((staff || []).map((s) => s.id), {
      title: 'Missed clock-in to confirm',
      body: `${payload.cleanerName || 'A cleaner'} says they worked ${payload.address || 'a shift'} on ${formatShiftTime(payload.scheduledAt)} without clocking in.`,
      tag: `missed-clockin-${payload.jobId || 'unknown'}`,
      url: '/admin/requests',
    });
  } else if (payload.type === 'missed_clockin_decided') {
    await pushToUserIds([payload.cleanerId], {
      title: payload.decision === 'approved' ? 'Missed clock-in approved' : 'Missed clock-in not confirmed',
      body: payload.decision === 'approved'
        ? `Your shift at ${payload.address || 'the site'} on ${formatShiftTime(payload.scheduledAt)} now counts towards your hours.`
        : `Your claim for ${payload.address || 'a shift'} on ${formatShiftTime(payload.scheduledAt)} wasn't confirmed${payload.note ? ` - ${payload.note}` : ''}.`,
      tag: `missed-clockin-decided-${payload.jobId || 'unknown'}`,
      url: '/cleaner/hours',
    });
  } else if (payload.type === 'short_shift_checkout') {
    // Somebody has closed a shift well before its booked time. Admin and
    // supervisor both, and promptly: while the cleaner may still be near the
    // property this is a question ("everything alright?"), and an hour later
    // it is an argument about a payslip.
    const { data: staff } = await supabaseAdmin.from('profiles').select('id').in('role', ['admin', 'supervisor']);
    await pushToUserIds((staff || []).map((s) => s.id), {
      title: 'Early check-out',
      body: `${payload.cleanerName || 'A cleaner'} checked out of ${payload.address || 'a shift'} after ${payload.clockedLabel || 'a short time'} of ${payload.bookedLabel || 'the booked time'}.`,
      tag: `short-shift-${payload.jobId || 'unknown'}`,
      url: '/admin/requests',
    });
  } else if (payload.type === 'emergency_alert') {
    await pushAdminsAndSupervisors(payload.cleanerName);
  } else if (payload.type === 'emergency_alert_acknowledged') {
    await pushToUserIds([payload.cleanerId], {
      title: 'Alert picked up',
      body: `${payload.responderName || 'Admin'} has picked up your emergency alert - help is on the way.`,
      tag: 'emergency-alert-acknowledged',
      url: '/cleaner',
    });
    return NextResponse.json({ pushed: true });
  }

  if (!process.env.RESEND_API_KEY) return NextResponse.json({ skipped: 'no_api_key' });

  try {
    let to = [];
    let subject = '';
    let text = '';

    if (payload.type === 'shift_assigned') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = 'New shift assigned';
      text = `You've been assigned a new shift at ${payload.address} on ${formatShiftTime(payload.scheduledAt)}.`;
    } else if (payload.type === 'shift_rescheduled') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = 'Your shift has moved';
      text = `Your shift at ${payload.address || 'the site'} has been moved`
        + (payload.previousAt ? ` from ${formatShiftTime(payload.previousAt)}` : '')
        + ` to ${formatShiftTime(payload.scheduledAt)}.`;
    } else if (payload.type === 'request_resolved') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = 'Your request has been resolved';
      text = `Your request ("${payload.description}") has been marked resolved.`
        + (payload.note ? `\n\nNote from admin: ${payload.note}` : '');
    } else if (payload.type === 'client_message') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `New message from ${payload.clientName}`;
      text = payload.body;
    } else if (payload.type === 'admin_reply') {
      to = await clientEmails(payload.clientId);
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = 'New message from CrewConnect Cleaning';
      text = payload.body;
    } else if (payload.type === 'direct_message') {
      const email = await emailForUserId(payload.toProfileId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      const { data: senderProfile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', user.id).single();
      to = [email];
      subject = `New message from ${senderProfile?.full_name || 'a team member'}`;
      text = payload.body;
    } else if (payload.type === 'time_off_requested') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      const label = payload.requestType === 'holiday' ? 'Holiday' : 'Unavailability';
      subject = `${label} request from ${payload.cleanerName}`;
      text = `${payload.cleanerName} requested ${label.toLowerCase()} from ${payload.startDate} to ${payload.endDate}`
        + (payload.hours ? ` (${payload.hours} hours).` : '.');
    } else if (payload.type === 'short_shift_checkout') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `Early check-out - ${payload.cleanerName || 'a cleaner'}`;
      text = `${payload.cleanerName || 'A cleaner'} checked out of ${payload.address || 'a shift'} on ${formatShiftTime(payload.scheduledAt)} after ${payload.clockedLabel || 'a short time'}, against ${payload.bookedLabel || 'the booked time'}.`
        + '\n\nThe shift has NOT been paid - it is held under Requests > Hours to Check until you confirm the hours or correct the booked time.';
    } else if (payload.type === 'missed_clockin_claimed') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `Missed clock-in to confirm - ${payload.cleanerName || 'a cleaner'}`;
      text = `${payload.cleanerName || 'A cleaner'} says they worked ${payload.address || 'a shift'} on ${formatShiftTime(payload.scheduledAt)} but did not clock in.`
        + (payload.reason ? `\n\nWhat they said: ${payload.reason}` : '')
        + '\n\nUntil this is approved the shift pays nothing and earns no holiday. Confirm it under Requests > Missed Clock-ins.';
    } else if (payload.type === 'missed_clockin_decided') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = payload.decision === 'approved' ? 'Missed clock-in approved' : 'Missed clock-in not confirmed';
      text = payload.decision === 'approved'
        ? `Your shift at ${payload.address || 'the site'} on ${formatShiftTime(payload.scheduledAt)} has been recorded as worked. Those hours now count towards your pay and your holiday.`
        : `Your claim for the shift at ${payload.address || 'the site'} on ${formatShiftTime(payload.scheduledAt)} was not confirmed.`
          + (payload.note ? `\n\nNote from admin: ${payload.note}` : '')
          + '\n\nIf that is not right, message the office.';
    } else if (payload.type === 'staff_invite') {
      // Unlike every other type above, the recipient here is a raw
      // client-supplied address (there's no account yet to resolve an
      // email from) - restrict this one to admins so it can't be used
      // as an open relay to spam arbitrary addresses.
      const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (!payload.email) return NextResponse.json({ skipped: 'no_email' });
      to = [payload.email];
      subject = 'Set up your CrewConnect Cleaning account';
      text = `Hi${payload.expectedName ? ' ' + payload.expectedName : ''},\n\n`
        + `Welcome to CrewConnect Cleaning! Use the link below to set up your login, fill in your details, upload your ID, and sign your contract:\n\n${payload.link}\n\n`
        + `This link expires in 14 days.`;
    } else if (payload.type === 'time_off_decided') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = `Your time off request was ${payload.status}`;
      text = `Your request for ${payload.startDate} to ${payload.endDate} was ${payload.status}.`
        + (payload.note ? `\n\nNote from admin: ${payload.note}` : '');
    } else if (payload.type === 'shift_cover_needed') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = payload.cleanerName
        ? `${payload.cleanerName} needs cover for a shift`
        : 'Cover needed for a shift';
      text = `${payload.cleanerName || 'Admin'} has opened a cover request for `
        + `${payload.address || 'a shift'} on ${formatShiftTime(payload.scheduledAt)}.`
        + (payload.reason ? `\n\nReason: ${payload.reason}` : '')
        + `\n\nThe shift is still assigned to them until someone else picks it up.`;
    } else if (payload.type === 'shift_cover_filled') {
      if (!payload.releasedByCleanerId) return NextResponse.json({ skipped: 'no_recipient' });
      const email = await emailForUserId(payload.releasedByCleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = 'Your shift has been covered';
      text = `Your shift at ${payload.address || 'the site'} on `
        + `${formatShiftTime(payload.scheduledAt)} has been picked up by another cleaner. `
        + `You're no longer assigned to it.`;
    } else if (payload.type === 'time_extension_requested') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `${payload.cleanerName} needs more time at ${payload.address}`;
      text = `${payload.cleanerName} requested ${payload.requestedMinutes} more minutes at ${payload.address}.`
        + (payload.reason ? `\n\nReason: ${payload.reason}` : '');
    } else if (payload.type === 'emergency_alert') {
      to = await adminAndSupervisorEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `EMERGENCY ALERT from ${payload.cleanerName}`;
      text = `${payload.cleanerName} has raised an emergency alert from the WorkFleet app. Call them back immediately.`;
    } else if (payload.type === 'time_extension_decided') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      if (payload.status === 'alternative_suggested') {
        subject = 'Admin suggested a different time for your job';
        text = `Instead of the extra time you requested at ${payload.address}, admin suggested: `
          + `${formatShiftTime(payload.suggestedScheduledAt)} (${payload.suggestedDuration} minutes).`
          + (payload.note ? `\n\nNote from admin: ${payload.note}` : '');
      } else {
        subject = `Your request for more time was ${payload.status}`;
        text = `Your request for ${payload.requestedMinutes} more minutes at ${payload.address} was ${payload.status}.`
          + (payload.note ? `\n\nNote from admin: ${payload.note}` : '');
      }
    } else {
      return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
    }

    // The SDK resolves (doesn't throw) on a rejected send - the failure
    // shows up as `error` in the result, not as an exception.
    const { data, error: sendError } = await resend.emails.send({ from: EMAIL_FROM, to, subject, text });
    if (sendError) {
      console.error('Resend rejected the email:', sendError);
      return NextResponse.json({ error: sendError.message || 'send_rejected' }, { status: 502 });
    }
    return NextResponse.json({ sent: true, id: data?.id });
  } catch (err) {
    console.error('Email notify failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
