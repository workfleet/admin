import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { kindLabel } from '../../../../lib/projects';
import {
  AI_MODEL,
  TASKS_SYSTEM,
  TASKS_SCHEMA,
  ASK_SYSTEM,
  DRAFT_TYPES,
  MAX_DRAFT_FILES,
  projectContext,
  cleanTaskSuggestions,
  draftTypeLabel,
} from '../../../../lib/projectAi';
import { draftSystem, companyContext, clientContext, draftRequestText, draftMessages, splitDraft, draftTitle } from '../../../../lib/aiDrafting';
import {
  FALLBACK_BETA, requireOffice, fail, loadCompany, loadFacts, londonToday, loadClientFacts,
  loadProjectFile, anthropicClient, textOf, aiErrorResponse,
} from '../../../../lib/aiServer';
import { factsContext } from '../../../../lib/companyFacts';

// AI tools for one project:
//  - tasks: suggest tasks and key dates from one project file
//  - draft: a first draft from the project (and its client's real facts)
//  - ask:   answer a question from the project's notes and files
// Office staff only, and only on projects whose AI switch is on (0138).
// Nothing is saved except a line in the project's history recording the
// use (and drafts in ai_drafts, 0139) - the office decides what to keep.

export const runtime = 'nodejs';
// The most the current plan allows; every tool runs at low effort so a
// long document still finishes inside it.
export const maxDuration = 60;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export async function POST(request) {
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }
  const { project_id: projectId, tool } = body || {};
  if (!projectId || !['tasks', 'draft', 'ask'].includes(tool)) return fail('bad_request', 'Bad request.');

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, kind, description, due_date, owner_id, client_id, property_id, ai_enabled, clients(name), properties(address)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project no longer exists.', 404);
  if (!project.ai_enabled) return fail('ai_off', 'AI tools are switched off for this project.', 403);

  const [{ data: tasks }, { data: dates }, { data: notes }, { data: owner }, company, facts, companyFacts] = await Promise.all([
    supabaseAdmin.from('project_tasks').select('title, status, due_date').eq('project_id', projectId).order('position'),
    supabaseAdmin.from('project_dates').select('label, date, done').eq('project_id', projectId).order('date'),
    supabaseAdmin.from('project_notes').select('kind, body, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(40),
    project.owner_id
      ? supabaseAdmin.from('profiles').select('full_name').eq('id', project.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadCompany(),
    loadClientFacts(project.client_id),
    loadFacts(),
  ]);
  const factsText = factsContext(companyFacts);

  const today = londonToday();
  const context = projectContext({
    project, tasks: tasks || [], dates: dates || [], notes: notes || [],
    kindLabel: kindLabel(project.kind), ownerName: owner?.full_name, today,
  });
  const clientText = facts
    ? clientContext({ ...facts, properties: project.property_id ? facts.properties.filter((p) => p.id === project.property_id) : facts.properties })
    : '';

  const log = (text) => supabaseAdmin.from('project_notes').insert({ project_id: projectId, kind: 'event', created_by: user.id, body: text });
  const client = anthropicClient();

  // Up to MAX_DRAFT_FILES of the project's files, as message blocks.
  const loadFiles = async (ids) => {
    const blocks = [];
    const names = [];
    for (const fileId of (Array.isArray(ids) ? ids : []).slice(0, MAX_DRAFT_FILES)) {
      const file = await loadProjectFile(projectId, fileId);
      if (file.error) return { error: file.error };
      blocks.push(file.block);
      names.push(file.name);
    }
    return { blocks, names };
  };

  try {
    if (tool === 'tasks') {
      if (!body.file_id) return fail('bad_request', 'Pick a file to read.');
      const file = await loadProjectFile(projectId, body.file_id);
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
          content: [file.block, { type: 'text', text: `Project details:\n${context}\n\nList the tasks and key dates in the document "${file.name}".` }],
        }],
      });

      if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to read this document.', 422);
      if (message.stop_reason === 'max_tokens') return fail('too_long', 'The document had more in it than could be listed in one go. Try a shorter section.', 422);

      let raw;
      try { raw = JSON.parse(textOf(message)); } catch { return fail('bad_output', 'The AI\'s answer couldn\'t be read. Please try again.', 502); }
      const result = cleanTaskSuggestions(raw, (tasks || []).map((t) => t.title));
      await log(`AI read ${file.name} and suggested ${plural(result.tasks.length, 'task')} and ${plural(result.dates.length, 'date')}`);
      return NextResponse.json({ ok: true, file_name: file.name, ...result });
    }

    if (tool === 'ask') {
      const question = String(body.question || '').trim().slice(0, 2000);
      if (!question) return fail('bad_request', 'Type a question.');
      const files = await loadFiles(body.file_ids);
      if (files.error) return fail('unreadable', files.error);

      const message = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 4000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: ASK_SYSTEM,
        messages: [{
          role: 'user',
          content: [...files.blocks, { type: 'text', text: `${factsText ? `${factsText}\n\n` : ''}Project details:\n${context}${clientText ? `\n\n${clientText}` : ''}\n\nQuestion: ${question}` }],
        }],
      });
      if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to answer this.', 422);
      const answer = textOf(message).trim();
      if (!answer) return fail('bad_output', 'Nothing came back. Please try again.', 502);
      await log(`AI answered: ${question.slice(0, 100)}${files.names.length ? ` (read ${files.names.join(', ')})` : ''}`);
      return NextResponse.json({ ok: true, answer });
    }

    // tool === 'draft'
    const draftType = DRAFT_TYPES.some((t) => t.value === body.draft_type) ? body.draft_type : 'free';
    const instruction = String(body.instruction || '').trim().slice(0, 4000);
    const changeRequest = String(body.change_request || '').trim().slice(0, 2000);
    const previousDraft = String(body.previous_draft || '').trim().slice(0, 60000);
    if (draftType === 'free' && !instruction) return fail('bad_request', 'Say what you\'d like written.');
    const files = await loadFiles(body.file_ids);
    if (files.error) return fail('unreadable', files.error);

    const firstRequest = draftRequestText({
      docType: 'free',
      instruction: `${draftType === 'free' ? '' : `${draftTypeLabel(draftType)}. `}${instruction}`.trim(),
      sections: [`Today's date: ${today}`, `Company details:\n${companyContext(company)}`, factsText, `Project details:\n${context}`, clientText ? `Client details from the company's records:\n${clientText}` : null],
    });

    const message = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: draftSystem(company, companyFacts),
      messages: draftMessages({ firstRequest, blocks: files.blocks, previousDraft, changeRequest }),
    });

    if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to write this.', 422);
    const { body: draft, placeholders } = splitDraft(textOf(message));
    if (!draft) return fail('bad_output', 'Nothing came back. Please try again.', 502);
    const title = draftTitle(draft, draftTypeLabel(draftType));

    const { data: saved } = await supabaseAdmin.from('ai_drafts').insert({
      doc_type: 'free', title, draft, placeholders,
      request: [draftTypeLabel(draftType), instruction, changeRequest && `Change: ${changeRequest}`, files.names.length && `Files: ${files.names.join(', ')}`].filter(Boolean).join(' | ').slice(0, 2000),
      client_id: project.client_id || null, project_id: projectId, created_by: user.id,
    }).select('id').maybeSingle();
    await log(`AI drafted: ${title}${files.names.length ? ` (from ${files.names.join(', ')})` : ''}`);

    return NextResponse.json({ ok: true, id: saved?.id || null, title, draft, placeholders, truncated: message.stop_reason === 'max_tokens' });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
