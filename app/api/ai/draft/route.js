import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { kindLabel } from '../../../../lib/projects';
import { projectContext } from '../../../../lib/projectAi';
import { factsContext } from '../../../../lib/companyFacts';
import {
  AI_MODEL,
  draftSystem,
  companyContext,
  clientContext,
  draftRequestText,
  draftMessages,
  splitDraft,
  draftTitle,
  docTypeLabel,
  isDocType,
  planSystem,
  PLAN_SCHEMA,
  planRequestText,
  cleanPlan,
  answersText,
  MAX_QUESTIONS,
} from '../../../../lib/aiDrafting';
import {
  FALLBACK_BETA,
  requireOffice,
  fail,
  loadCompany,
  loadFacts,
  londonToday,
  loadClientFacts,
  loadProjectFile,
  loadLibraryFile,
  anthropicClient,
  textOf,
  aiErrorResponse,
} from '../../../../lib/aiServer';

// The site-wide AI assistant.
//
//  mode "plan":  read a one-line request, work out the document type and
//                client, and ask up to four questions it needs answered.
//  mode "draft": write the draft (or rewrite one with a change), using the
//                Company facts (0140), the answers, and whatever the office
//                chose to include - a client, site, project, files, text.
//
// Office only. Projects with AI switched off are refused. Drafts are kept
// in ai_drafts (0139).

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILES = 3;
const MAX_SOURCE_CHARS = 60000;

