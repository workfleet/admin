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

// A Subject Access Request export - everything this system holds that
// relates to one client, in one file. Pulled with the service role
// (bypasses RLS deliberately - a SAR response needs everything, not
// just what the requesting admin's own role would normally see).
export async function GET(request, { params }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = params;

  const { data: client } = await supabaseAdmin.from('clients').select('*').eq('id', id).single();
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: properties } = await supabaseAdmin.from('properties').select('*').eq('client_id', id);
  const propertyIds = (properties || []).map((p) => p.id);

  const [
    { data: portalUsers },
    { data: requests },
    { data: pauses },
    { data: reschedules },
    { data: messages },
    { data: ratings },
    { data: quotes },
    { data: documents },
    { data: jobs },
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, full_name, created_at').eq('client_id', id).eq('role', 'client'),
    supabaseAdmin.from('client_requests').select('*').eq('client_id', id),
    supabaseAdmin.from('client_pause_requests').select('*').eq('client_id', id),
    supabaseAdmin.from('reschedule_requests').select('*').eq('client_id', id),
    supabaseAdmin.from('client_messages').select('*').eq('client_id', id).order('created_at'),
    supabaseAdmin.from('job_ratings').select('*').eq('client_id', id),
    supabaseAdmin.from('quotes').select('*').eq('client_id', id),
    supabaseAdmin.from('company_documents').select('id, title, category, file_name, created_at').eq('client_id', id),
    propertyIds.length > 0
      ? supabaseAdmin.from('jobs').select('id, scheduled_at, status, property_id').in('property_id', propertyIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Portal login emails come from auth.users, not profiles.
  const portalAccounts = await Promise.all(
    (portalUsers || []).map(async (p) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(p.id);
      return { full_name: p.full_name, email: data?.user?.email || null, account_created_at: data?.user?.created_at || null, last_sign_in_at: data?.user?.last_sign_in_at || null };
    })
  );

  const jobIds = (jobs || []).map((j) => j.id);
  const { data: reports } = jobIds.length > 0
    ? await supabaseAdmin.from('job_reports').select('job_id, summary, issues, suggestions, visible_to_client, created_at').in('job_id', jobIds).eq('visible_to_client', true)
    : { data: [] };

  const export_data = {
    exported_at: new Date().toISOString(),
    subject: 'client',
    client_record: client,
    portal_accounts: portalAccounts,
    properties,
    jobs,
    client_visible_job_reports: reports,
    requests_and_messages: {
      free_text_requests: requests,
      pause_requests: pauses,
      reschedule_requests: reschedules,
      messages,
    },
    ratings_given: ratings,
    quotes,
    documents_shared_with_client: documents,
  };

  return new NextResponse(JSON.stringify(export_data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="client-${id}-data-export.json"`,
    },
  });
}
