import { NextResponse } from 'next/server';
import { resend, EMAIL_FROM } from '../../../lib/resend';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { sendPushToSubscriptions } from '../../../lib/webPush';
import { rankCandidates, isGoodMatch, topReason } from '../../../lib/coverRanking';

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

  // A hand-written push for an event almost always has a bell row written
  // by trigger for the same people a moment earlier. Marking those rows
  // pushed stops the sweep below sending a plainer copy of the same news.
  await supabaseAdmin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('user_id', userIds)
    .is('pushed_at', null)
    .gt('created_at', new Date(Date.now() - 2 * 60000).toISOString());

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

const BELL_URL_BY_ROLE = {
  admin: '/admin/notifications',
  supervisor: '/admin/notifications',
  cleaner: '/cleaner/notifications',
  client: '/client',
};

// The bell is the source of truth for push (0086). Any notification row a
// trigger has written and nothing has pushed yet goes to that person's
// phone here, with the same words. Runs at the end of every request this
// route handles and on a timer from any open app, so a kit request raised
// at 6am reaches the office whether or not anything else happens first.
//
// Rows are claimed with one update before anything is sent, so two sweeps
// running at once cannot both push the same row.
async function flushPendingPushes() {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: pending } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, message, profiles(role)')
    .is('pushed_at', null)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(200);
  if (!pending || pending.length === 0) return 0;

  const { data: claimed } = await supabaseAdmin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', pending.map((n) => n.id))
    .is('pushed_at', null)
    .select('id');
  const claimedIds = new Set((claimed || []).map((n) => n.id));

  let sent = 0;
  for (const n of pending) {
    if (!claimedIds.has(n.id)) continue;
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', n.user_id);
    if (!subs || subs.length === 0) continue;

    const { gone } = await sendPushToSubscriptions(subs, {
      title: 'CrewConnect',
      body: n.message,
      tag: `bell-${n.id}`,
      url: BELL_URL_BY_ROLE[n.profiles?.role] || '/',
    });
    if (gone.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', gone);
    }
    sent += 1;
  }
  return sent;
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

// A cover offer, sent to the people who can actually take it. Before 0084
// this went to every active cleaner, including anyone on approved leave or
// already booked at that hour; now rank_cover_candidates() says who is
// eligible, and the ones it rates a good fit are told why - "you've worked
// here before" gets a shift picked up in a way "first to accept" does not.
// The offer itself stays open to everyone in the app, exactly as before;
// only the push is targeted. If the ranking is unavailable (the migration
// not yet run, say) it falls back to the old fan-out rather than to silence.
async function pushCoverOffer(payload, callerId) {
  // Only the person who released the shift, or the office, may fan an
  // offer out - otherwise any login could push every cleaner about any
  // open offer as often as it liked.
  if (payload.offerId) {
    const [{ data: offer }, { data: caller }] = await Promise.all([
      supabaseAdmin.from('shift_offers').select('released_by, opened_by').eq('id', payload.offerId).single(),
      supabaseAdmin.from('profiles').select('role').eq('id', callerId).single(),
    ]);
    const office = ['admin', 'supervisor'].includes(caller?.role);
    const own = offer && (offer.released_by === callerId || offer.opened_by === callerId);
    if (!office && !own) return;
  }

  const when = formatShiftTime(payload.scheduledAt);
  const generic = {
    title: 'Shift needs cover',
    body: `${payload.address || 'A shift'} on ${when} - first to accept takes it.`,
    tag: 'shift-cover',
    url: '/cleaner',
  };

  if (!payload.offerId) {
    await pushActiveCleaners(payload.releasedByCleanerId, generic);
    return;
  }

  const { data: rows, error } = await supabaseAdmin.rpc('rank_cover_candidates', { target_offer_id: payload.offerId });
  if (error || !rows) {
    await pushActiveCleaners(payload.releasedByCleanerId, generic);
    return;
  }

  const ranked = rankCandidates(rows, { jobMinutes: payload.durationMinutes || 60 })
    .filter((c) => c.eligible && c.cleaner_id !== payload.releasedByCleanerId);

  const good = ranked.filter((c) => isGoodMatch(c));
  const rest = ranked.filter((c) => !isGoodMatch(c));

  for (const c of good) {
    const reason = topReason(c);
    await pushToUserIds([c.cleaner_id], {
      ...generic,
      title: 'Shift needs cover - good match for you',
      body: `${payload.address || 'A shift'} on ${when}.${reason ? ` ${reason}.` : ''} First to accept takes it.`,
    });
  }
  await pushToUserIds(rest.map((c) => c.cleaner_id), generic);
}