export async function POST(request) {
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }

  const mode = body?.mode === 'plan' ? 'plan' : 'draft';
  const docType = isDocType(body?.doc_type) ? body.doc_type : 'free';
  const instruction = String(body?.instruction || '').trim().slice(0, 6000);
  const sourceText = String(body?.source_text || '').trim().slice(0, MAX_SOURCE_CHARS);
  const previousDraft = String(body?.previous_draft || '').trim().slice(0, 60000);
  const changeRequest = String(body?.change_request || '').trim().slice(0, 2000);
  if ((mode === 'plan' || docType === 'free') && !instruction) return fail('bad_request', 'Say what you\'d like written.');

  const [company, facts] = await Promise.all([loadCompany(), loadFacts()]);
  const today = londonToday();
  const sections = [`Today's date: ${today}`, `Company details:\n${companyContext(company)}`, factsContext(facts)];

  // A project brings its own details and notes, but only if its AI switch
  // is on - a tender can forbid AI, and the assistant mustn't be a way round
  // that.
  let projectId = null;
  if (body?.project_id) {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, name, kind, description, due_date, client_id, ai_enabled, clients(name), properties(address)')
      .eq('id', body.project_id)
      .maybeSingle();
    if (!project) return fail('not_found', 'That project no longer exists.', 404);
    if (!project.ai_enabled) return fail('ai_off', `AI tools are switched off for "${project.name}". Switch them on from the project page first.`, 403);
    projectId = project.id;
    const [{ data: tasks }, { data: dates }, { data: notes }] = await Promise.all([
      supabaseAdmin.from('project_tasks').select('title, status, due_date').eq('project_id', project.id).order('position'),
      supabaseAdmin.from('project_dates').select('label, date, done').eq('project_id', project.id).order('date'),
      supabaseAdmin.from('project_notes').select('kind, body, created_at').eq('project_id', project.id).order('created_at', { ascending: false }).limit(40),
    ]);
    sections.push(`Project details:\n${projectContext({ project, tasks: tasks || [], dates: dates || [], notes: notes || [], kindLabel: kindLabel(project.kind), today })}`);
    if (!body.client_id && project.client_id) body.client_id = project.client_id;
  }

  let clientId = null;
  if (body?.client_id) {
    const clientFacts = await loadClientFacts(body.client_id);
    if (!clientFacts) return fail('not_found', 'That client no longer exists.', 404);
    clientId = clientFacts.client.id;
    const properties = body.property_id ? clientFacts.properties.filter((p) => p.id === body.property_id) : clientFacts.properties;
    sections.push(`Client details from the company's records:\n${clientContext({ ...clientFacts, properties })}`);
  }

  const client = anthropicClient();

  try {
    if (mode === 'plan') {
      // Client names so it can tell who "Sam's complaint" is about. Names
      // only - nothing else about clients not chosen.
      const { data: clientRows } = clientId ? { data: [] } : await supabaseAdmin.from('clients').select('id, name').order('name');
      const message = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 4000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
        system: planSystem(facts),
        messages: [{ role: 'user', content: planRequestText({ request: instruction, clientNames: (clientRows || []).map((c) => c.name), sections, sourceText }) }],
      });
      if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined this request.', 422);
      let raw;
      try { raw = JSON.parse(textOf(message)); } catch { return fail('bad_output', 'The AI\'s answer couldn\'t be read. Please try again.', 502); }
      const plan = cleanPlan(raw, clientRows || []);
      if (clientId) { plan.client_id = clientId; plan.client_name = null; }
      return NextResponse.json({ ok: true, ...plan });
    }

    const blocks = [];
    const used = [];
    const libraryIds = Array.isArray(body?.document_ids) ? body.document_ids : [];
    const projectFileIds = projectId && Array.isArray(body?.project_file_ids) ? body.project_file_ids : [];
    if (libraryIds.length + projectFileIds.length > MAX_FILES) return fail('too_many', `Pick up to ${MAX_FILES} files.`);
    for (const id of libraryIds) {
      const f = await loadLibraryFile(id);
      if (f.error) return fail('unreadable', f.error);
      blocks.push(f.block); used.push(f.name);
    }
    for (const id of projectFileIds) {
      const f = await loadProjectFile(projectId, id);
      if (f.error) return fail('unreadable', f.error);
      blocks.push(f.block); used.push(f.name);
    }

    const questions = Array.isArray(body?.questions) ? body.questions.slice(0, MAX_QUESTIONS).map((q) => ({ question: String(q?.question || '').slice(0, 200) })) : [];
    const answers = Array.isArray(body?.answers) ? body.answers.slice(0, MAX_QUESTIONS).map((a) => String(a || '').slice(0, 1000)) : [];
    const firstRequest = draftRequestText({ docType, instruction, sections: [...sections, answersText(questions, answers)], sourceText });

    const message = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: draftSystem(company, facts),
      messages: draftMessages({ firstRequest, blocks, previousDraft, changeRequest }),
    });

    if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined to write this.', 422);
    const { body: draft, placeholders } = splitDraft(textOf(message));
    if (!draft) return fail('bad_output', 'Nothing came back. Please try again.', 502);
    const title = draftTitle(draft, docTypeLabel(docType));

    const requestSummary = [
      docType === 'free' ? null : docTypeLabel(docType),
      instruction || null,
      changeRequest ? `Change: ${changeRequest}` : null,
      used.length ? `Files: ${used.join(', ')}` : null,
    ].filter(Boolean).join(' | ').slice(0, 2000);

    // Kept for reopening and as a record of AI use. A failure here doesn't
    // lose the draft.
    const { data: saved } = await supabaseAdmin.from('ai_drafts').insert({
      doc_type: docType, title, request: requestSummary, draft, placeholders,
      client_id: clientId, project_id: projectId,
      revised_from: body?.revised_from || null,
      created_by: user.id,
    }).select('id, created_at').maybeSingle();

    if (projectId) {
      await supabaseAdmin.from('project_notes').insert({
        project_id: projectId, kind: 'event', created_by: user.id,
        body: `AI assistant drafted: ${title}${used.length ? ` (from ${used.join(', ')})` : ''}`,
      });
    }

    return NextResponse.json({
      ok: true, id: saved?.id || null, title, draft, placeholders,
      truncated: message.stop_reason === 'max_tokens',
    });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
