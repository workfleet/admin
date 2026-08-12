import { NextResponse } from 'next/server';
import { resend, EMAIL_FROM } from '../../../lib/resend';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

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

async function clientEmails(clientId) {
  const { data: profiles } = await supabaseAdmin
    .from('profiles').select('id').eq('client_id', clientId).eq('role', 'client');
  const emails = await Promise.all((profiles || []).map((p) => emailForUserId(p.id)));
  return emails.filter(Boolean);
}

export async function POST(request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ skipped: 'no_api_key' });

  const payload = await request.json();

  try {
    let to = [];
    let subject = '';
    let text = '';

    if (payload.type === 'shift_assigned') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = 'New shift assigned';
      text = `You've been assigned a new shift at ${payload.address} on ${new Date(payload.scheduledAt).toLocaleString()}.`;
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
    } else if (payload.type === 'time_extension_requested') {
      to = await adminEmails();
      if (to.length === 0) return NextResponse.json({ skipped: 'no_email' });
      subject = `${payload.cleanerName} needs more time at ${payload.address}`;
      text = `${payload.cleanerName} requested ${payload.requestedMinutes} more minutes at ${payload.address}.`
        + (payload.reason ? `\n\nReason: ${payload.reason}` : '');
    } else if (payload.type === 'time_extension_decided') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      if (payload.status === 'alternative_suggested') {
        subject = 'Admin suggested a different time for your job';
        text = `Instead of the extra time you requested at ${payload.address}, admin suggested: `
          + `${new Date(payload.suggestedScheduledAt).toLocaleString()} (${payload.suggestedDuration} minutes).`
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