// A chat message, to everyone else in the conversation. Recipients and the
// sender's name come from the database, not the payload, so a message can
// only ever notify the people who are actually in the room. Each role gets
// the link to its own Messages page. The in-app notification for the same
// message is written by trigger (0085).
async function pushChatMessage(payload, senderId) {
  if (!payload.conversationId) return;

  const [{ data: sender }, { data: conversation }, { data: participants }] = await Promise.all([
    supabaseAdmin.from('profiles').select('full_name').eq('id', senderId).single(),
    supabaseAdmin.from('conversations').select('type, name').eq('id', payload.conversationId).single(),
    supabaseAdmin
      .from('conversation_participants')
      .select('profile_id, profiles(role)')
      .eq('conversation_id', payload.conversationId),
  ]);
  if (!participants || participants.length === 0) return;

  // Only someone in the room can ring it. Without this, any login could
  // push a message to the members of any conversation whose id it guessed.
  if (!participants.some((p) => p.profile_id === senderId)) return;
  const recipients = participants.filter((p) => p.profile_id !== senderId);
  if (recipients.length === 0) return;

  const isGroup = conversation?.type === 'group';
  const snippet = String(payload.body || '').replace(/\s+/g, ' ').slice(0, 120);
  const title = `${sender?.full_name || 'New message'}${isGroup ? ` in ${conversation?.name || 'Team Chat'}` : ''}`;
  const tag = `chat-${payload.conversationId}`;

  const office = recipients.filter((p) => ['admin', 'supervisor'].includes(p.profiles?.role)).map((p) => p.profile_id);
  const cleaners = recipients.filter((p) => p.profiles?.role === 'cleaner').map((p) => p.profile_id);

  await pushToUserIds(office, { title, body: snippet, tag, url: '/admin/messages' });
  await pushToUserIds(cleaners, { title, body: snippet, tag, url: '/cleaner/messages' });
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

  // Nothing to say, just "push whatever is waiting". Called on a timer by
  // any open app (see PresenceIndicator) so trigger-written bell rows reach
  // phones without waiting for the next event.
  if (payload.type === 'flush') {
    const sent = await flushPendingPushes();
    return NextResponse.json({ ok: true, sent });
  }

  if (payload.type === 'shift_cover_needed') {
    await pushCoverOffer(payload, user.id);
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
  } else if (payload.type === 'chat_message') {
    await pushChatMessage(payload, user.id);
  } else if (payload.type === 'payroll_closed') {
    // One push per cleaner, because each one carries that person's own
    // figure - the point of telling them is that they check it. The in-app
    // notification with the same figure is written by close_payroll_period().
    for (const cleaner of payload.cleaners || []) {
      if (!cleaner?.id) continue;
      await pushToUserIds([cleaner.id], {
        title: 'Hours sent to payroll',
        body: `${payload.periodLabel || 'Your latest pay period'}: ${cleaner.hoursLabel || 'your hours'} went to payroll. Check them on My Hours.`,
        tag: `payroll-closed-${payload.periodLabel || 'latest'}`,
        url: '/cleaner/hours',
      });
    }
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

  // Whatever this event's trigger put in the bell for anyone else - and
  // anything older still waiting - goes out now, before the email step,
  // which returns early when email is not configured.
  await flushPendingPushes();

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
    } else if (payload.type === 'cleaner_arrived') {
      // Sent by the cleaner's own check-in. Everything about who gets it is
      // looked up from the job, and only someone on the job can send it.
      // The bell entry and push for the same arrival come from the checkins
      // trigger (0090); this is the email, arrival only.
      const { data: assignment } = await supabaseAdmin
        .from('job_assignments').select('id').eq('job_id', payload.jobId).eq('cleaner_id', user.id).maybeSingle();
      if (!assignment) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

      const { data: jobRow } = await supabaseAdmin
        .from('jobs')
        .select('scheduled_at, properties(address, client_id, clients(name, arrival_alerts))')
        .eq('id', payload.jobId)
        .single();
      const client = jobRow?.properties?.clients;
      if (!client?.arrival_alerts) return NextResponse.json({ skipped: 'alerts_off' });

      to = await clientEmails(jobRow.properties.client_id);
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });

      const { data: sender } = await supabaseAdmin.from('profiles').select('full_name').eq('id', user.id).single();
      const who = sender?.full_name || 'Your cleaner';
      subject = `${who} has arrived`;
      text = `${who} has arrived at ${jobRow.properties.address} (${formatShiftTime(new Date().toISOString())}).\n\n`
        + 'You can follow the visit, see photos afterwards, and rate it in your CrewConnect portal.\n\n'
        + 'To stop these emails, turn off Visit Alerts under Settings in the portal.';
    } else if (payload.type === 'admin_reply') {
      to = await clientEmails(payload.clientId);
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = 'New message from CrewConnect Cleaning';
      text = payload.body;
    } else if (payload.type === 'chat_message' || payload.type === 'direct_message') {
      // Email only for a one-to-one message. A group post has already pushed
      // and gone in the bell; emailing a whole room for every line would get
      // the emails switched off. The recipient is looked up from the
      // conversation, not trusted from the payload.
      if (!payload.toProfileId && payload.conversationId) {
        const { data: others } = await supabaseAdmin
          .from('conversation_participants')
          .select('profile_id, conversations!inner(type)')
          .eq('conversation_id', payload.conversationId)
          .neq('profile_id', user.id);
        const direct = others?.length === 1 && others[0].conversations?.type === 'direct';
        if (!direct) return NextResponse.json({ skipped: 'group_message' });
        payload.toProfileId = others[0].profile_id;
      }
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
