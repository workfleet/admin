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

// A true delete, for an account that was never really used: added by
// mistake, a duplicate, an invite that never signed in. Refused the moment
// the person has any history - shifts, check-ins, photos, claims, pay -
// because jobs, checkins and photos reference profiles without a cascade
// (deleting would fail) and the tables that do cascade hold records that
// should outlive the account (deleting would destroy them). For anyone with
// history the route is Remove (see ../remove), which frees the email and
// keeps everything.
const HISTORY = [
  ['job_assignments', 'cleaner_id'],
  ['checkins', 'cleaner_id'],
  ['photos', 'uploaded_by'],
  ['job_reports', 'generated_by'],
  ['missed_clockin_claims', 'cleaner_id'],
  ['missed_shift_outcomes', 'cleaner_id'],
  ['time_off_requests', 'cleaner_id'],
  ['staff_requests', 'cleaner_id'],
  ['time_extension_requests', 'cleaner_id'],
  ['emergency_alerts', 'cleaner_id'],
  ['staff_onboarding_submissions', 'profile_id'],
  ['staff_certifications', 'staff_id'],
  ['key_holdings', 'holder_id'],
  ['payroll_period_lines', 'cleaner_id'],
  ['payroll_adjustments', 'cleaner_id'],
];

async function historyFor(id) {
  const found = [];
  for (const [table, column] of HISTORY) {
    const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true }).eq(column, id);
    if (!error && count > 0) found.push(table);
  }
  return found;
}

export async function DELETE(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const profile = await loadStaffProfile(params.id);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const history = await historyFor(params.id);
  if (history.length > 0) {
    return NextResponse.json({ error: 'has_history', tables: history }, { status: 409 });
  }

  // Deleting the auth user cascades to the profile and from there to the
  // per-person rows that are safe to lose: notifications, presence, push
  // subscriptions, personal details, chat membership.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 502 });

  return NextResponse.json({ ok: true, deleted: profile.full_name });
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
