import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';

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

// Staff accounts only, as with create and remove: an admin's own account is
// not edited from the Cleaners page, and a client's is not a staff account.
async function loadStaffProfile(id) {
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, full_name, role, active').eq('id', id).single();
  if (!profile || !['cleaner', 'supervisor'].includes(profile.role)) return null;
  return profile;
}

// The login email lives on auth.users, which the browser cannot read, so
// the page asks here for it.
export async function GET(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const profile = await loadStaffProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(params.id);
  return NextResponse.json({ email: userData?.user?.email || null });
}

// Name, login email, role between cleaner and supervisor, and a new
// password. Each is optional; only what is sent changes. The password is
// set, not emailed - the admin hands it over, as on the create form.
export async function PATCH(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const profile = await loadStaffProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : undefined;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined;
  const role = typeof body.role === 'string' ? body.role : undefined;

  if (fullName !== undefined && fullName.length === 0) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'bad_email' }, { status: 400 });
  }
  if (password !== undefined && password.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }
  if (role !== undefined && !['cleaner', 'supervisor'].includes(role)) {
    return NextResponse.json({ error: 'bad_role' }, { status: 400 });
  }

  // Auth first: if the email is taken nothing else should have moved.
  const authUpdate = {};
  if (email !== undefined) { authUpdate.email = email; authUpdate.email_confirm = true; }
  if (password !== undefined) authUpdate.password = password;
  if (fullName !== undefined) authUpdate.user_metadata = { full_name: fullName };

  if (Object.keys(authUpdate).length > 0) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(params.id, authUpdate);
    if (authError) {
      const taken = /already|exists|registered/i.test(authError.message || '');
      return NextResponse.json({ error: taken ? 'email_taken' : 'account_update_failed' }, { status: taken ? 409 : 502 });
    }
  }

  const profileUpdate = {};
  if (fullName !== undefined) profileUpdate.full_name = fullName;
  if (role !== undefined) profileUpdate.role = role;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', params.id);
    if (profileError) return NextResponse.json({ error: 'profile_update_failed' }, { status: 502 });
  }

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(params.id);
  const updated = await loadStaffProfile(params.id);
  return NextResponse.json({
    ok: true,
    full_name: updated?.full_name ?? profile.full_name,
    role: updated?.role ?? profile.role,
    email: userData?.user?.email || null,
    password_changed: password !== undefined,
  });
}
