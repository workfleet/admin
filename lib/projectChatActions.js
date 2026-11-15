// Applies the changes the office ticked in the project chat. Tasks, key
// dates and notes are saved from the browser as the person applying them;
// an edited Excel or Word file goes to /api/projects/apply-file, which
// saves it as a new copy. Each applied change is noted in the project's
// history.
import { supabase } from './supabaseClient';

async function logEvent(projectId, userId, body) {
  await supabase.from('project_notes').insert({ project_id: projectId, kind: 'event', created_by: userId, body });
}

// Returns { ok, message }.
export async function applyProjectChange(projectId, c, userId) {
  const one = (r, ok, bad) => (r.error || (Array.isArray(r.data) && !r.data.length) ? { ok: false, message: bad } : { ok: true, message: ok });

  switch (c.type) {
    case 'add_note': {
      const r = await supabase.from('project_notes').insert({ project_id: projectId, kind: 'note', body: c.body, created_by: userId }).select('id');
      return one(r, 'Saved to the notes.', 'The note couldn\'t be saved.');
    }
    case 'add_task': {
      const { data: last } = await supabase.from('project_tasks').select('position').eq('project_id', projectId).order('position', { ascending: false }).limit(1);
      const r = await supabase.from('project_tasks').insert({
        project_id: projectId, title: c.title, due_date: c.due_date || null, notes: c.notes || null,
        position: (last?.[0]?.position ?? -1) + 1, created_by: userId,
      }).select('id');
      const out = one(r, 'Task added.', 'The task couldn\'t be added.');
      if (out.ok) logEvent(projectId, userId, `Project chat added task: ${c.title}`);
      return out;
    }
    case 'update_task': {
      const patch = {};
      if (c.title) patch.title = c.title;
      if (c.due_date !== undefined) patch.due_date = c.due_date;
      if (c.notes) patch.notes = c.notes;
      if (c.status) { patch.status = c.status; patch.completed_at = c.status === 'done' ? new Date().toISOString() : null; }
      const r = await supabase.from('project_tasks').update(patch).eq('id', c.task_id).eq('project_id', projectId).select('id');
      const out = one(r, 'Task updated.', 'The task couldn\'t be updated - it may have been deleted.');
      if (out.ok) logEvent(projectId, userId, `Project chat ${c.status === 'done' ? 'ticked off' : 'changed'} task: ${c.title || c.from?.title}`);
      return out;
    }
    case 'delete_task': {
      const r = await supabase.from('project_tasks').delete().eq('id', c.task_id).eq('project_id', projectId).select('id');
      const out = one(r, 'Task deleted.', 'The task couldn\'t be deleted.');
      if (out.ok) logEvent(projectId, userId, `Project chat deleted task: ${c.from?.title}`);
      return out;
    }
    case 'add_date': {
      const r = await supabase.from('project_dates').insert({ project_id: projectId, label: c.label, date: c.date }).select('id');
      const out = one(r, 'Key date added.', 'The key date couldn\'t be added.');
      if (out.ok) logEvent(projectId, userId, `Project chat added key date: ${c.label} (${c.date})`);
      return out;
    }
    case 'update_date': {
      const patch = {};
      if (c.label) patch.label = c.label;
      if (c.date) patch.date = c.date;
      if (typeof c.done === 'boolean') patch.done = c.done;
      const r = await supabase.from('project_dates').update(patch).eq('id', c.date_id).eq('project_id', projectId).select('id');
      const out = one(r, 'Key date updated.', 'The key date couldn\'t be updated.');
      if (out.ok) logEvent(projectId, userId, `Project chat changed key date: ${c.label || c.from?.label}`);
      return out;
    }
    case 'delete_date': {
      const r = await supabase.from('project_dates').delete().eq('id', c.date_id).eq('project_id', projectId).select('id');
      const out = one(r, 'Key date removed.', 'The key date couldn\'t be removed.');
      if (out.ok) logEvent(projectId, userId, `Project chat removed key date: ${c.from?.label}`);
      return out;
    }
    case 'edit_spreadsheet':
    case 'edit_word': {
      const { data: { session } } = await supabase.auth.getSession();
      let res;
      try {
        res = await fetch('/api/projects/apply-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ project_id: projectId, change: { type: c.type, file_id: c.file_id, edits: c.edits, replacements: c.replacements } }),
        });
      } catch {
        return { ok: false, message: 'Couldn\'t reach the server.' };
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return { ok: false, message: data?.message || 'The new copy couldn\'t be saved.' };
      return { ok: true, message: `Saved as ${data.file.file_name}.` };
    }
    default:
      return { ok: false, message: 'That change isn\'t supported.' };
  }
}

// Notes first (so the fact is recorded even if something else fails),
// then tasks and dates, then files.
const ORDER = { add_note: 0, add_task: 1, update_task: 1, delete_task: 1, add_date: 1, update_date: 1, delete_date: 1, edit_spreadsheet: 2, edit_word: 2 };
export function applyOrder(changes) {
  return changes.map((c, i) => ({ c, i })).sort((a, b) => (ORDER[a.c.type] ?? 3) - (ORDER[b.c.type] ?? 3) || a.i - b.i).map((x) => x.i);
}
