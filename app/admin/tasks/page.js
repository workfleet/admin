'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const STATUS_LABELS = { to_do: 'To Do', in_progress: 'In Progress', done: 'Done' };
// Reuses the job-status badge colours (scheduled/in_progress/completed)
// rather than inventing a new palette for a very similar concept.
const STATUS_BADGE_CLASS = { to_do: 'scheduled', in_progress: 'in_progress', done: 'completed' };

function isOverdue(task) {
  return task.status !== 'done' && task.due_date && new Date(task.due_date) < new Date(new Date().toDateString());
}

export default function AdminTasks() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [ownId, setOwnId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | done | all

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setOwnId(session.user.id);

    const [{ data: tasksData }, { data: staffData }] = await Promise.all([
      supabase
        .from('internal_tasks')
        .select('id, title, description, status, due_date, created_at, completed_at, assigned_to, created_by, assignee:profiles!internal_tasks_assigned_to_fkey(full_name), creator:profiles!internal_tasks_created_by_fkey(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']).order('full_name'),
    ]);

    setTasks(tasksData || []);
    setStaff(staffData || []);
    setLoading(false);
  };

  const createTask = async (e) => {
    e.preventDefault();
    if (!title.trim() || !assignedTo) return;
    setCreating(true);

    const { data } = await supabase
      .from('internal_tasks')
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        assigned_to: assignedTo,
        created_by: ownId,
        due_date: dueDate || null,
      })
      .select('id, title, description, status, due_date, created_at, completed_at, assigned_to, created_by, assignee:profiles!internal_tasks_assigned_to_fkey(full_name), creator:profiles!internal_tasks_created_by_fkey(full_name)')
      .single();

    setCreating(false);
    if (data) setTasks((prev) => [data, ...prev]);
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setDueDate('');
    setShowForm(false);
  };

  const changeStatus = async (task, status) => {
    const completed_at = status === 'done' ? new Date().toISOString() : null;

    const { data } = await supabase
      .from('internal_tasks').update({ status, completed_at }).eq('id', task.id)
      .select('id, status, completed_at').single();

    if (data) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: data.status, completed_at: data.completed_at } : t)));
    }
  };

  const deleteTask = async (taskId) => {
    if (!(await confirm('Delete this task?', { danger: true }))) return;
    const { error } = await supabase.from('internal_tasks').delete().eq('id', taskId);
    if (error) { toast.error('Could not delete the task.'); return; }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    toast.success('Task deleted.');
  };

  const filteredTasks = useMemo(() => {
    if (filter === 'done') return tasks.filter((t) => t.status === 'done');
    if (filter === 'all') return tasks;
    return tasks.filter((t) => t.status !== 'done');
  }, [tasks, filter]);

  // Grouped by assignee rather than one mixed feed, so "what's on my
  // list" doesn't mean scanning past everyone else's tasks - own group
  // always shown first (even empty), the rest alphabetical.
  const groupedTasks = useMemo(() => {
    const groups = new Map();
    staff.forEach((s) => groups.set(s.id, { id: s.id, name: s.full_name || 'Unknown', tasks: [] }));

    filteredTasks.forEach((task) => {
      const key = task.assigned_to;
      if (!groups.has(key)) groups.set(key, { id: key, name: task.assignee?.full_name || 'Unassigned', tasks: [] });
      groups.get(key).tasks.push(task);
    });

    const own = groups.get(ownId);
    const others = [...groups.values()]
      .filter((g) => g.id !== ownId && g.tasks.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return own ? [{ ...own, name: 'My Tasks' }, ...others] : others;
  }, [filteredTasks, staff, ownId]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Team Tasks</h1>
          <p className="page-subtitle">Internal work assigned between admins and supervisors — your own list first, everyone else's below</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)} title="Add a task for the team to pick up">
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Task</h2>
            <button className="job-form-close" type="button" onClick={() => setShowForm(false)}>×</button>
          </div>
          <form onSubmit={createTask}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chase invoice for Acme Offices" required autoFocus />
              </div>
              <div className="field">
                <label className="field-label">Description (optional)</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any extra detail" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Assign to</label>
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required>
                    <option value="">Select...</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name || s.id}{s.id === ownId ? ' (me)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Due date (optional)</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating} title="Save this task">{creating ? 'Adding...' : 'Add Task'}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>Open</button>
        <button className={filter === 'done' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('done')}>Done</button>
        <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
      </div>

      {groupedTasks.map((group) => (
        <div key={group.id} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
            {group.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({group.tasks.length})</span>
          </h2>

          {group.tasks.length === 0 && <p className="empty-state" style={{ padding: '4px 0' }}>Nothing here.</p>}

          <div className="job-list">
            {group.tasks.map((task) => (
              <div key={task.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h2>{task.title}</h2>
                    {task.description && <p className="job-time">{task.description}</p>}
                    <p className="job-time">
                      by {task.creator?.full_name || 'Unknown'}
                      {task.due_date && (
                        <>
                          {' · due '}
                          <span style={isOverdue(task) ? { color: 'crimson', fontWeight: 600 } : undefined}>
                            {new Date(task.due_date).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <button className="btn-secondary" onClick={() => deleteTask(task.id)} style={{ height: 'fit-content' }} title="Delete this task">Delete</button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                  <span className={`badge ${STATUS_BADGE_CLASS[task.status]}`}>{STATUS_LABELS[task.status]}</span>
                  <select
                    value={task.status}
                    onChange={(e) => changeStatus(task, e.target.value)}
                    style={{ width: 'auto', margin: 0 }}
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
