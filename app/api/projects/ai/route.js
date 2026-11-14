import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { kindLabel } from '../../../../lib/projects';
import {
  AI_MODEL,
  TASKS_SYSTEM,
  TASKS_SCHEMA,
  DRAFT_SYSTEM,
  DRAFT_TYPES,
  MAX_FILE_BYTES,
  MAX_DRAFT_FILES,
  readableKind,
  unreadableReason,
  contentBlockFor,
  projectContext,
  cleanTaskSuggestions,
  draftPrompt,
  draftTypeLabel,
  splitDraft,
} from '../../../../lib/projectAi';

// AI tools for one project: suggest tasks from a document, or write a
// first draft. Office staff only, and only on projects whose AI switch is
// on (0138). Nothing is saved here except a line in the project's history
// recording that AI was used - the office decides what to keep.

export const runtime = 'nodejs';
// The most the current plan allows. Both tools run at low effort so a long
// document still finishes inside it.
export const maxDuration = 60;

const BUCKET = 'project-files';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

async function requireOffice(request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role, active').eq('id', user.id).single();
  if (!profile || profile.active === false) return null;
  if (profile.role !== 'admin' && profile.role !== 'supervisor') return null;
  return user;
}

function fail(error, message, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

async function loadFile(projectId, fileId) {
  const { data: row } = await supabaseAdmin
    .from('project_files')
    .select('id, file_name, storage_path, file_size')
    .eq('id', fileId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!row) return { error: 'That file is no longer on this project.' };
  if (!readableKind(row.file_name)) return { error: `${row.file_name}: ${unreadableReason(row.file_name)}` };
  if (row.file_size && row.file_size > MAX_FILE_BYTES) return { error: `${row.file_name} is too big to read (over 20 MB).` };
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_path);
  if (error || !blob) return { error: `Couldn't open ${row.file_name}.` };
  const buffer = Buffer.from(await blob.arrayBuffer());
  return { row, block: contentBlockFor(row.file_name, buffer) };
}

function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function POST(request) {
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);

  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }
  const { project_id: projectId, tool } = body || {};
  if (!projectId || (tool !== 'tasks' && tool !== 'draft')) return fail('bad_request', 'Bad request.');

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, kind, description, due_date, owner_id, ai_enabled, clients(name), properties(address)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project no longer exists.', 404);
  if (!project.ai_enabled) return fail('ai_off', 'AI tools are switched off for this project.', 403);

  const [{ data: tasks }, { data: dates }, { data: notes }, { data: owner }] = await Promise.all([
    supabaseAdmin.from('project_tasks').select('title, status, due_date').eq('project_id', projectId).order('position'),
    supabaseAdmin.from('project_dates').select('label, date, done').eq('project_id', projectId).order('date'),
    supabaseAdmin.from('project_notes').select('kind, body, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(40),
    project.owner_id
      ? supabaseAdmin.from('profiles').select('full_name').eq('id', project.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const context = projectContext({
    project, tasks: tasks || [], dates: dates || [], notes: notes || [],
    kindLabel: kindLabel(project.kind), ownerName: owner?.full_name, today,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    if (tool === 'tasks') {
      if (!body.file_id) return fail('bad_request', 'Pick a file to read.');
      const file = await loadFile(projectId, body.file_id);
      if (file.error) return fail('unreadable', file.error);

      const message = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: TASKS_SCHEMA } },
        system: TASKS_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            file.block,
            { type: 'text', text: `Project details:\n${context}\n\nList the tasks and key dates in the document "${file.row.file_name}".` },
          ],
        }],
      });

      if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to read this document.', 422);
      if (message.stop_reason === 'max_tokens') return fail('too_long', 'The document had more in it than could be listed in one go. Try a shorter section.', 422);

      let raw;
      try { raw = JSON.parse(textOf(message)); } catch { return fail('bad_output', 'The AI\'s answer couldn\'t be read. Please try again.', 502); }
      const result = cleanTaskSuggestions(raw, (tasks || []).map((t) => t.title));

      await supabaseAdmin.from('project_notes').insert({
        project_id: projectId, kind: 'event', created_by: user.id,
        body: `AI read ${file.row.file_name} and suggested ${result.tasks.length} task${result.tasks.length === 1 ? '' : 's'} and ${result.dates.length} date${result.dates.length === 1 ? '' : 's'}`,
      });

      return NextResponse.json({ ok: true, file_name: file.row.file_name, ...result });
    }

    // tool === 'draft'
    const draftType = DRAFT_TYPES.some((t) => t.value === body.draft_type) ? body.draft_type : 'free';
    const instruction = String(body.instruction || '').trim().slice(0, 4000);
    if (draftType === 'free' && !instruction) return fail('bad_request', 'Say what you\'d like written.');

    const fileIds = Array.isArray(body.file_ids) ? body.file_ids.slice(0, MAX_DRAFT_FILES) : [];
    const blocks = [];
    const used = [];
    for (const fileId of fileIds) {
      const file = await loadFile(projectId, fileId);
      if (file.error) return fail('unreadable', file.error);
      blocks.push(file.block);
      used.push(file.row.file_name);
    }

    const message = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: DRAFT_SYSTEM,
      messages: [{
        role: 'user',
        content: [...blocks, { type: 'text', text: draftPrompt({ draftType, instruction, context }) }],
      }],
    });

    if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to write this.', 422);
    const { body: draft, placeholders } = splitDraft(textOf(message));
    if (!draft) return fail('bad_output', 'Nothing came back. Please try again.', 502);

    await supabaseAdmin.from('project_notes').insert({
      project_id: projectId, kind: 'event', created_by: user.id,
      body: `AI drafted: ${draftType === 'free' ? instruction.slice(0, 80) : draftTypeLabel(draftType)}${used.length ? ` (from ${used.join(', ')})` : ''}`,
    });

    return NextResponse.json({ ok: true, draft, placeholders, truncated: message.stop_reason === 'max_tokens' });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return fail('busy', 'The AI is busy right now. Please try again in a minute.', 503);
    if (err instanceof Anthropic.BadRequestError) return fail('rejected', `The AI couldn't take this request: ${err.message}`, 422);
    if (err instanceof Anthropic.APIConnectionError) return fail('timeout', 'The AI took too long or couldn\'t be reached. Please try again.', 504);
    if (err instanceof Anthropic.APIError) return fail('ai_error', 'The AI had a problem. Please try again.', 502);
    return fail('error', 'Something went wrong. Please try again.', 500);
  }
}
