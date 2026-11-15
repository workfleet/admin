import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { AI_MODEL } from '../../../../lib/aiDrafting';
import { SORT_SYSTEM, SORT_SCHEMA, sortRequestText, cleanSortSuggestions } from '../../../../lib/documentFolders';
import { FALLBACK_BETA, requireOffice, fail, anthropicClient, textOf, aiErrorResponse } from '../../../../lib/aiServer';

// Suggests a folder for each document in the library, from its title and
// file name only (nothing is opened). Suggestions come back to the
// Documents page, where the office ticks which to apply - nothing is moved
// here. Documents already in a contracts folder are never suggested out of
// it, so signed worker contracts stay protected.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail('not_configured', 'AI is not set up on this server.', 503);

  const [{ data: folders, error: folderError }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('document_folders').select('id, name, category, position').order('position'),
    supabaseAdmin.from('company_documents').select('id, title, file_name, folder_id').is('client_id', null).order('title').limit(400),
  ]);
  if (folderError) return fail('not_set_up', 'Folders aren\'t switched on yet - run 0141 in Supabase.', 503);
  if (!folders?.length || !docs?.length) return NextResponse.json({ ok: true, suggestions: [] });

  try {
    const message = await anthropicClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SORT_SCHEMA } },
      system: SORT_SYSTEM,
      messages: [{ role: 'user', content: sortRequestText(folders, docs) }],
    });
    if (message.stop_reason === 'refusal') return fail('refused', 'The AI declined this.', 422);
    let raw;
    try { raw = JSON.parse(textOf(message)); } catch { return fail('bad_output', 'The suggestions couldn\'t be read. Please try again.', 502); }
    return NextResponse.json({ ok: true, suggestions: cleanSortSuggestions(raw, folders, docs) });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
