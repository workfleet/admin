import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export async function GET(request, { params }) {
  const { token } = params;

  const { data: invite, error } = await supabaseAdmin
    .from('staff_invites')
    .select(`
      id, expected_name, email, status, expires_at,
      job_title, hourly_rate, pay_frequency, start_date, reports_to,
      expected_address, expected_phone, expected_date_of_birth
    `)
    .eq('token', token)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (invite.status === 'submitted') {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  // The terms go out so the page can show the contract this person is
  // actually being offered, and the expected_* details so they start from
  // what the office already knows rather than typing it all again. Both are
  // reachable by anyone holding the link, which is by design: the token is
  // the access control, and this is their own data plus the offer made to
  // them. Nothing here is editable from the page - the submit route reads
  // the terms back out of the invite rather than trusting what comes back.
  return NextResponse.json({
    expected_name: invite.expected_name,
    email: invite.email,
    expected_address: invite.expected_address,
    expected_phone: invite.expected_phone,
    expected_date_of_birth: invite.expected_date_of_birth,
    invite: {
      job_title: invite.job_title,
      hourly_rate: invite.hourly_rate,
      pay_frequency: invite.pay_frequency,
      start_date: invite.start_date,
      reports_to: invite.reports_to,
    },
  });
}
