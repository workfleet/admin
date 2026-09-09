import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { areasForJob, runPhotoCheck, missingAreas, MAX_PHOTOS_CHECKED } from '../../../../lib/photoCheck';

export const runtime = 'nodejs';
// Up to twelve photos through the model can take longer than the platform's
// default ten seconds, at which point the function is killed mid-call and
// the cleaner's check-out carries on as if no check had run. Sixty is the
// most the current plan allows.
export const maxDuration = 60;

const IMAGE_MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// Compares a job's photos with the property checklist, for the cleaner who
// is about to check out. See lib/photoCheck.js for what is asked and why.
//
// Cleaner-facing, unlike api/reports/generate: the person calling this is
// the one standing in the building, and the answer is for them. So the gate
// is "assigned to this job and still active", checked here against the
// service role rather than trusted from the client.
async function requireAssignedCleaner(request, jobId) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || !jobId) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const [{ data: profile }, { data: assignment }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role, active').eq('id', user.id).single(),
    supabaseAdmin.from('job_assignments').select('id').eq('job_id', jobId).eq('cleaner_id', user.id).maybeSingle(),
  ]);
  if (!profile?.active || !assignment) return null;
  return user;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { job_id: jobId, acknowledge } = body || {};
  if (!jobId) return NextResponse.json({ error: 'missing_job_id' }, { status: 400 });

  const user = await requireAssignedCleaner(request, jobId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // "Check out anyway": the cleaner has seen the list of missing areas and
  // gone regardless. Recorded against the check so the office can tell a
  // warning that was heeded from one that was not.
  if (acknowledge) {
    await supabaseAdmin
      .from('job_photo_checks')
      .update({ proceeded_anyway: true })
      .eq('id', acknowledge)
      .eq('job_id', jobId)
      .eq('cleaner_id', user.id);
    return NextResponse.json({ ok: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('id, property_id, properties(address)')
    .eq('id', jobId)
    .single();
  if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 404 });

  const [{ data: checklistItems }, { data: tasks }, { data: photoRows }] = await Promise.all([
    job.property_id
      ? supabaseAdmin.from('property_checklist_items').select('room, task, sort_order').eq('property_id', job.property_id).order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('tasks').select('description').eq('job_id', jobId),
    supabaseAdmin.from('photos').select('id, url').eq('job_id', jobId).order('created_at', { ascending: false }).limit(MAX_PHOTOS_CHECKED),
  ]);

  const areas = areasForJob(checklistItems, tasks);
  if (areas.length === 0) return NextResponse.json({ skipped: 'no_areas' });
  if (!photoRows || photoRows.length === 0) return NextResponse.json({ skipped: 'no_photos' });

  const imageBlocks = [];
  for (const photo of photoRows) {
    const { data: file } = await supabaseAdmin.storage.from('job-photos').download(photo.url);
    if (!file) continue;
    const ext = photo.url.split('.').pop().toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: IMAGE_MEDIA_TYPES[ext] || 'image/jpeg', data: buffer.toString('base64') },
    });
  }
  if (imageBlocks.length === 0) return NextResponse.json({ skipped: 'no_photos' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let outcome;
  try {
    outcome = await runPhotoCheck({ client, address: job.properties?.address, areas, imageBlocks });
  } catch (err) {
    return NextResponse.json({ error: 'check_failed', detail: err.message }, { status: 502 });
  }
  if (!outcome.ok) return NextResponse.json({ error: 'check_failed', detail: outcome.reason }, { status: 502 });

  const missing = missingAreas(outcome.result);

  const { data: saved } = await supabaseAdmin
    .from('job_photo_checks')
    .insert({
      job_id: jobId,
      cleaner_id: user.id,
      photo_count: imageBlocks.length,
      result: outcome.result,
      missing_count: missing.length,
    })
    .select('id, created_at')
    .single();

  return NextResponse.json({
    id: saved?.id || null,
    checked_at: saved?.created_at || new Date().toISOString(),
    photo_count: imageBlocks.length,
    areas: outcome.result.areas,
    summary: outcome.result.summary,
    missing,
  });
}
