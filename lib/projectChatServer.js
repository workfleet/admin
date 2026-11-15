// Server side of the project chat: the project as it stands, reading its
// files, and checking each proposed change before it is shown. Read-only -
// changes are made when the office applies them (lib/projectChatActions.js
// and /api/projects/apply-file).
import { supabaseAdmin } from './supabaseAdmin';
import { loadProjectFile } from './aiServer';
import { readableKind } from './projectAi';
import { xlsxCellsText, editXlsx, editDocx } from './officeEdit';
import { describeProjectChange } from './projectChat';

const BUCKET = 'project-files';
const MAX_READ_CHARS = 120000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function loadProjectBundle(projectId) {
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, kind, status, description, due_date, client_id, ai_enabled, clients(name)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return null;
  const [{ data: tasks }, { data: dates }, { data: notes }, { data: files }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('project_tasks').select('id, title, status, due_date, notes, assigned_to, position').eq('project_id', projectId).order('position'),
    supabaseAdmin.from('project_dates').select('id, label, date, done').eq('project_id', projectId).order('date'),
    supabaseAdmin.from('project_notes').select('body, created_at').eq('project_id', projectId).eq('kind', 'note').order('created_at', { ascending: false }).limit(30),
    supabaseAdmin.from('project_files').select('id, file_name, storage_path, file_size').eq('project_id', projectId).order('created_at'),
    supabaseAdmin.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']),
  ]);
  const names = new Map((staff || []).map((s) => [s.id, s.full_name]));
  return { project, tasks: tasks || [], dates: dates || [], notes: notes || [], files: files || [], nameOf: (id) => names.get(id) || null };
}

async function downloadProjectFile(file) {
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(file.storage_path);
  if (error || !blob) return null;
  return Buffer.from(await blob.arrayBuffer());
}

// The read_file tool: spreadsheets with cell addresses, everything else
// as the AI tools already read it (text, or the PDF/image itself).
export async function readProjectFile(bundle, fileId) {
  const file = bundle.files.find((f) => f.id === fileId);
  if (!file) return { error: 'That file is not on this project.' };
  const kind = readableKind(file.file_name);
  if (kind === 'excel') {
    const buffer = await downloadProjectFile(file);
    if (!buffer) return { error: `Couldn't open ${file.file_name}.` };
    try {
      const text = await xlsxCellsText(buffer);
      return { text: `File: ${file.file_name}\n\n${text.slice(0, MAX_READ_CHARS)}` };
    } catch {
      return { error: `${file.file_name} couldn't be opened - it may be damaged or password-protected.` };
    }
  }
  const loaded = await loadProjectFile(bundle.project.id, file.id);
  if (loaded.error) return { error: loaded.error };
  if (loaded.block.type === 'document' && loaded.block.source.type === 'text') {
    return { text: `File: ${file.file_name}\n\n${loaded.block.source.data.slice(0, MAX_READ_CHARS)}` };
  }
  return { blocks: [{ type: 'text', text: `File: ${file.file_name}` }, loaded.block] };
}

const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : null);

