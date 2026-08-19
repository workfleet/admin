import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';

// 6 years is the standard UK default for employment and business
// records - aligns with the Limitation Act 1980's 6-year window to
// bring a contract claim, and the Companies Act 2006's 6-year
// requirement for accounting records. Used here for both staff and
// client data per the privacy notice (app/privacy). Not legal advice -
// review with a solicitor if your business needs a different period.
const RETENTION_YEARS = 6;

// Two ways in: Vercel Cron (see vercel.json) hits this with the
// CRON_SECRET Vercel injects automatically once that env var is set,
// or an admin can trigger it manually from the UI with their own
// session - useful for verifying it actually works before waiting
// years for real data to age into scope.
async function isAuthorised(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return false;

  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin';
}

// Vercel Cron always sends GET, with Authorization: Bearer $CRON_SECRET
// automatically once that env var is set on the project. POST is kept
// for the admin UI's manual "Run Now" button, using the admin's own
// session instead of the cron secret.
async function runRetentionSweep(request) {
  if (!(await isAuthorised(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  const cutoffIso = cutoff.toISOString();

  const cleanersProcessed = [];
  const clientsProcessed = [];

  // Cleaners/staff - anonymise rather than delete the profile outright,
  // since jobs/checkins/ratings reference profiles.id with no cascade
  // (see the comment in api/admin/cleaners/[id]/remove) - deleting the
  // row would either destroy that operational history or fail outright.
  const { data: expiredCleaners } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'cleaner')
    .eq('active', false)
    .lt('deactivated_at', cutoffIso);

  for (const cleaner of expiredCleaners || []) {
    const { data: submissions } = await supabaseAdmin
      .from('staff_onboarding_submissions')
      .select('id, id_document_path')
      .eq('profile_id', cleaner.id);

    for (const submission of submissions || []) {
      if (submission.id_document_path) {
        await supabaseAdmin.storage.from('staff-documents').remove([submission.id_document_path]);
      }
      await supabaseAdmin
        .from('staff_onboarding_submissions')
        .update({
          full_name: 'Redacted',
          date_of_birth: null,
          address: 'Redacted',
          phone: null,
          email: null,
          ni_number: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          signed_name: 'Redacted',
          signed_ip: null,
          id_document_path: null,
        })
        .eq('id', submission.id);
    }

    await supabaseAdmin.from('profiles').update({ full_name: 'Former staff member' }).eq('id', cleaner.id);
    cleanersProcessed.push(cleaner.id);
  }

  // Clients - only ones admin has explicitly marked as ended via
  // relationship_ended_at (see admin/clients/[id]) - never guessed.
  const { data: expiredClients } = await supabaseAdmin
    .from('clients')
    .select('id')
    .not('relationship_ended_at', 'is', null)
    .lt('relationship_ended_at', cutoffIso);

  for (const client of expiredClients || []) {
    await supabaseAdmin
      .from('clients')
      .update({ contact_name: 'Redacted', email: null, phone: null, billing_address: 'Redacted', notes: null })
      .eq('id', client.id);

    await supabaseAdmin.from('properties').update({ client_access_notes: null }).eq('client_id', client.id);
    clientsProcessed.push(client.id);
  }

  return NextResponse.json({ ok: true, cutoff: cutoffIso, cleanersProcessed, clientsProcessed });
}

export async function GET(request) {
  return runRetentionSweep(request);
}

export async function POST(request) {
  return runRetentionSweep(request);
}
