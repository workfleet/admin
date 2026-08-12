'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';
import AddressAutocomplete from '../../components/AddressAutocomplete';

// Full 24hr range with scroll (CrewConnect crews run early mornings through
// overnight), defaulting the scroll position to business hours on load.
const START_HOUR = 0;
const END_HOUR = 24;
const DEFAULT_SCROLL_HOUR = 7;
const HOUR_HEIGHT = 48;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_DURATIONS = [30, 60, 90, 120, 180, 240];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_OPTIONS = [0, 15, 30, 45];

function formatHour12(h) {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

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
  const [draggingJobId, setDraggingJobId] = useState(null);
  const [dragOverDayKey, setDragOverDayKey] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCoords, setPropertyCoords] = useState(null);
  const [jobDate, setJobDate] = useState('');
  const [jobHour, setJobHour] = useState('');
  const [jobMinute, setJobMinute] = useState('00');
  const [duration, setDuration] = useState(120);
  const [useCustomDuration, setUseCustomDuration] = useState(false);
  const [formCleanerId, setFormCleanerId] = useState('');

  const [jobTasks, setJobTasks] = useState([]);
  const [newTaskText, setNewTaskText] = useState('');

  const [editDate, setEditDate] = useState('');
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('00');
  const [editDuration, setEditDuration] = useState(120);
  const [editUseCustomDuration, setEditUseCustomDuration] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [savingJob, setSavingJob] = useState(false);
  const [jobSaveError, setJobSaveError] = useState('');

  const calendarScrollRef = useRef(null);

  useEffect(() => {
    if (calendarScrollRef.current) {
      calendarScrollRef.current.scrollTop = (DEFAULT_SCROLL_HOUR - START_HOUR) * HOUR_HEIGHT;
    }
  }, []);

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

  useEffect(() => {
    if (!selectedJob) return;
    const d = new Date(selectedJob.scheduled_at);
    setEditDate(d.toISOString().slice(0, 10));
    setEditHour(String(d.getHours()).padStart(2, '0'));
    setEditMinute(String(d.getMinutes() - (d.getMinutes() % 15)).padStart(2, '0'));
    setEditDuration(selectedJob.duration_minutes || 120);
    setEditUseCustomDuration(!QUICK_DURATIONS.includes(selectedJob.duration_minutes));
    setEditNotes(selectedJob.notes || '');
    setJobSaveError('');
  }, [selectedJob?.id]);

  const saveJobDetails = async () => {
    if (!selectedJob || !editDate || !editHour) return;
    setSavingJob(true);
    setJobSaveError('');

    const scheduledAtDate = new Date(`${editDate}T${editHour}:${editMinute}`);

    if (selectedJob.cleaner_id) {
      const conflict = await findConflict(selectedJob.cleaner_id, scheduledAtDate, editDuration, selectedJob.id);
      if (conflict) {
        const proceed = confirm(
          `This cleaner is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Save anyway?`
        );
        if (!proceed) { setSavingJob(false); return; }
      }
      if (!(await confirmTimeOffConflict(selectedJob.cleaner_id, scheduledAtDate))) { setSavingJob(false); return; }
    }

    const { data, error } = await supabase
      .from('jobs')
      .update({
        scheduled_at: scheduledAtDate.toISOString(),
        duration_minutes: editDuration,
        notes: editNotes.trim() || null,
      })
      .eq('id', selectedJob.id)
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, notes, properties(address, clients(name)), profiles(full_name)')
      .single();

    setSavingJob(false);
    if (error) { setJobSaveError('Something went wrong saving those changes.'); return; }

    setJobs((prev) => prev.map((j) => (j.id === data.id ? { ...j, ...data } : j)));
    setSelectedJob(data);
  };

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
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, notes, properties(address, clients(name)), profiles(full_name)')
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

  // Separate from findConflict (double-booking against other jobs) - this
  // checks the job's date against the cleaner's own approved time off, so
  // scheduling someone during their holiday gets caught instead of only
  // being visible after the fact on their Rota.
  const findTimeOffConflict = async (cleanerId, date) => {
    if (!cleanerId) return null;
    const dateStr = date.toISOString().slice(0, 10);

    const { data } = await supabase
      .from('time_off_requests')
      .select('id, type, start_date, end_date')
      .eq('cleaner_id', cleanerId)
      .eq('status', 'approved')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr);

    return (data && data[0]) || null;
  };

  const confirmTimeOffConflict = async (cleanerId, date) => {
    const conflict = await findTimeOffConflict(cleanerId, date);
    if (!conflict) return true;
    return confirm(
      `This cleaner has approved ${conflict.type === 'holiday' ? 'holiday' : 'unavailability'} covering ${new Date(conflict.start_date).toLocaleDateString()}–${new Date(conflict.end_date).toLocaleDateString()}. Schedule anyway?`
    );
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
      if (!(await confirmTimeOffConflict(cleanerId, new Date(job.scheduled_at)))) return;
    }

    await supabase.from('jobs').update({ cleaner_id: cleanerId || null }).eq('id', jobId);
    const assignedProfile = cleanerId ? { full_name: cleaners.find((c) => c.id === cleanerId)?.full_name } : null;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, cleaner_id: cleanerId, profiles: assignedProfile } : j)));
    setSelectedJob((sj) => (sj && sj.id === jobId ? { ...sj, cleaner_id: cleanerId, profiles: assignedProfile } : sj));

    if (cleanerId && job) {
      notify({ type: 'shift_assigned', cleanerId, address: job.properties?.address, scheduledAt: job.scheduled_at });
    }
  };

  const resetForm = () => {
    setClientId('');
    setPropertyAddress('');
    setPropertyCoords(null);
    setJobDate('');
    setJobHour('');
    setJobMinute('00');
    setDuration(120);
    setUseCustomDuration(false);
    setFormCleanerId('');
    setShowForm(false);
  };

  const createJob = async (e) => {
    e.preventDefault();
    if (!clientId || !propertyAddress.trim() || !jobDate || !jobHour) return;

    const jobTime = `${jobHour}:${jobMinute}`;
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
      if (!(await confirmTimeOffConflict(formCleanerId, scheduledAtDate))) return;
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
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, properties(address, clients(name)), profiles(full_name)')
      .single();

    if (data) {
      const jd = new Date(data.scheduled_at);
      if (jd >= weekStart && jd < addDays(weekStart, 7)) {
        setJobs((prev) => [...prev, data].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      }
      if (formCleanerId) {
        notify({ type: 'shift_assigned', cleanerId: formCleanerId, address: data.properties?.address, scheduledAt: data.scheduled_at });
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

  const handleJobDragStart = (e, job) => {
    e.dataTransfer.setData('text/plain', job.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingJobId(job.id);
  };

  const handleJobDragEnd = () => {
    setDraggingJobId(null);
    setDragOverDayKey(null);
  };

  const handleDayDragOver = (e, day) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDayKey(day.toDateString());
  };

  const handleDayDragLeave = () => setDragOverDayKey(null);

  // Dropping a job re-times it to wherever it was released: the day column
  // it landed in sets the date, the vertical offset (snapped to 15 minutes,
  // matching the manual time picker's granularity) sets the time. Runs the
  // same conflict checks as a manual edit so a drag can't silently create a
  // double-booking or clash with approved time off.
  const handleJobDrop = async (e, day) => {
    e.preventDefault();
    setDragOverDayKey(null);

    const jobId = e.dataTransfer.getData('text/plain');
    setDraggingJobId(null);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const hourFloat = offsetY / HOUR_HEIGHT + START_HOUR;
    const snappedMinutes = Math.round((hourFloat * 60) / 15) * 15;
    const clampedMinutes = Math.min(Math.max(snappedMinutes, 0), (END_HOUR - START_HOUR) * 60 - 1);

    const newDate = new Date(day);
    newDate.setHours(Math.floor(clampedMinutes / 60), clampedMinutes % 60, 0, 0);

    if (newDate.getTime() === new Date(job.scheduled_at).getTime()) return;

    if (job.cleaner_id) {
      const conflict = await findConflict(job.cleaner_id, newDate, job.duration_minutes || 120, job.id);
      if (conflict) {
        const proceed = confirm(
          `This cleaner is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Move anyway?`
        );
        if (!proceed) return;
      }
      if (!(await confirmTimeOffConflict(job.cleaner_id, newDate))) return;
    }

    const { data, error } = await supabase
      .from('jobs')
      .update({ scheduled_at: newDate.toISOString() })
      .eq('id', job.id)
      .select('id, scheduled_at, status, cleaner_id, duration_minutes, notes, properties(address, clients(name)), profiles(full_name)')
      .single();

    if (error) return;

    setJobs((prev) => prev.map((j) => (j.id === data.id ? { ...j, ...data } : j)));
    setSelectedJob((sj) => (sj && sj.id === data.id ? { ...sj, ...data } : sj));
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={jobHour}
                      onChange={(e) => setJobHour(e.target.value)}
                      required
                      style={{ flex: 1.4, marginBottom: 0 }}
                    >
                      <option value="">Hour</option>
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={String(h).padStart(2, '0')}>{formatHour12(h)}</option>
                      ))}
                    </select>
                    <select
                      value={jobMinute}
                      onChange={(e) => setJobMinute(e.target.value)}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      {MINUTE_OPTIONS.map((m) => (
                        <option key={m} value={String(m).padStart(2, '0')}>:{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
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

        <div className="calendar-scroll" ref={calendarScrollRef}>
          <div className="calendar-body" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
            <div className="calendar-hour-col">
              {hourSlots.map((h) => (
                <div key={h} className="calendar-hour-label" style={{ height: HOUR_HEIGHT }}>
                  {h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}
                </div>
              ))}
            </div>

            {weekDays.map((day, i) => (
              <div
                key={i}
                className={`calendar-day-col ${dragOverDayKey === day.toDateString() ? 'drag-over' : ''}`}
                onDragOver={(e) => handleDayDragOver(e, day)}
                onDragLeave={handleDayDragLeave}
                onDrop={(e) => handleJobDrop(e, day)}
              >
                {hourSlots.map((h) => (
                  <div key={h} className="calendar-hour-line" style={{ height: HOUR_HEIGHT }} />
                ))}

                {jobsForDay(day).map((job) => {
                  const { top, height } = jobPosition(job);
                  const isSelected = selectedJob?.id === job.id;
                  const isDraggable = job.status === 'scheduled';
                  return (
                    <div
                      key={job.id}
                      className={`calendar-job ${job.status} ${isSelected ? 'selected' : ''} ${draggingJobId === job.id ? 'dragging' : ''}`}
                      style={{ top, height: Math.max(height, 24) }}
                      onClick={() => setSelectedJob(job)}
                      draggable={isDraggable}
                      onDragStart={isDraggable ? (e) => handleJobDragStart(e, job) : undefined}
                      onDragEnd={handleJobDragEnd}
                      title={isDraggable ? 'Drag to reschedule' : undefined}
                    >
                      <div className="calendar-job-time">
                        {new Date(job.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {' · '}{formatDuration(job.duration_minutes || 120)}
                      </div>
                      <div className="calendar-job-client">{job.properties?.clients?.name || 'Unknown client'}</div>
                      <div className="calendar-job-staff">{job.profiles?.full_name || 'Unassigned'}</div>
                      <div className="calendar-job-address">{job.properties?.address}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedJob && (
        <div className="card job-detail-panel">
          <div className="page-header-row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{selectedJob.properties?.address}</h2>
            <button className="btn-secondary" onClick={() => setSelectedJob(null)}>Close</button>
          </div>
          <span className={`badge ${selectedJob.status}`}>{selectedJob.status.replace('_', ' ')}</span>

          <div style={{ marginTop: 14 }}>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Date</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Time</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={editHour} onChange={(e) => setEditHour(e.target.value)} style={{ flex: 1.4, marginBottom: 0 }}>
                    {HOUR_OPTIONS.map((h) => (
                      <option key={h} value={String(h).padStart(2, '0')}>{formatHour12(h)}</option>
                    ))}
                  </select>
                  <select value={editMinute} onChange={(e) => setEditMinute(e.target.value)} style={{ flex: 1, marginBottom: 0 }}>
                    {MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={String(m).padStart(2, '0')}>:{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label">Duration</label>
              <div className="duration-chips">
                {QUICK_DURATIONS.map((mins) => (
                  <button
                    type="button"
                    key={mins}
                    className={`duration-chip ${!editUseCustomDuration && editDuration === mins ? 'active' : ''}`}
                    onClick={() => { setEditDuration(mins); setEditUseCustomDuration(false); }}
                  >
                    {formatDuration(mins)}
                  </button>
                ))}
                <button
                  type="button"
                  className={`duration-chip ${editUseCustomDuration ? 'active' : ''}`}
                  onClick={() => setEditUseCustomDuration(true)}
                >
                  Custom
                </button>
              </div>
              {editUseCustomDuration && (
                <div className="duration-custom-select">
                  <select value={editDuration} onChange={(e) => setEditDuration(Number(e.target.value))}>
                    {DURATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="e.g. Client wants extra attention on the windows this visit"
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                  background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
                }}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={saveJobDetails}
              disabled={savingJob}
              style={{ marginTop: 10, width: '100%' }}
            >
              {savingJob ? 'Saving...' : 'Save Changes'}
            </button>
            {jobSaveError && <p style={{ color: 'crimson', fontSize: 13, marginTop: 8 }}>{jobSaveError}</p>}
          </div>

          <div style={{ marginTop: 16 }}>
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
