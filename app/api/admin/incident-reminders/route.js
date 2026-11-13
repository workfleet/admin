import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { sendIncidentReminders } from '../../../../lib/incidentRemindersServer';

export const runtime = 'nodejs';

// Accident-book reminders: HSE deadlines, undecided injuries, reports left
// open, people still off work (lib/incidentReminders.js). The dashboard
// calls this whenever an admin opens it; the daily cron reaches the same
// sweep through payroll-reminder. Same two ways in as the other sweeps:
// the CRON_SECRET Vercel injects, or an admin's own session.
async function isAuthorised(request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin';
}

async function run(request) {
  if (!(await isAuthorised(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await sendIncidentReminders());
}

export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}
