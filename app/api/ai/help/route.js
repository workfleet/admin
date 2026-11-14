import { NextResponse } from 'next/server';
import { AI_MODEL } from '../../../../lib/aiDrafting';
import { OFFICE_GUIDE } from '../../../../lib/helpGuide';
import { helpSystem, cleanHelpMessages, pageNote } from '../../../../lib/helpChat';
import { ROTA_TOOLS, ROTA_RULES } from '../../../../lib/rotaAssistant';
import { runRotaTool, checkChange } from '../../../../lib/rotaAssistantServer';
import { FALLBACK_BETA, requireOffice, fail, anthropicClient, textOf, aiErrorResponse } from '../../../../lib/aiServer';

// "Ask WorkFleet": answers how-to questions from the office guide, and can
// look things up on the rota and propose changes to it. It never changes
// anything: proposed changes come back as cards, and the page makes a
// change only when someone presses Confirm (lib/rotaActions.js), as them.
//
// Office staff only. The guide and the tools are the same on every call,
// so they sit in the cached prefix.

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM = [{ type: 'text', text: `${helpSystem(OFFICE_GUIDE)}\n${ROTA_RULES}`, cache_control: { type: 'ephemeral' } }];
const MAX_STEPS = 8;
const TIME_BUDGET_MS = 48000;

function todayNote() {
  const now = new Date();
  const day = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  return `(Today is ${day}, ${time} UK time.)`;
}

export async function POST(request) {
  const startedAt = Date.now();
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }
  const messages = cleanHelpMessages(body?.messages);
  if (!messages.length) return fail('bad_request', 'Type a question.');

  // When and where they are go on the latest question, not in the cached
  // prompt.
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: 'user', content: [last.content, todayNote(), pageNote(body?.page)].filter(Boolean).join('\n\n') };

  const client = anthropicClient();
  const cards = [];
  let answer = '';

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 6000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: ROTA_TOOLS,
        messages,
      });
      if (message.stop_reason === 'refusal') return fail('refused', 'Sorry, I can\'t help with that one.', 422);

      const text = textOf(message).trim();
      if (text) answer = text;
      const calls = message.content.filter((b) => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || !calls.length) break;

      // Out of time: stop here rather than be cut off by the platform.
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        answer = answer || 'That took longer than expected. Try asking for one change at a time.';
        break;
      }

      messages.push({ role: 'assistant', content: message.content });
      const results = [];
      for (const call of calls) {
        let content;
        try {
          if (call.name === 'propose_changes') {
            const checked = [];
            for (const change of (call.input?.changes || []).slice(0, 10)) checked.push(await checkChange(change));
            cards.push(...checked);
            content = JSON.stringify({
              shown_to_user: checked.map((c) => (c.error ? { error: c.error } : { change: c.headline, warnings: c.warnings })),
              note: 'Shown as cards. Nothing has changed - the person must press Confirm.',
            });
          } else {
            content = JSON.stringify(await runRotaTool(call.name, call.input || {}));
          }
        } catch {
          content = JSON.stringify({ error: 'That lookup failed.' });
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
      messages.push({ role: 'user', content: results });
    }

    if (!answer && !cards.length) return fail('bad_output', 'Nothing came back. Please try again.', 502);
    return NextResponse.json({ ok: true, answer, cards });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
