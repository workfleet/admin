import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { updatedName } from '../../../../lib/officeEdit';
import { applyFileEdit } from '../../../../lib/projectChatServer';
import { requireOffice, fail } from '../../../../lib/aiServer';

// Saves an edited copy of a project's Excel or Word file, when the office
// applies a change the project chat proposed. The original is never
// touched. Office only, and only on projects whose AI switch is on.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const user = await requireOffice(request);
  if (!user) return fail('unauthorized', 'Please sign in again.', 401);

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'Bad request.'); }
  const { project_id: projectId, change } = body || {};
  if (!projectId || !change || !['edit_spreadsheet', 'edit_word'].includes(change.type) || !change.file_id) return fail('bad_request', 'Bad request.');

  const { data: project } = await supabaseAdmin.from('projects').select('id, ai_enabled').eq('id', projectId).maybeSingle();
  if (!project) return fail('not_found', 'That project no longer exists.', 404);
  if (!project.ai_enabled) return fail('ai_off', 'AI tools are switched off for this project.', 403);

  const dateLabel = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const result = await applyFileEdit({ projectId, change, userId: user.id, dateLabel, updatedName });
  if (result.error) return fail('failed', result.error, 422);
  return NextResponse.json(result);
}
