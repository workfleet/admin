'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FileText, Download, Trash2, Check } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { localDateString } from '../../../../lib/localDate';
import {
  PROJECT_KINDS,
  PROJECT_STATUSES,
  TASK_STATUSES,
  TENDER_OUTCOMES,
  kindLabel,
  statusLabel,
  templateFor,
  taskProgress,
  isPastDue,
  describeDaysUntil,
  isOpenStatus,
  isMissingTable,
  safeFileName,
} from '../../../../lib/projects';
import { useDocumentTitle } from '../../../components/useDocumentTitle';
import { PageSkeleton } from '../../../components/Skeleton';
import MoreMenu from '../../../components/MoreMenu';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';
import BackButton from '../../../components/BackButton';
import ProjectAiTools from '../../../components/ProjectAiTools';
import ProjectPackage from '../../../components/ProjectPackage';
import ProjectChat from '../../../components/ProjectChat';

const BUCKET = 'project-files';
const PROJECT_SELECT = 'id, name, kind, status, outcome, description, client_id, property_id, owner_id, start_date, due_date, created_at, completed_at, clients(name), properties(address)';
const TASK_SELECT = 'id, project_id, title, notes, assigned_to, due_date, status, position, completed_at, created_at';

function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(`${dateString}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Unfinished first, then by due date (undated last), then template order.
function sortTasks(list) {
  return [...list].sort((a, b) => {
    const doneA = a.status === 'done' ? 1 : 0;
    const doneB = b.status === 'done' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

export default function ProjectPage() {
  const { id } = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [ownId, setOwnId] = useState(null);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [dates, setDates] = useState([]);
  const [notes, setNotes] = useState([]);
  const [files, setFiles] = useState([]);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [newTask, setNewTask] = useState({ title: '', assigned_to: '', due_date: '' });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [showDoneTasks, setShowDoneTasks] = useState(true);

  const [newDate, setNewDate] = useState({ label: '', date: '' });
  const [noteBody, setNoteBody] = useState('');
  const [uploading, setUploading] = useState(false);
  // null = the AI switch column isn't there yet (0138 not run).
  const [aiEnabled, setAiEnabled] = useState(null);
  const [packaging, setPackaging] = useState(false);

  const today = localDateString(new Date());
  useDocumentTitle(project?.name || 'Project');

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setOwnId(session.user.id);

    const { data: projectData, error } = await supabase.from('projects').select(PROJECT_SELECT).eq('id', id).maybeSingle();
    if (isMissingTable(error)) { setNotSetUp(true); setLoading(false); return; }
    if (error || !projectData) {
      toast.error(error ? "Couldn't load the project." : 'That project no longer exists.');
      router.push('/admin/projects');
      return;
    }

    const [aiRes, tasksRes, datesRes, notesRes, filesRes, staffRes, clientsRes, propertiesRes] = await Promise.all([
      // Asked for on its own so the page still loads before 0138 is run:
      // then the AI card just doesn't show.
      supabase.from('projects').select('ai_enabled').eq('id', id).maybeSingle(),
      supabase.from('project_tasks').select(TASK_SELECT).eq('project_id', id).order('position'),
      supabase.from('project_dates').select('id, label, date, done').eq('project_id', id).order('date'),
      supabase.from('project_notes').select('id, kind, body, created_by, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(200),
      supabase.from('project_files').select('id, file_name, storage_path, file_size, uploaded_by, created_at').eq('project_id', id).order('created_at', { ascending: false }),
      // Everyone office-side, active or not, so old notes still show a name.
      supabase.from('profiles').select('id, full_name, active').in('role', ['admin', 'supervisor']).order('full_name'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('properties').select('id, client_id, address').order('address'),
    ]);

    setProject(projectData);
    setAiEnabled(aiRes.error ? null : Boolean(aiRes.data?.ai_enabled));
    setTasks(tasksRes.data || []);
    setDates(datesRes.data || []);
    setNotes(notesRes.data || []);
    setFiles(filesRes.data || []);
    setStaff(staffRes.data || []);
    setClients(clientsRes.data || []);
    setProperties(propertiesRes.data || []);
    setLoading(false);
  };

  const nameOf = useMemo(() => {
    const map = new Map(staff.map((s) => [s.id, s.full_name]));
    return (uid) => map.get(uid) || null;
  }, [staff]);
  const activeStaff = staff.filter((s) => s.active !== false);

  const logEvent = async (body) => {
    const { data } = await supabase
      .from('project_notes')
      .insert({ project_id: id, kind: 'event', body, created_by: ownId })
      .select('id, kind, body, created_by, created_at')
      .single();
    if (data) setNotes((prev) => [data, ...prev]);
  };

  // --- Project details -------------------------------------------------

  const startEdit = () => {
    setEditForm({
      name: project.name,
      kind: project.kind,
      description: project.description || '',
      client_id: project.client_id || '',
      property_id: project.property_id || '',
      owner_id: project.owner_id || '',
      due_date: project.due_date || '',
    });
    setEditing(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('projects')
      .update({
        name: editForm.name.trim(),
        kind: editForm.kind,
        description: editForm.description.trim() || null,
        client_id: editForm.client_id || null,
        property_id: editForm.property_id || null,
        owner_id: editForm.owner_id || null,
        due_date: editForm.due_date || null,
      })
      .eq('id', id)
      .select(PROJECT_SELECT)
      .single();
    setSaving(false);
    if (error || !data) { toast.error("Couldn't save the changes."); return; }
    setProject(data);
    setEditing(false);
    toast.success('Saved.');
  };

  const changeStatus = async (status) => {
    const completed_at = isOpenStatus(status) ? null : (project.completed_at || new Date().toISOString());
    const { data, error } = await supabase
      .from('projects').update({ status, completed_at }).eq('id', id).select(PROJECT_SELECT).single();
    if (error || !data) { toast.error("Couldn't change the status."); return; }
    setProject(data);
    logEvent(`Status changed to ${statusLabel(status)}`);
  };

  const changeOutcome = async (outcome) => {
    const { data, error } = await supabase
      .from('projects').update({ outcome: outcome || null }).eq('id', id).select(PROJECT_SELECT).single();
    if (error || !data) { toast.error("Couldn't save the outcome."); return; }
    setProject(data);
    if (outcome) logEvent(`Outcome: ${TENDER_OUTCOMES.find((o) => o.value === outcome)?.label || outcome}`);
  };

  const deleteProject = async () => {
    const ok = await confirm(`Delete "${project.name}" with all its tasks, dates, notes and files? This can't be undone.`, { danger: true });
    if (!ok) return;
    if (files.length) await supabase.storage.from(BUCKET).remove(files.map((f) => f.storage_path));
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) { toast.error("Couldn't delete the project."); return; }
    toast.success('Project deleted.');
    router.push('/admin/projects');
  };

  // --- Tasks -----------------------------------------------------------

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    const position = tasks.reduce((max, t) => Math.max(max, t.position ?? 0), -1) + 1;
    const { data, error } = await supabase
      .from('project_tasks')
      .insert({
        project_id: id,
        title: newTask.title.trim(),
        assigned_to: newTask.assigned_to || null,
        due_date: newTask.due_date || null,
        position,
        created_by: ownId,
      })
      .select(TASK_SELECT)
      .single();
    if (error || !data) { toast.error("Couldn't add the task."); return; }
    setTasks((prev) => [...prev, data]);
    setNewTask({ title: '', assigned_to: newTask.assigned_to, due_date: '' });
  };

  const updateTask = async (task, changes) => {
    const { data, error } = await supabase
      .from('project_tasks').update(changes).eq('id', task.id).select(TASK_SELECT).single();
    if (error || !data) { toast.error("Couldn't update the task."); return null; }
    setTasks((prev) => prev.map((t) => (t.id === task.id ? data : t)));
    return data;
  };

  const setTaskStatus = async (task, status) => {
    const updated = await updateTask(task, { status, completed_at: status === 'done' ? new Date().toISOString() : null });
    if (updated && status === 'done' && task.status !== 'done') logEvent(`Task done: ${task.title}`);
  };

  const startTaskEdit = (task) => {
    setEditingTaskId(task.id);
    setTaskDraft({ title: task.title, notes: task.notes || '', assigned_to: task.assigned_to || '', due_date: task.due_date || '' });
  };

  const saveTaskEdit = async (task) => {
    if (!taskDraft.title.trim()) return;
    const updated = await updateTask(task, {
      title: taskDraft.title.trim(),
      notes: taskDraft.notes.trim() || null,
      assigned_to: taskDraft.assigned_to || null,
      due_date: taskDraft.due_date || null,
    });
    if (updated) { setEditingTaskId(null); setTaskDraft(null); }
  };

  const deleteTask = async (task) => {
    if (!(await confirm(`Delete the task "${task.title}"?`, { danger: true }))) return;
    const { error } = await supabase.from('project_tasks').delete().eq('id', task.id);
    if (error) { toast.error("Couldn't delete the task."); return; }
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  };

  // --- Key dates -------------------------------------------------------

  const addDate = async (e) => {
    e.preventDefault();
    if (!newDate.label.trim() || !newDate.date) return;
    const { data, error } = await supabase
      .from('project_dates')
      .insert({ project_id: id, label: newDate.label.trim(), date: newDate.date })
      .select('id, label, date, done')
      .single();
    if (error || !data) { toast.error("Couldn't add the date."); return; }
    setDates((prev) => [...prev, data].sort((a, b) => (a.date < b.date ? -1 : 1)));
    setNewDate({ label: '', date: '' });
  };

  const toggleDate = async (d) => {
    const { data, error } = await supabase
      .from('project_dates').update({ done: !d.done }).eq('id', d.id).select('id, label, date, done').single();
    if (error || !data) { toast.error("Couldn't update the date."); return; }
    setDates((prev) => prev.map((x) => (x.id === d.id ? data : x)));
  };

  const deleteDate = async (d) => {
    if (!(await confirm(`Remove the key date "${d.label}"?`, { danger: true }))) return;
    const { error } = await supabase.from('project_dates').delete().eq('id', d.id);
    if (error) { toast.error("Couldn't remove the date."); return; }
    setDates((prev) => prev.filter((x) => x.id !== d.id));
  };

  // --- Files -----------------------------------------------------------

  const uploadFiles = async (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    if (chosen.length === 0) return;
    setUploading(true);
    let failed = 0;
    for (const file of chosen) {
      const storagePath = `${id}/${Date.now()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file);
      if (uploadError) { failed += 1; continue; }
      const { data, error } = await supabase
        .from('project_files')
        .insert({ project_id: id, file_name: file.name, storage_path: storagePath, file_size: file.size, uploaded_by: ownId })
        .select('id, file_name, storage_path, file_size, uploaded_by, created_at')
        .single();
      if (error || !data) {
        // Don't leave an orphan in the bucket that nothing points at.
        await supabase.storage.from(BUCKET).remove([storagePath]);
        failed += 1;
        continue;
      }
      setFiles((prev) => [data, ...prev]);
      logEvent(`File added: ${file.name}`);
    }
    setUploading(false);
    if (failed) toast.error(`${failed} file${failed === 1 ? '' : 's'} didn't upload. Please try again.`);
    else toast.success(chosen.length === 1 ? 'File uploaded.' : `${chosen.length} files uploaded.`);
  };

  const openFile = async (f) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Couldn't open the file."); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const deleteFile = async (f) => {
    if (!(await confirm(`Delete ${f.file_name}?`, { danger: true }))) return;
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([f.storage_path]);
    if (storageError) { toast.error("Couldn't delete the file."); return; }
    const { error } = await supabase.from('project_files').delete().eq('id', f.id);
    if (error) { toast.error("Couldn't delete the file record."); return; }
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  // --- AI tools --------------------------------------------------------

  const toggleAi = async (enabled) => {
    if (enabled && project.kind === 'tender') {
      const ok = await confirm('Switch AI tools on for this tender? Check the tender documents first - some ban AI or require you to declare it. Every use is noted in the history.');
      if (!ok) return;
    }
    const { data, error } = await supabase.from('projects').update({ ai_enabled: enabled }).eq('id', id).select('ai_enabled').single();
    if (error || !data) { toast.error("Couldn't change the AI setting."); return; }
    setAiEnabled(data.ai_enabled);
    logEvent(enabled ? 'AI tools switched on' : 'AI tools switched off');
  };

  const reloadNotes = async () => {
    const { data } = await supabase.from('project_notes').select('id, kind, body, created_by, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(200);
    if (data) setNotes(data);
  };

  const addSuggestions = async ({ tasks: newTasks, dates: newDates }) => {
    let position = tasks.reduce((max, t) => Math.max(max, t.position ?? 0), -1) + 1;
    const taskRows = newTasks.map((t) => ({
      project_id: id,
      title: t.title,
      due_date: t.due_date || null,
      notes: [t.notes, t.source && `From: ${t.source}`].filter(Boolean).join('\n') || null,
      position: position++,
      created_by: ownId,
    }));
    const dateRows = newDates.map((d) => ({ project_id: id, label: d.label, date: d.date }));
    const [tRes, dRes] = await Promise.all([
      taskRows.length ? supabase.from('project_tasks').insert(taskRows).select(TASK_SELECT) : Promise.resolve({ data: [] }),
      dateRows.length ? supabase.from('project_dates').insert(dateRows).select('id, label, date, done') : Promise.resolve({ data: [] }),
    ]);
    if (tRes.error || dRes.error) { toast.error("Some of them didn't save. Please try again."); return false; }
    setTasks((prev) => [...prev, ...(tRes.data || [])]);
    setDates((prev) => [...prev, ...(dRes.data || [])].sort((a, b) => (a.date < b.date ? -1 : 1)));
    const parts = [taskRows.length && `${taskRows.length} task${taskRows.length === 1 ? '' : 's'}`, dateRows.length && `${dateRows.length} date${dateRows.length === 1 ? '' : 's'}`].filter(Boolean);
    logEvent(`Added ${parts.join(' and ')} suggested by AI`);
    toast.success(`Added ${parts.join(' and ')}.`);
    return true;
  };

  const saveNoteText = async (text) => {
    const { data, error } = await supabase
      .from('project_notes')
      .insert({ project_id: id, kind: 'note', body: text, created_by: ownId })
      .select('id, kind, body, created_by, created_at')
      .single();
    if (error || !data) { toast.error("Couldn't save the note."); return false; }
    setNotes((prev) => [data, ...prev]);
    toast.success('Saved to the notes.');
    return true;
  };

  // --- Notes -----------------------------------------------------------

  const addNote = async (e) => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    const { data, error } = await supabase
      .from('project_notes')
      .insert({ project_id: id, kind: 'note', body: noteBody.trim(), created_by: ownId })
      .select('id, kind, body, created_by, created_at')
      .single();
    if (error || !data) { toast.error("Couldn't save the note."); return; }
    setNotes((prev) => [data, ...prev]);
    setNoteBody('');
  };

  const deleteNote = async (n) => {
    if (!(await confirm('Delete this note?', { danger: true }))) return;
    const { error } = await supabase.from('project_notes').delete().eq('id', n.id);
    if (error) { toast.error("Couldn't delete the note."); return; }
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
  };

  if (loading) return <PageSkeleton variant="detail" />;

  if (notSetUp) {
    return (
      <div className="page-inner">
        <BackButton />
        <div className="card"><p style={{ margin: 0 }}>Projects isn't switched on yet. Run <code>0137_projects.sql</code> in Supabase, then reload.</p></div>
      </div>
    );
  }

  const progress = taskProgress(tasks);
  const sortedTasks = sortTasks(tasks).filter((t) => showDoneTasks || t.status !== 'done');
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const template = templateFor(project.kind);
  const siteOptions = editForm ? properties.filter((p) => p.client_id === editForm.client_id) : [];
  const projectOpen = isOpenStatus(project.status);

  return (
    <div className="page-inner">
      <BackButton />

      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: 8 }}>
          <div>
            <span className="pj-kind">{kindLabel(project.kind)}</span>
            <h1 style={{ margin: '6px 0 0' }}>{project.name}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => (editing ? setEditing(false) : startEdit())}>{editing ? 'Cancel' : 'Edit'}</button>
            <MoreMenu items={[{ label: 'Delete project', onClick: deleteProject, danger: true, title: 'Delete this project and everything in it' }]} />
          </div>
        </div>

        {editing ? (
          <form onSubmit={saveEdit}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} required autoFocus />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Type</label>
                  <select value={editForm.kind} onChange={(e) => setEditForm((f) => ({ ...f, kind: e.target.value }))}>
                    {PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">{templateFor(editForm.kind).targetLabel}</label>
                  <input type="date" value={editForm.due_date} onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Client</label>
                  <select value={editForm.client_id} onChange={(e) => setEditForm((f) => ({ ...f, client_id: e.target.value, property_id: '' }))}>
                    <option value="">Not linked to a client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Site</label>
                  <select value={editForm.property_id} onChange={(e) => setEditForm((f) => ({ ...f, property_id: e.target.value }))} disabled={!editForm.client_id || siteOptions.length === 0}>
                    <option value="">{editForm.client_id ? 'Any / not one site' : 'Pick a client first'}</option>
                    {siteOptions.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="field-label">Owner</label>
                <select value={editForm.owner_id} onChange={(e) => setEditForm((f) => ({ ...f, owner_id: e.target.value }))}>
                  <option value="">No owner</option>
                  {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name || 'Unnamed'}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">What is it for?</label>
                <textarea rows={3} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        ) : (
          <>
            {project.description && <p className="pj-description">{project.description}</p>}
            <dl className="pj-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <select value={project.status} onChange={(e) => changeStatus(e.target.value)} style={{ width: 'auto', margin: 0 }} aria-label="Project status">
                    {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </dd>
              </div>
              {project.kind === 'tender' && (
                <div>
                  <dt>Outcome</dt>
                  <dd>
                    <select value={project.outcome || ''} onChange={(e) => changeOutcome(e.target.value)} style={{ width: 'auto', margin: 0 }} aria-label="Tender outcome">
                      <option value="">Not decided</option>
                      {TENDER_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </dd>
                </div>
              )}
              <div>
                <dt>Client</dt>
                <dd>
                  {project.client_id && project.clients
                    ? <Link href={`/admin/clients/${project.client_id}`}>{project.clients.name}</Link>
                    : 'Not linked'}
                  {project.properties?.address && <span className="pj-muted"> · {project.properties.address}</span>}
                </dd>
              </div>
              <div><dt>Owner</dt><dd>{nameOf(project.owner_id) || 'No owner'}</dd></div>
              <div>
                <dt>{template.targetLabel}</dt>
                <dd>
                  {project.due_date ? formatDate(project.due_date) : 'Not set'}
                  {project.due_date && projectOpen && <span className={isPastDue(project.due_date, today) ? 'pj-late-inline' : 'pj-muted'}> ({describeDaysUntil(project.due_date, today)})</span>}
                </dd>
              </div>
              <div>
                <dt>Tasks</dt>
                <dd>{progress.total ? `${progress.done} of ${progress.total} done` : 'None yet'}</dd>
              </div>
            </dl>
            {progress.total > 0 && (
              <div className="pj-progress" style={{ marginTop: 12 }}>
                <div className="pj-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
                <span className="pj-progress-count">{progress.percent}%</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="pj-columns">
        <div className="pj-main">
          {aiEnabled !== null && (
            <ProjectChat
              projectId={project.id}
              aiEnabled={aiEnabled}
              userId={ownId}
              onApplied={load}
              onToggleAi={toggleAi}
            />
          )}

          {/* Tasks */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="pj-section-head">
              <h2>Tasks</h2>
              {doneCount > 0 && (
                <button type="button" className="pj-text-btn" onClick={() => setShowDoneTasks((s) => !s)}>
                  {showDoneTasks ? `Hide done (${doneCount})` : `Show done (${doneCount})`}
                </button>
              )}
            </div>

            <form className="pj-add-row" onSubmit={addTask}>
              <input value={newTask.title} onChange={(e) => setNewTask((t) => ({ ...t, title: e.target.value }))} placeholder="Add a task..." aria-label="New task" />
              <select value={newTask.assigned_to} onChange={(e) => setNewTask((t) => ({ ...t, assigned_to: e.target.value }))} aria-label="Assign to">
                <option value="">Anyone</option>
                {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name || 'Unnamed'}</option>)}
              </select>
              <input type="date" value={newTask.due_date} onChange={(e) => setNewTask((t) => ({ ...t, due_date: e.target.value }))} aria-label="Due date" />
              <button type="submit" className="btn-primary" disabled={!newTask.title.trim()}>Add</button>
            </form>

            {sortedTasks.length === 0 && (
              <p className="pj-muted" style={{ margin: '12px 0 0' }}>{tasks.length ? 'All done.' : 'No tasks yet. Add the first one above.'}</p>
            )}

            <ul className="pj-task-list">
              {sortedTasks.map((task) => {
                const late = task.status !== 'done' && isPastDue(task.due_date, today);
                if (editingTaskId === task.id) {
                  return (
                    <li key={task.id} className="pj-task is-editing">
                      <div className="job-form-body" style={{ padding: 0 }}>
                        <div className="field">
                          <label className="field-label">Task</label>
                          <input value={taskDraft.title} onChange={(e) => setTaskDraft((d) => ({ ...d, title: e.target.value }))} autoFocus />
                        </div>
                        <div className="field-row">
                          <div className="field">
                            <label className="field-label">Assigned to</label>
                            <select value={taskDraft.assigned_to} onChange={(e) => setTaskDraft((d) => ({ ...d, assigned_to: e.target.value }))}>
                              <option value="">Anyone</option>
                              {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name || 'Unnamed'}</option>)}
                            </select>
                          </div>
                          <div className="field">
                            <label className="field-label">Due</label>
                            <input type="date" value={taskDraft.due_date} onChange={(e) => setTaskDraft((d) => ({ ...d, due_date: e.target.value }))} />
                          </div>
                        </div>
                        <div className="field">
                          <label className="field-label">Notes</label>
                          <textarea rows={2} value={taskDraft.notes} onChange={(e) => setTaskDraft((d) => ({ ...d, notes: e.target.value }))} />
                        </div>
                      </div>
                      <div className="pj-task-edit-actions">
                        <button type="button" className="btn-secondary" onClick={() => deleteTask(task)}>Delete</button>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn-secondary" onClick={() => { setEditingTaskId(null); setTaskDraft(null); }}>Cancel</button>
                        <button type="button" className="btn-primary" onClick={() => saveTaskEdit(task)}>Save</button>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={task.id} className={`pj-task${task.status === 'done' ? ' is-done' : ''}`}>
                    <button
                      type="button"
                      className={`pj-tick${task.status === 'done' ? ' is-on' : ''}`}
                      onClick={() => setTaskStatus(task, task.status === 'done' ? 'to_do' : 'done')}
                      aria-label={task.status === 'done' ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
                    >
                      {task.status === 'done' && <Check size={14} strokeWidth={3} />}
                    </button>
                    <button type="button" className="pj-task-body" onClick={() => startTaskEdit(task)} title="Edit this task">
                      <span className="pj-task-title">{task.title}</span>
                      <span className="pj-task-meta">
                        {[
                          nameOf(task.assigned_to),
                          task.due_date && (
                            <span key="due" className={late ? 'pj-late-inline' : undefined}>
                              {late ? 'was due ' : 'due '}{formatDate(task.due_date)}
                            </span>
                          ),
                          task.notes ? 'has notes' : null,
                        ].filter(Boolean).map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
                      </span>
                    </button>
                    {task.status !== 'done' && (
                      <select value={task.status} onChange={(e) => setTaskStatus(task, e.target.value)} className="pj-task-status" aria-label="Task status">
                        {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Notes */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Notes and history</h2>
            <form onSubmit={addNote} style={{ marginBottom: 12 }}>
              <textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="A decision, a phone call, something to remember..." aria-label="New note" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="submit" className="btn-primary" disabled={!noteBody.trim()}>Add note</button>
              </div>
            </form>
            {notes.length === 0 && <p className="pj-muted" style={{ margin: 0 }}>Nothing written yet.</p>}
            <ul className="pj-notes">
              {notes.map((n) => (
                <li key={n.id} className={n.kind === 'event' ? 'is-event' : 'is-note'}>
                  <div className="pj-note-meta">
                    {nameOf(n.created_by) || 'Someone'} · {formatWhen(n.created_at)}
                    {n.kind === 'note' && n.created_by === ownId && (
                      <button type="button" className="pj-icon-btn" onClick={() => deleteNote(n)} aria-label="Delete note" title="Delete note"><Trash2 size={13} /></button>
                    )}
                  </div>
                  <div className="pj-note-body">{n.body}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pj-side">
          {aiEnabled !== null && (
            <ProjectAiTools
              project={{ id: project.id, kind: project.kind, ai_enabled: aiEnabled }}
              files={files}
              onToggleAi={toggleAi}
              onAddSuggestions={addSuggestions}
              onSaveNote={saveNoteText}
              onUsed={reloadNotes}
            />
          )}

          {/* Key dates */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Key dates</h2>
            {dates.length === 0 && <p className="pj-muted" style={{ margin: '0 0 10px' }}>No key dates yet.</p>}
            <ul className="pj-dates">
              {dates.map((d) => {
                const late = !d.done && isPastDue(d.date, today);
                return (
                  <li key={d.id} className={d.done ? 'is-done' : ''}>
                    <button type="button" className={`pj-tick${d.done ? ' is-on' : ''}`} onClick={() => toggleDate(d)} aria-label={d.done ? `Mark "${d.label}" not done` : `Mark "${d.label}" done`}>
                      {d.done && <Check size={14} strokeWidth={3} />}
                    </button>
                    <div className="pj-date-body">
                      <span className="pj-task-title">{d.label}</span>
                      <span className={`pj-task-meta${late ? ' pj-late-inline' : ''}`}>
                        {formatDate(d.date)}{!d.done && ` · ${describeDaysUntil(d.date, today)}`}
                      </span>
                    </div>
                    <button type="button" className="pj-icon-btn" onClick={() => deleteDate(d)} aria-label={`Remove ${d.label}`} title="Remove"><Trash2 size={14} /></button>
                  </li>
                );
              })}
            </ul>
            <form onSubmit={addDate} className="pj-date-form">
              <input value={newDate.label} onChange={(e) => setNewDate((d) => ({ ...d, label: e.target.value }))} placeholder="e.g. Site visit" aria-label="Key date name" />
              <input type="date" value={newDate.date} onChange={(e) => setNewDate((d) => ({ ...d, date: e.target.value }))} aria-label="Date" />
              <button type="submit" className="btn-secondary" disabled={!newDate.label.trim() || !newDate.date}>Add date</button>
            </form>
          </div>

          {/* Files */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="pj-section-head">
              <h2>Files</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                {files.length > 0 && !packaging && (
                  <button type="button" className="btn-secondary" onClick={() => setPackaging(true)} title="Download every file as one zip, with a contents sheet">Package</button>
                )}
                <label className={`btn-secondary pj-upload${uploading ? ' is-busy' : ''}`}>
                  {uploading ? 'Uploading...' : 'Upload'}
                  <input type="file" multiple onChange={uploadFiles} disabled={uploading} hidden />
                </label>
              </div>
            </div>
            {packaging && files.length > 0 && (
              <ProjectPackage
                project={project}
                files={files}
                aiEnabled={aiEnabled === true}
                nameOf={nameOf}
                onUsed={reloadNotes}
                onClose={() => setPackaging(false)}
              />
            )}
            {files.length === 0 && <p className="pj-muted" style={{ margin: 0 }}>Drafts, the tender pack, pricing, photos - anything for this project.</p>}
            <ul className="pj-files">
              {files.map((f) => (
                <li key={f.id}>
                  <FileText size={16} className="pj-file-icon" aria-hidden />
                  <button type="button" className="pj-file-name" onClick={() => openFile(f)} title="Open this file">
                    <span>{f.file_name}</span>
                    <span className="pj-task-meta">{[formatSize(f.file_size), nameOf(f.uploaded_by), formatWhen(f.created_at)].filter(Boolean).join(' · ')}</span>
                  </button>
                  <button type="button" className="pj-icon-btn" onClick={() => openFile(f)} aria-label={`Download ${f.file_name}`} title="Download"><Download size={14} /></button>
                  <button type="button" className="pj-icon-btn" onClick={() => deleteFile(f)} aria-label={`Delete ${f.file_name}`} title="Delete"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
