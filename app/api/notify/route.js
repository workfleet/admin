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
    } else if (payload.type === 'time_off_decided') {
      const email = await emailForUserId(payload.cleanerId);
      if (!email) return NextResponse.json({ skipped: 'no_email' });
      to = [email];
      subject = `Your time off request was ${payload.status}`;
      text = `Your request for ${payload.startDate} to ${payload.endDate} was ${payload.status}.`
        + (payload.note ? `\n\nNote from admin: ${payload.note}` : '');
    } else {
      return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
    }

    await resend.emails.send({ from: EMAIL_FROM, to, subject, text });
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error('Email notify failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