// One proposed change -> a checked item for the card, or { error }.
export async function checkProjectChange(c, bundle) {
  const base = { type: c?.type };
  const fail = (error) => ({ ...base, error, headline: 'This change can\'t be made', details: [] });
  const done = (item) => ({ ...item, ...describeProjectChange(item) });
  const task = c?.task_id ? bundle.tasks.find((t) => t.id === c.task_id) : null;
  const date = c?.date_id ? bundle.dates.find((d) => d.id === c.date_id) : null;

  switch (c?.type) {
    case 'add_task': {
      const title = clean(c.title, 200);
      if (!title) return fail('A task needs a title.');
      if (c.due_date && !ISO.test(c.due_date)) return fail('The due date wasn\'t clear.');
      return done({ ...base, title, due_date: c.due_date || null, notes: clean(c.notes, 1000) });
    }
    case 'update_task': {
      if (!task) return fail('That task isn\'t on this project.');
      if (c.due_date && !ISO.test(c.due_date)) return fail('The due date wasn\'t clear.');
      const item = { ...base, task_id: task.id, from: { title: task.title, due_date: task.due_date, status: task.status, notes: task.notes } };
      if (clean(c.title, 200)) item.title = clean(c.title, 200);
      if (c.due_date !== undefined && c.due_date !== null) item.due_date = c.due_date;
      if (['to_do', 'in_progress', 'done'].includes(c.status)) item.status = c.status;
      if (clean(c.notes, 1000)) item.notes = clean(c.notes, 1000);
      const out = done(item);
      if (!out.details.length) return fail(`Nothing would change on "${task.title}".`);
      return out;
    }
    case 'delete_task':
      if (!task) return fail('That task isn\'t on this project.');
      return done({ ...base, task_id: task.id, from: { title: task.title } });
    case 'add_date': {
      const label = clean(c.label, 200);
      if (!label || !ISO.test(c.date || '')) return fail('A key date needs a name and a date.');
      return done({ ...base, label, date: c.date });
    }
    case 'update_date': {
      if (!date) return fail('That key date isn\'t on this project.');
      if (c.date && !ISO.test(c.date)) return fail('The date wasn\'t clear.');
      const item = { ...base, date_id: date.id, from: { label: date.label, date: date.date, done: date.done } };
      if (clean(c.label, 200)) item.label = clean(c.label, 200);
      if (c.date) item.date = c.date;
      if (typeof c.done === 'boolean') item.done = c.done;
      const out = done(item);
      if (!out.details.length) return fail(`Nothing would change on "${date.label}".`);
      return out;
    }
    case 'delete_date':
      if (!date) return fail('That key date isn\'t on this project.');
      return done({ ...base, date_id: date.id, from: { label: date.label } });
    case 'add_note': {
      const body = clean(c.body, 2000);
      if (!body) return fail('The note was empty.');
      return done({ ...base, body });
    }
    case 'edit_spreadsheet':
    case 'edit_word': {
      const file = bundle.files.find((f) => f.id === c.file_id);
      if (!file) return fail('That file isn\'t on this project.');
      const kind = readableKind(file.file_name);
      if (c.type === 'edit_spreadsheet' && kind !== 'excel') return fail(`${file.file_name} isn't an Excel (.xlsx) file.`);
      if (c.type === 'edit_word' && kind !== 'word') return fail(`${file.file_name} isn't a Word (.docx) file.`);
      const buffer = await downloadProjectFile(file);
      if (!buffer) return fail(`Couldn't open ${file.file_name}.`);
      const item = { ...base, file_id: file.id, fileName: file.file_name, summary: clean(c.summary, 300) };
      try {
        if (c.type === 'edit_spreadsheet') {
          const { changes, errors } = await editXlsx(buffer, c.edits);
          if (!changes.length) return fail(errors[0] || 'Those cells already have those values.');
          return { ...done({ ...item, edits: (c.edits || []).slice(0, 100), changes }), warnings: errors };
        }
        const { counts } = await editDocx(buffer, c.replacements);
        const found = counts.filter((x) => x.count > 0);
        const missing = counts.filter((x) => x.count === 0).map((x) => `"${x.find}" wasn't found exactly - it may be split by formatting, so change it by hand.`);
        if (!found.length) return fail(missing[0] || 'None of that text was found.');
        return { ...done({ ...item, replacements: found.map(({ find, replace }) => ({ find, replace })), counts: found }), warnings: missing };
      } catch {
        return fail(`${file.file_name} couldn't be opened - it may be damaged or password-protected.`);
      }
    }
    default:
      return fail('That kind of change isn\'t supported.');
  }
}

// Makes the new copy of an edited file and adds it to the project. Called
// only when the office applies the change (/api/projects/apply-file).
export async function applyFileEdit({ projectId, change, userId, dateLabel, updatedName }) {
  const { data: file } = await supabaseAdmin
    .from('project_files').select('id, file_name, storage_path').eq('id', change.file_id).eq('project_id', projectId).maybeSingle();
  if (!file) return { error: 'That file is no longer on this project.' };
  const buffer = await downloadProjectFile(file);
  if (!buffer) return { error: `Couldn't open ${file.file_name}.` };
  let out;
  try {
    out = change.type === 'edit_spreadsheet'
      ? await editXlsx(buffer, change.edits, { save: true })
      : await editDocx(buffer, change.replacements, { save: true });
  } catch {
    return { error: `${file.file_name} couldn't be changed.` };
  }
  const newName = updatedName(file.file_name, dateLabel);
  const storagePath = `${projectId}/${Date.now()}-${newName.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const contentType = change.type === 'edit_spreadsheet'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, out.buffer, { contentType });
  if (upErr) return { error: 'The new copy couldn\'t be saved.' };
  const { data: row, error } = await supabaseAdmin.from('project_files')
    .insert({ project_id: projectId, file_name: newName, storage_path: storagePath, file_size: out.buffer.length, uploaded_by: userId })
    .select('id, file_name, storage_path, file_size, uploaded_by, created_at').single();
  if (error || !row) {
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    return { error: 'The new copy couldn\'t be saved.' };
  }
  const n = change.type === 'edit_spreadsheet' ? (out.changes || []).length : (out.counts || []).reduce((s, x) => s + x.count, 0);
  await supabaseAdmin.from('project_notes').insert({
    project_id: projectId, kind: 'event', created_by: userId,
    body: `Project chat saved ${newName} (${n} change${n === 1 ? '' : 's'} from ${file.file_name})`,
  });
  return { ok: true, file: row };
}
