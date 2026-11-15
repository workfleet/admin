import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { AI_MODEL } from '../../../../lib/aiDrafting';
import { cleanHelpMessages } from '../../../../lib/helpChat';
import { factsContext } from '../../../../lib/companyFacts';
import { projectChatSystem, projectChatContext, PROJECT_TOOLS } from '../../../../lib/projectChat';
import { loadProjectBundle, readProjectFile, checkProjectChange, STOP_READING } from '../../../../lib/projectChatServer';
import { FALLBACK_BETA, requireOffice, fail, loadFacts, londonToday, anthropicClient, textOf, aiErrorResponse } from '../../../../lib/aiServer';

// The chat on a project page. It reads the project (tasks, dates, notes,
// files) and proposes changes as one list; nothing is changed here. Office
// staff only, and only on projects whose AI switch is on (0138).

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_STEPS = 10;
const TIME_BUDGET_MS = 50000;
// Files one message may open, and when to stop opening more, so a big
// project answers inside the 60 seconds instead of being cut off.
const MAX_READS = 6;
const READ_BUDGET_MS = 32000;

export async function POST(request) {
  const startedAt = Date.now();
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }
  const bundle = body?.project_id ? await loadProjectBundle(body.project_id) : null;
  if (!bundle) return fail('not_found', 'That project no longer exists.', 404);
  if (!bundle.project.ai_enabled) return fail('ai_off', 'AI tools are switched off for this project.', 403);

  const messages = cleanHelpMessages(body?.messages);
  if (!messages.length) return fail('bad_request', 'Type a message.');

  // The project as it is right now goes with the latest message, so every
  // turn works from the current tasks and files.
  const facts = factsContext(await loadFacts());
  const context = projectChatContext({ ...bundle, today: londonToday() });
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: 'user', content: `${last.content}\n\n<project>\n${context}\n</project>${facts ? `\n\n<company>\n${facts}\n</company>` : ''}` };

  const system = [{ type: 'text', text: projectChatSystem(bundle.project.name), cache_control: { type: 'ephemeral' } }];
  const client = anthropicClient();
  const changes = [];
  let reads = 0;
  let answer = '';

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
        tools: PROJECT_TOOLS,
        messages,
      });
      if (message.stop_reason === 'refusal') return fail('refused', 'Sorry, I can\'t help with that one.', 422);
      const text = textOf(message).trim();
      if (text) answer = text;
      const calls = message.content.filter((b) => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || !calls.length) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        answer = answer || 'That took longer than expected. Try asking for one thing at a time.';
        break;
      }
      messages.push({ role: 'assistant', content: message.content });
      const results = [];
      for (const call of calls) {
        let content;
        try {
          if (call.name === 'read_file') {
            if (reads >= MAX_READS || Date.now() - startedAt > READ_BUDGET_MS) {
              content = STOP_READING;
            } else {
              reads += 1;
              const r = await readProjectFile(bundle, call.input?.file_id);
              content = r.blocks || r.text || JSON.stringify(r);
            }
          } else if (call.name === 'propose_project_changes') {
            const checked = [];
            for (const c of (call.input?.changes || []).slice(0, 40)) checked.push(await checkProjectChange(c, bundle));
            changes.push(...checked);
            content = JSON.stringify({
              shown_to_user: checked.map((c) => (c.error ? { error: c.error } : { change: c.headline, details: c.details, warnings: c.warnings || [] })),
              note: 'Shown as one list. Nothing has changed until they apply it.',
            });
          } else {
            content = JSON.stringify({ error: 'Unknown tool.' });
          }
        } catch {
          content = JSON.stringify({ error: 'That didn\'t work.' });
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
      messages.push({ role: 'user', content: results });
    }

    if (changes.length) {
      await supabaseAdmin.from('project_notes').insert({
        project_id: bundle.project.id, kind: 'event', created_by: user.id,
        body: `Project chat proposed ${changes.filter((c) => !c.error).length} change(s)`,
      });
    }
    if (!answer && !changes.length) return fail('bad_output', 'Nothing came back. Please try again.', 502);
    return NextResponse.json({ ok: true, answer, changes });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
