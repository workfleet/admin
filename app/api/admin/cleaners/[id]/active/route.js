import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { BANNED_FOR, setSignInBlocked } from '../../../../../../lib/staffAccess';

async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return null;

  return user;
}

// Deactivate or reactivate a staff account. Flipping profiles.active from
// the browser only stopped a fresh login: anyone already signed in on their
// phone kept the app, because their session renewed itself every hour and
// nothing on the staff side ever looked at the flag again. So the flag and
// the sign-in are changed together, here, with the service key: a
// deactivated account is also banned in Supabase Auth, which refuses the
// next token refresh and every new login, and reactivating lifts the ban.
export async function POST(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (id === admin.id) return NextResponse.json({ error: 'cannot_change_self' }, { status: 400 });

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, role').eq('id', id).single();
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (profile.role === 'admin') return NextResponse.json({ error: 'cannot_deactivate_admin' }, { status: 400 });

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('profiles').update({ active: body.active }).eq('id', id)
    .select('id, active').single();
  if (updateError || !updated) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  const blockError = await setSignInBlocked(supabaseAdmin, id, !body.active);
  if (blockError) {
    // The flag has changed, so the app already turns them away on its next
    // load - but say so, because their sign-in itself was not cut off.
    return NextResponse.json({ error: 'sign_in_not_changed', active: updated.active }, { status: 502 });
  }

  return NextResponse.json({ ok: true, active: updated.active, bannedFor: body.active ? null : BANNED_FOR });
}
