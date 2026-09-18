import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { flattenPrivate } from '../../../../../lib/profilePrivate';

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

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { full_name: fullName, email, password, role } = await request.json();

  // Only 'cleaner', 'supervisor' or 'inventory' can be granted here - never
  // 'admin' or 'client' through this staff-creation form.
  const grantedRole = ['supervisor', 'inventory'].includes(role) ? role : 'cleaner';

  if (!fullName?.trim() || !email?.trim() || !password || password.length < 8) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  const { data: created, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
    // Read by handle_new_user() (0106): only an account the office made
    // starts active. app_metadata cannot be set by a self-signup.
    app_metadata: { created_by_office: true },
  });

  if (createUserError) {
    const reason = createUserError.message?.toLowerCase().includes('already')
      ? 'email_taken'
      : 'account_creation_failed';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // handle_new_user() always creates the profile as role='cleaner' -
  // change it afterward if something else was requested.
  if (grantedRole !== 'cleaner') {
    const { error: roleUpdateError } = await supabaseAdmin
      .from('profiles')
      .update({ role: grantedRole })
      .eq('id', created.user.id);

    if (roleUpdateError) {
      return NextResponse.json({ error: 'role_promotion_failed' }, { status: 502 });
    }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, created_at, active, profile_private(holiday_adjustment_hours, deactivated_at)')
    .eq('id', created.user.id)
    .single();

  return NextResponse.json(flattenPrivate(profile));
}
