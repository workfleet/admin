import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export async function GET(request, { params }) {
  const { token } = params;

  const { data: invite, error } = await supabaseAdmin
    .from('staff_invites')
    .select('id, expected_name, status, expires_at')
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

  return NextResponse.json({ expected_name: invite.expected_name });
}
