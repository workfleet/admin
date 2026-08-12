import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

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

  // Only 'cleaner' or 'supervisor' can be granted here - never 'admin'
  // or 'client' through this staff-creation form.
  const grantedRole = role === 'supervisor' ? 'supervisor' : 'cleaner';

  if (!fullName?.trim() || !email?.trim() || !password || password.length < 8) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  const { data: created, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  });

  if (createUserError) {
    const reason = createUserError.message?.toLowerCase().includes('already')
      ? 'email_taken'
      : 'account_creation_failed';
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // handle_new_user() always creates the profile as role='cleaner' -
  // bump it to supervisor afterward if that's what was requested.
  if (grantedRole === 'supervisor') {
    await supabaseAdmin.from('profiles').update({ role: 'supervisor' }).eq('id', created.user.id);
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, created_at, active, holiday_adjustment_hours')
    .eq('id', created.user.id)
    .single();

  return NextResponse.json(profile);
}
