import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { REPORT_TEMPLATES, DEFAULT_TEMPLATE } from '../../../../lib/reportTemplates';

const IMAGE_MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

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

  const { job_id: jobId, notes, template: templateId } = await request.json();
  if (!jobId) return NextResponse.json({ error: 'missing_job_id' }, { status: 400 });

  const template = REPORT_TEMPLATES[templateId] || REPORT_TEMPLATES[DEFAULT_TEMPLATE];

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('id, scheduled_at, status, properties(address, notes)')
    .eq('id', jobId)
    .single();
  if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 404 });

  const { data: tasks } = await supabaseAdmin.from('tasks').select('description, completed').eq('job_id', jobId);
  const { data: photoRows } = await supabaseAdmin
    .from('photos').select('id, url').eq('job_id', jobId).order('created_at', { ascending: false }).limit(8);

  const imageBlocks = [];
  for (const photo of photoRows || []) {
    const { data: file } = await supabaseAdmin.storage.from('job-photos').download(photo.url);
    if (!file) continue;
    const ext = photo.url.split('.').pop().toLowerCase();
    const mediaType = IMAGE_MEDIA_TYPES[ext] || 'image/jpeg';
    const buffer = Buffer.from(await file.arrayBuffer());
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
    });
  }

  const taskList = (tasks || []).map((t) => `- [${t.completed ? 'x' : ' '}] ${t.description}`).join('\n') || '(no to-do list recorded)';

  const promptText = `You are writing a professional property cleaning report for a cleaning company's internal records.

Property: ${job.properties?.address || 'Unknown address'}
Job date: ${new Date(job.scheduled_at).toLocaleDateString()}

To-do list for this job:
${taskList}

Cleaner/admin notes about this job (may be typed or transcribed from speech, so may be informal or have transcription errors - use your judgement):
${notes?.trim() || '(no notes provided)'}

${imageBlocks.length} photo(s) from the job are attached below.

${template.promptInstructions}

Be concise, specific, and professional. Do not invent details that aren't supported by the notes or visible in the photos - if there isn't much to say for a section, keep it brief rather than padding it out.

Respond with ONLY valid JSON, no other text, in exactly this shape:
{"summary": "...", "issues": "...", "suggestions": "..."}

- "summary" -> the "${template.sectionLabels.summary}" section.
- "issues" -> the "${template.sectionLabels.issues}" section (write "None noted." if there's nothing to report).
- "suggestions" -> the "${template.sectionLabels.suggestions}" section (write "None." if there's nothing to add).`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let reportJson;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: promptText }, ...imageBlocks],
        },
      ],
    });

    const rawText = message.content.find((block) => block.type === 'text')?.text || '{}';
    // Claude sometimes wraps JSON in a ```json ... ``` fence despite being asked not to.
    const text = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    reportJson = JSON.parse(text);
  } catch (err) {
    return NextResponse.json({ error: 'generation_failed', detail: err.message }, { status: 500 });
  }

  const { data: saved, error: saveError } = await supabaseAdmin
    .from('job_reports')
    .upsert(
      {
        job_id: jobId,
        input_notes: notes || null,
        summary: reportJson.summary || null,
        issues: reportJson.issues || null,
        suggestions: reportJson.suggestions || null,
        template: templateId && REPORT_TEMPLATES[templateId] ? templateId : DEFAULT_TEMPLATE,
        generated_by: admin.id,
      },
      { onConflict: 'job_id' }
    )
    .select()
    .single();

  if (saveError) return NextResponse.json({ error: 'save_failed', detail: saveError.message }, { status: 500 });

  return NextResponse.json(saved);
}
