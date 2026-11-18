import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';
import { setSignInBlocked } from '../../../../../../lib/staffAccess';

export const runtime = 'nodejs';

// Client portal logins: the people at a client who can sign in to
// /client and see that client's visits, reports, documents and messages.
// Until this route there was no way to make one from the app, so no
// client had ever been given a login.
//
// Made with the service key, like staff accounts: handle_new_user() always
// creates the profile as an inactive cleaner, so the role, client and
// active flag are set here straight after createUser (see the Cleaners
// create route for why the trigger can't do it).

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

async function listLogins(clientId) {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, active, created_at')
    .eq('client_id', clientId)
    .eq('role', 'client')
    .order('created_at', { ascending: true });
  if (error) return { error };

  const logins = await Promise.all((profiles || []).map(async (p) => {
    const { data } = await supabaseAdmin.auth.admin.getUserById(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      active: p.active !== false,
      created_at: p.created_at,
      email: data?.user?.email || null,
      last_sign_in_at: data?.user?.last_sign_in_at || null,
    };
  }));
  return { logins };
}

// The login has to belong to this client and be a client login - never
// let these actions touch a staff or admin account.
async function findLogin(clientId, userId) {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, role, client_id')
    .eq('id', userId)
    .single();
  if (!data || data.role !== 'client' || data.client_id !== clientId) return null;
  return data;
}

export async function GET(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { logins, error } = await listLogins(params.id);
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 502 });
  return NextResponse.json({ logins });
}

export async function POST(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = params.id;
  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).single();
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { full_name: fullName, email, password } = await request.json();
  if (!fullName?.trim() || !email?.trim() || !password || password.length < 8) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
    app_metadata: { created_by_office: true },
  });

  if (createError) {
    const reason = createError.message?.toLowerCase().includes('already') ? 'email_taken' : 'account_creation_failed';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ role: 'client', client_id: clientId, active: true })
    .eq('id', created.user.id);

  if (profileError) {
    // Don't leave a half-made login behind: as a cleaner it would show up
    // under Cleaners and could reach the cleaner app.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: 'role_promotion_failed' }, { status: 502 });
  }

  const { logins } = await listLogins(clientId);
  return NextResponse.json({ logins });
}

// { user_id, action: 'reset_password', password } | { user_id, action: 'turn_off' | 'turn_on' }
export async function PATCH(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = params.id;
  const { user_id: userId, action, password } = await request.json();
  const login = await findLogin(clientId, userId);
  if (!login) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (action === 'reset_password') {
    if (!password || password.length < 8) return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });
  } else if (action === 'turn_off' || action === 'turn_on') {
    const on = action === 'turn_on';
    const banError = await setSignInBlocked(supabaseAdmin, userId, !on);
    if (banError) return NextResponse.json({ error: 'update_failed' }, { status: 502 });
    const { error } = await supabaseAdmin.from('profiles').update({ active: on }).eq('id', userId);
    if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });
  } else {
    return NextResponse.json({ error: 'bad_action' }, { status: 400 });
  }

  const { logins } = await listLogins(clientId);
  return NextResponse.json({ logins });
}
