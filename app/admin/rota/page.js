'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const START_HOUR = 7;
const END_HOUR = 19;
const HOUR_HEIGHT = 48;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_DURATIONS = [30, 60, 90, 120, 180, 240];

const DURATION_OPTIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15).map((mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h} hr${h > 1 ? 's' : ''} `;
  if (m > 0) label += `${m} min`;
  return { value: mins, label: label.trim() };
});

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function jobsOverlap(startA, durationA, startB, durationB) {
  const endA = new Date(startA.getTime() + durationA * 60000);
  const endB = new Date(startB.getTime() + durationB * 60000);
  return startA < endB && startB < endA;
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h}h `;
  if (m > 0) label += `${m}m`;
  return label.trim();
}

export default function AdminRota() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [jobs, setJobs] = useState([]);
  const [cleaners, setCleaners] = useState([]);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCoords, setPropertyCoords] = useState(null);
  const [jobDate, setJobDate] = useState('');
  const [jobTime, setJobTime] = useState('');
  const [duration, setDuration] = useState(120);
  const [useCustomDuration, setUseCustomDuration] = useState(false);
  const [formCleanerId, setFormCleanerId] = useState('');

  const [jobTasks, setJobTasks] = useState([]);
  const [newTaskText, setNewTaskText] = useState('');

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const hourSlots = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i),
    []
  );

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadJobs();
  }, [weekStart]);

  useEffect(() => {
    if (selectedJob) loadTasks(selectedJob.id);
    else setJobTasks([]);
  }, [selectedJob?.id]);

  const loadTasks = async (jobId) => {
    const { data } = await supabase
      .from('tasks')
      .select('id, description, completed')
      .eq('job_id', jobId)
      .order('completed_at', { ascending: true, nullsFirst: true });

    setJobTasks(data || []);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !selectedJob) return;

    const { data } = await supabase
      .from('tasks')
      .insert({ job_id: selectedJob.id, description: newTaskText.trim() })
      .select('id, description, completed')
      .single();

    if (data) setJobTasks((prev) => [...prev, data]);
    setNewTaskText('');
  };

  const deleteTask = async (taskId) => {
    await supabase.from('tasks').delete().eq('id', taskId);
    setJobTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const loadLookups = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: cleanersData } = await supabase
      .from('profiles').select('id, full_name').eq('role', 'cleaner');
    const { data: clientsData } = await supabase
      .from('clients').select('id, name').order('name');
    const { data: propertiesData } = await supabase
      .from('properties').select('id, client_id, address, lat, lng');

    setCleaners(cleanersData || []);
    setClients(clientsData || []);
    setProperties(propertiesData || []);
  };

  const loadJobs = async () => {
    const rangeStart = weekStart.toISOString();
    const rangeEnd = addDays(weekStart, 7).toISOString();

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, properties(address)')
      .gte('scheduled_at', rangeStart)
      .lt('scheduled_at', rangeEnd)
      .order('scheduled_at', { ascending: true });

    setJobs(data || []);
  };

  // Looks for another job already on this cleaner's schedule that overlaps
  // the given time window, so double-bookings get a warning instead of
  // silently happening. Scoped to the same calendar day for efficiency.
  const findConflict = async (cleanerId, start, durationMinutes, excludeJobId) => {
    if (!cleanerId) return null;

    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, duration_minutes, properties(address)')
      .eq('cleaner_id', cleanerId)
      .gte('scheduled_at', dayStart.toISOString())
      .lt('scheduled_at', dayEnd.toISOString());

    return (data || []).find(
      (j) => j.id !== excludeJobId && jobsOverlap(start, durationMinutes, new Date(j.scheduled_at), j.duration_minutes || 120)
    ) || null;
  };

  const assignCleaner = async (jobId, cleanerId) => {
    const job = jobs.find((j) => j.id === jobId) || selectedJob;
    if (cleanerId && job) {
      const conflict = await findConflict(cleanerId, new Date(job.scheduled_at), job.duration_minutes || 120, jobId);
      if (conflict) {
        const proceed = confirm(
          `This cleaner is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Assign anyway?`
        );
        if (!proceed) return;
      }
    }

    await supabase.from('jobs').update({ cleaner_id: cleanerId || null }).eq('id', jobId);
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, cleaner_id: cleanerId } : j)));
    setSelectedJob((sj) => (sj && sj.id === jobId ? { ...sj, cleaner_id: cleanerId } : sj));
  };

  const resetForm = () => {
    setClientId('');
    setPropertyAddress('');
    setPropertyCoords(null);
    setJobDate('');
    setJobTime('');
    setDuration(120);
    setUseCustomDuration(false);
    setFormCleanerId('');
    setShowForm(false);
  };

  const createJob = async (e) => {
    e.preventDefault();
    if (!clientId || !propertyAddress.trim() || !jobDate || !jobTime) return;

    const scheduledAtDate = new Date(`${jobDate}T${jobTime}`);
    const scheduledAt = scheduledAtDate.toISOString();

    if (formCleanerId) {
      const conflict = await findConflict(formCleanerId, scheduledAtDate, duration, null);
      if (conflict) {
        const proceed = confirm(
          `This cleaner is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Create this job anyway?`
        );
        if (!proceed) return;
      }
    }

    // Reuse the property if this exact address already exists for the
    // client; otherwise create one on the fly from what was typed/picked.
    let property = properties.find((p) => p.client_id === clientId && p.address === propertyAddress.trim());
    if (!property) {
      const { data: newProperty } = await supabase
        .from('properties')
        .insert({
          client_id: clientId,
          address: propertyAddress.trim(),
          lat: propertyCoords?.lat ?? null,
          lng: propertyCoords?.lng ?? null,
        })
        .select('id, client_id, address, lat, lng')
        .single();

      if (!newProperty) return;
      property = newProperty;
      setProperties((prev) => [...prev, newProperty]);
    }

    const { data } = await supabase
      .from('jobs')
      .insert({
        property_id: property.id,
        scheduled_at: scheduledAt,
        duration_minutes: duration,
        cleaner_id: formCleanerId || null,
      })
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, properties(address)')
      .single();

    if (data) {
      const jd = new Date(data.scheduled_at);
      if (jd >= weekStart && jd < addDays(weekStart, 7)) {
        setJobs((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      }
    }
    resetForm();
  };

  const jobPosition = (job) => {
    const d = new Date(job.scheduled_at);
    const hourFloat = d.getHours() + d.getMinutes() / 60;
    const top = Math.max(0, (hourFloat - START_HOUR) * HOUR_HEIGHT);
    const height = ((job.duration_minutes || 120) / 60) * HOUR_HEIGHT;
    return { top, height };
  };

  const jobsForDay = (day) =>
    jobs.filter((j) => {
      const d = new Date(j.scheduled_at);
      return d.toDateString() === day.toDateString();
    });

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Rota</h1>
          <p className="page-subtitle">{weekLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prev</button>
          <button className="btn-secondary" onClick={() => setWeekStart(getMonday(new Date()))}>Today</button>
          <button className="btn-secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next ›</button>
          <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ New Job'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Job</h2>
            <button className="job-form-close" onClick={resetForm} type="button">×</button>
          </div>

          <form onSubmit={createJob}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Client</label>
                <select
                  value={clientId}
                  onChange={(e) => { setClientId(e.target.value); setPropertyAddress(''); setPropertyCoords(null); }}
                  required
                >
                  <option value="">Select a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label">Address</label>
                {clientId ? (
                  <AddressAutocomplete
                    value={propertyAddress}
                    onChange={(text) => { setPropertyAddress(text); setPropertyCoords(null); }}
                    onSelect={({ address, lat, lng }) => { setPropertyAddress(address); setPropertyCoords({ lat, lng }); }}
                    placeholder="Start typing an address..."
                  />
                ) : (
                  <input value="" disabled placeholder="Select a client first" />
                )}
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field-label">Date</label>
                  <input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="field-label">Time</label>
                  <input type="time" value={jobTime} onChange={(e) => setJobTime(e.target.value)} required />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Duration</label>
                <div className="duration-chips">
                  {QUICK_DURATIONS.map((mins) => (
                    <button
                      type="button"
                      key={mins}
                      className={`duration-chip ${!useCustomDuration && duration === mins ? 'active' : ''}`}
                      onClick={() => { setDuration(mins); setUseCustomDuration(false); }}
                    >
                      {formatDuration(mins)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`duration-chip ${useCustomDuration ? 'active' : ''}`}
                    onClick={() => setUseCustomDuration(true)}
                  >
                    Custom
                  </button>
                </div>

                {useCustomDuration && (
                  <div className="duration-custom-select">
                    <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      {DURATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="field">
                <label className="field-label">Cleaner</label>
                <select value={formCleanerId} onChange={(e) => setFormCleanerId(e.target.value)}>
                  <option value="">Unassigned for now</option>
                  {cleaners.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn-primary">Add Job</button>
            </div>
          </form>
        </div>
      )}

      <div className="calendar">
        <div className="calendar-header">
          <div className="calendar-hour-col" />
          {weekDays.map((day, i) => (
            <div key={i} className="calendar-day-head">
              <div className="calendar-day-name">{DAY_NAMES[i]}</div>
              <div className="calendar-day-date">{day.getDate()}</div>
            </div>
          ))}
        </div>

        <div className="calendar-body" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
          <div className="calendar-hour-col">
            {hourSlots.map((h) => (
              <div key={h} className="calendar-hour-label" style={{ height: HOUR_HEIGHT }}>
                {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}
              </div>
            ))}
          </div>

          {weekDays.map((day, i) => (
            <div key={i} className="calendar-day-col">
              {hourSlots.map((h) => (
                <div key={h} className="calendar-hour-line" style={{ height: HOUR_HEIGHT }} />
              ))}

              {jobsForDay(day).map((job) => {
                const { top, height } = jobPosition(job);
                const isSelected = selectedJob?.id === job.id;
                return (
                  <div
                    key={job.id}
                    className={`calendar-job ${job.status} ${isSelected ? 'selected' : ''}`}
                    style={{ top, height: Math.max(height, 24) }}
                    onClick={() => setSelectedJob(job)}
                  >
                    <div className="calendar-job-time">
                      {new Date(job.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      {' · '}{formatDuration(job.duration_minutes || 120)}
                    </div>
                    <div className="calendar-job-address">{job.properties?.address}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedJob && (
        <div className="card job-detail-panel">
          <div className="page-header-row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{selectedJob.properties?.address}</h2>
            <button className="btn-secondary" onClick={() => setSelectedJob(null)}>Close</button>
          </div>
          <p className="job-time">
            {new Date(selectedJob.scheduled_at).toLocaleString()} · {formatDuration(selectedJob.duration_minutes || 120)}
          </p>
          <span className={`badge ${selectedJob.status}`}>{selectedJob.status.replace('_', ' ')}</span>

          <div style={{ marginTop: 12 }}>
            <label>Assign cleaner</label>
            <select
              value={selectedJob.cleaner_id || ''}
              onChange={(e) => assignCleaner(selectedJob.id, e.target.value)}
            >
              <option value="">Unassigned</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name || c.id}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 16 }}>
            <label>To-do list</label>
            {jobTasks.length === 0 && (
              <p className="empty-state" style={{ padding: '4px 0' }}>No tasks yet.</p>
            )}
            {jobTasks.map((task) => (
              <div key={task.id} className={`task-row ${task.completed ? 'done' : ''}`}>
                <span style={{ flex: 1 }}>{task.description}</span>
                <button className="btn-secondary" onClick={() => deleteTask(task.id)}>Remove</button>
              </div>
            ))}
            <form onSubmit={addTask} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                placeholder="e.g. Vacuum reception"
                style={{ marginBottom: 0 }}
              />
              <button type="submit" className="btn-primary">Add</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
