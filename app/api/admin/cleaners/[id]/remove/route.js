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

// "Remove" rather than a true hard delete: deactivating alone leaves the
// account's email permanently attached to auth.users, so re-onboarding the
// same person (or anyone else) with that email later fails with
// "already registered". A real hard delete isn't safe here either - jobs,
// checkins, photos, job_reports, staff_invites and staff_onboarding_
// submissions all reference profiles.id with no cascade/set-null, so
// deleting a profile with any history would either destroy that history
// (for the tables that do cascade, like job_assignments) or fail outright
// (for the tables that don't). Freeing the email while keeping the profile
// row intact preserves all of that history and unblocks re-onboarding.
export async function POST(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, role, full_name').eq('id', id).single();

  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (profile.role === 'admin') {
    return NextResponse.json({ error: 'cannot_remove_admin' }, { status: 400 });
  }

  // Contract clause 11.3: all company property comes back before someone
  // leaves. Removing an account that still has keys against it is how a
  // key quietly stops being anybody's responsibility - so it's blocked by
  // default, and overriding it is a deliberate second decision the admin
  // has to make with the list in front of them.
  const { data: outstandingKeys } = await supabaseAdmin
    .from('key_holdings')
    .select('id, site_keys(label, properties(address))')
    .eq('holder_id', id)
    .is('returned_at', null);

  if (!body.force && outstandingKeys && outstandingKeys.length > 0) {
    return NextResponse.json(
      {
        error: 'keys_outstanding',
        keys: outstandingKeys.map((k) => ({
          label: k.site_keys?.label || 'Unlabelled key',
          address: k.site_keys?.properties?.address || 'Unknown site',
        })),
      },
      { status: 409 }
    );
  }

  const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getUserError || !userData?.user) {
    return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
  }

  const originalEmail = userData.user.email;
  const [localPart, domain] = originalEmail.split('@');
  const releasedEmail = `${localPart}+removed-${Date.now()}@${domain}`;

  const { error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    email: releasedEmail,
    email_confirm: true,
  });
  if (updateEmailError) {
    return NextResponse.json({ error: 'email_release_failed' }, { status: 502 });
  }

  const { error: deactivateError } = await supabaseAdmin
    .from('profiles').update({ active: false }).eq('id', id);
  if (deactivateError) {
    return NextResponse.json({ error: 'deactivate_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, releasedEmail: originalEmail });
}
