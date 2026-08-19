import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

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

// A Subject Access Request export for a cleaner/staff member - everything
// this system holds about them, in one file. Deliberately excludes the
// content of job photos they took (photos of a client's property aren't
// personal data about the cleaner) but includes everything that is.
export async function GET(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = params;

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', id).single();
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(id);

  const [
    { data: onboarding },
    { data: certifications },
    { data: checkins },
    { data: staffRequests },
    { data: timeOff },
    { data: extensions },
    { data: assignments },
    { data: emergencyAlerts },
    { data: pushSubs },
    { data: notifications },
    { data: participants },
  ] = await Promise.all([
    supabaseAdmin.from('staff_onboarding_submissions').select('*').eq('profile_id', id),
    supabaseAdmin.from('staff_certifications').select('*').eq('staff_id', id),
    supabaseAdmin.from('checkins').select('*').eq('cleaner_id', id),
    supabaseAdmin.from('staff_requests').select('*').eq('cleaner_id', id),
    supabaseAdmin.from('time_off_requests').select('*').eq('cleaner_id', id),
    supabaseAdmin.from('time_extension_requests').select('*').eq('cleaner_id', id),
    supabaseAdmin.from('job_assignments').select('id, job_id, jobs(scheduled_at, status, properties(address))').eq('cleaner_id', id),
    supabaseAdmin.from('emergency_alerts').select('*').eq('cleaner_id', id),
    supabaseAdmin.from('push_subscriptions').select('id, endpoint, created_at').eq('user_id', id),
    supabaseAdmin.from('notifications').select('*').eq('user_id', id),
    supabaseAdmin.from('conversation_participants').select('conversation_id').eq('profile_id', id),
  ]);

  // A signed link to their ID document, if one's on file - valid for 24
  // hours, long enough to actually hand over as part of the response.
  const onboardingWithLink = await Promise.all(
    (onboarding || []).map(async (o) => {
      if (!o.id_document_path) return o;
      const { data } = await supabaseAdmin.storage.from('staff-documents').createSignedUrl(o.id_document_path, 86400);
      return { ...o, id_document_signed_url: data?.signedUrl || null };
    })
  );

  const conversationIds = (participants || []).map((p) => p.conversation_id);
  const { data: messagesSent } = conversationIds.length > 0
    ? await supabaseAdmin.from('chat_messages').select('conversation_id, body, created_at').eq('sender_id', id).order('created_at')
    : { data: [] };

  const export_data = {
    exported_at: new Date().toISOString(),
    subject: 'staff/cleaner',
    profile_record: profile,
    account: {
      email: authUser?.user?.email || null,
      created_at: authUser?.user?.created_at || null,
      last_sign_in_at: authUser?.user?.last_sign_in_at || null,
    },
    onboarding_submission: onboardingWithLink,
    certifications,
    checkins,
    job_assignments: assignments,
    time_off_requests: timeOff,
    time_extension_requests: extensions,
    kit_and_issue_requests: staffRequests,
    emergency_alerts: emergencyAlerts,
    messages_sent: messagesSent,
    notifications,
    push_subscriptions: pushSubs,
  };

  return new NextResponse(JSON.stringify(export_data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="staff-${id}-data-export.json"`,
    },
  });
}
