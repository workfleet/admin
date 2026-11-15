'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderKanban } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { fetchAllRows } from '../../../lib/fetchAllRows';
import { localDateString } from '../../../lib/localDate';
import {
  PROJECT_KINDS,
  kindLabel,
  statusLabel,
  isOpenStatus,
  templateFor,
  buildFromTemplate,
  taskProgress,
  nextDeadline,
  overdueTaskCount,
  describeDaysUntil,
  isMissingTable,
} from '../../../lib/projects';
import EmptyState from '../../components/EmptyState';
import { PageSkeleton } from '../../components/Skeleton';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const PROJECT_SELECT = 'id, name, kind, status, outcome, client_id, property_id, owner_id, due_date, updated_at, clients(name)';

const EMPTY_FORM = { name: '', kind: 'tender', client_id: '', property_id: '', owner_id: '', due_date: '', description: '', useTemplate: true };

export default function AdminProjects() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ownId, setOwnId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dates, setDates] = useState([]);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [staff, setStaff] = useState([]);
  const [filter, setFilter] = useState('open'); // open | closed | all
  const [kindFilter, setKindFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const today = localDateString(new Date());

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setOwnId(session.user.id);
    setLoadFailed(false);

    const [projectsRes, tasksRes, datesRes, clientsRes, propertiesRes, staffRes] = await Promise.all([
      supabase.from('projects').select(PROJECT_SELECT).order('updated_at', { ascending: false }),
      fetchAllRows(() => supabase.from('project_tasks').select('id, project_id, title, status, due_date').order('id')),
      fetchAllRows(() => supabase.from('project_dates').select('id, project_id, label, date, done').order('id')),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('properties').select('id, client_id, address').order('address'),
      supabase.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']).eq('active', true).order('full_name'),
    ]);

    if (isMissingTable(projectsRes.error)) { setNotSetUp(true); setLoading(false); return; }
    if (projectsRes.error || tasksRes.error || datesRes.error) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }

    setProjects(projectsRes.data || []);
    setTasks(tasksRes.data || []);
    setDates(datesRes.data || []);
    setClients(clientsRes.data || []);
    setProperties(propertiesRes.data || []);
    setStaff(staffRes.data || []);
    setLoading(false);
  };

  const staffName = useMemo(() => {
    const map = new Map(staff.map((s) => [s.id, s.full_name]));
    return (id) => map.get(id) || null;
  }, [staff]);

  const byProject = useMemo(() => {
    const map = new Map();
    const bucket = (id) => {
      if (!map.has(id)) map.set(id, { tasks: [], dates: [] });
      return map.get(id);
    };
    tasks.forEach((t) => bucket(t.project_id).tasks.push(t));
    dates.forEach((d) => bucket(d.project_id).dates.push(d));
    return map;
  }, [tasks, dates]);

  const visible = useMemo(() => projects.filter((p) => {
    if (kindFilter && p.kind !== kindFilter) return false;
    if (filter === 'open') return isOpenStatus(p.status);
    if (filter === 'closed') return !isOpenStatus(p.status);
    return true;
  }), [projects, filter, kindFilter]);

  const siteOptions = properties.filter((p) => p.client_id === form.client_id);
  const template = templateFor(form.kind);
  const preview = buildFromTemplate(form.kind, form.due_date);

  const openForm = () => {
    setForm({ ...EMPTY_FORM, owner_id: ownId || '' });
    setShowForm(true);
  };

  const createProject = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        name: form.name.trim(),
        kind: form.kind,
        status: 'active',
        description: form.description.trim() || null,
        client_id: form.client_id || null,
        property_id: form.property_id || null,
        owner_id: form.owner_id || null,
        due_date: form.due_date || null,
        start_date: today,
        created_by: ownId,
      })
      .select('id')
      .single();

    if (error || !project) {
      setCreating(false);
      toast.error("Couldn't create the project. Please try again.");
      return;
    }

    let partial = false;
    if (form.useTemplate) {
      const { tasks: starterTasks, dates: starterDates } = buildFromTemplate(form.kind, form.due_date);
      const [tasksRes, datesRes] = await Promise.all([
        starterTasks.length
          ? supabase.from('project_tasks').insert(starterTasks.map((t) => ({ ...t, project_id: project.id, created_by: ownId })))
          : Promise.resolve({ error: null }),
        starterDates.length
          ? supabase.from('project_dates').insert(starterDates.map((d) => ({ ...d, project_id: project.id })))
          : Promise.resolve({ error: null }),
      ]);
      partial = Boolean(tasksRes.error || datesRes.error);
    }
    // Starter file folders for the type (0142). Ignored if that isn't run yet.
    const starterFolders = templateFor(form.kind).fileFolders || [];
    if (starterFolders.length) await supabase.from('projects').update({ file_folders: starterFolders }).eq('id', project.id);
    await supabase.from('project_notes').insert({ project_id: project.id, kind: 'event', body: 'Project created', created_by: ownId });

    setCreating(false);
    if (partial) toast.error('Project created, but some of the starter tasks didn\'t save - add them on the project page.');
    else toast.success('Project created.');
    router.push(`/admin/projects/${project.id}`);
  };

  if (loading) return <PageSkeleton />;

  if (notSetUp) {
    return (
      <div className="page-inner">
        <BackButton />
        <h1>Projects</h1>
        <div className="card">
          <p style={{ margin: 0 }}>
            Projects isn't switched on yet. Run <code>supabase/migrations/0137_projects.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Projects</h1>
          <p className="page-subtitle">Tenders, new contracts, deep cleans, certifications - anything with a goal and a deadline</p>
        </div>
        <button className="btn-primary" onClick={() => (showForm ? setShowForm(false) : openForm())} title="Start a new project">
          {showForm ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {loadFailed && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 10px' }}>Couldn't load projects - please check your connection.</p>
          <button className="btn-secondary" onClick={load}>Try again</button>
        </div>
      )}

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New project</h2>
            <button className="job-form-close" type="button" onClick={() => setShowForm(false)} aria-label="Close">×</button>
          </div>
          <form onSubmit={createProject}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Swansea Bus Station tender" required autoFocus />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Type</label>
                  <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                    {PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">{template.targetLabel} (optional)</label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Client (optional)</label>
                  <select value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value, property_id: '' }))}>
                    <option value="">Not linked to a client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Site (optional)</label>
                  <select value={form.property_id} onChange={(e) => setForm((f) => ({ ...f, property_id: e.target.value }))} disabled={!form.client_id || siteOptions.length === 0}>
                    <option value="">{form.client_id ? 'Any / not one site' : 'Pick a client first'}</option>
                    {siteOptions.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="field-label">Owner</label>
                <select value={form.owner_id} onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}>
                  <option value="">No owner yet</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || 'Unnamed'}{s.id === ownId ? ' (me)' : ''}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">What is it for? (optional)</label>
                <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="The goal, the client's reference number, anything the team should know" />
              </div>
              {template.tasks.length > 0 && (
                <label className="pj-check">
                  <input type="checkbox" checked={form.useTemplate} onChange={(e) => setForm((f) => ({ ...f, useTemplate: e.target.checked }))} />
                  <span>
                    Start with {preview.tasks.length} suggested tasks{preview.dates.length ? ` and ${preview.dates.length} key date${preview.dates.length === 1 ? '' : 's'}` : ''}
                    <span className="pj-check-hint">
                      {form.due_date ? 'Due dates are counted back from the date above. ' : 'Add a date above to have them dated for you. '}
                      You can rename, delete or add tasks afterwards.
                    </span>
                  </span>
                </label>
              )}
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create project'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="pj-toolbar">
        <div className="seg">
          {[['open', 'Open'], ['closed', 'Finished'], ['all', 'All']].map(([value, label]) => (
            <button key={value} className={`seg-btn${filter === value ? ' is-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ width: 'auto', margin: 0 }} aria-label="Filter by type">
          <option value="">All types</option>
          {PROJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={projects.length === 0 ? 'No projects yet' : 'Nothing matches'}
          body={projects.length === 0
            ? 'Start one for a tender, a new contract or a deep clean, and keep its tasks, dates and files together.'
            : 'Try a different filter.'}
          action={projects.length === 0 && !showForm ? { label: 'New project', onClick: openForm } : undefined}
        />
      ) : (
        <div className="pj-grid">
          {visible.map((p) => {
            const related = byProject.get(p.id) || { tasks: [], dates: [] };
            const progress = taskProgress(related.tasks);
            const next = isOpenStatus(p.status) ? nextDeadline(related, today) : null;
            const late = isOpenStatus(p.status) ? overdueTaskCount(related.tasks, today) : 0;
            const owner = staffName(p.owner_id);
            return (
              <Link key={p.id} href={`/admin/projects/${p.id}`} className="card pj-card">
                <div className="pj-card-top">
                  <span className="pj-kind">{kindLabel(p.kind)}</span>
                  <span className={`pj-status is-${p.status}`}>{p.outcome ? `${statusLabel(p.status)} · ${p.outcome}` : statusLabel(p.status)}</span>
                </div>
                <h2 className="pj-card-title">{p.name}</h2>
                <p className="pj-card-meta">
                  {[p.clients?.name, owner].filter(Boolean).join(' · ') || 'No client linked'}
                </p>
                {progress.total > 0 && (
                  <div className="pj-progress" aria-label={`${progress.done} of ${progress.total} tasks done`}>
                    <div className="pj-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
                    <span className="pj-progress-count">{progress.done}/{progress.total}</span>
                  </div>
                )}
                {next && (
                  <p className={`pj-next${next.overdue ? ' is-late' : ''}`}>
                    Next: {next.label} - {new Date(`${next.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ({describeDaysUntil(next.date, today)})
                  </p>
                )}
                {late > 0 && <p className="pj-late">{late} task{late === 1 ? '' : 's'} overdue</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
