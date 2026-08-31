'use client';

import { Fragment, useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { notify } from '../../../lib/notify';
import { localDateString } from '../../../lib/localDate';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';
import { groupOverlappingJobs, assignLanes, abbreviateName } from '../../../lib/jobOverlap';

// Full 24hr range with scroll (CrewConnect crews run early mornings through
// overnight), defaulting the scroll position to business hours on load.
const START_HOUR = 0;
const END_HOUR = 24;
const DEFAULT_SCROLL_HOUR = 7;
// 56px an hour is the sheet's grid: a one-hour job is a block you can read
// two lines in, and the half-hour rule lands on a whole pixel.
const HOUR_HEIGHT = 56;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const QUICK_DURATIONS = [30, 60, 90, 120, 180, 240];

// Past three, a grouped clash block would grow taller than the run it
// covers and start overlapping the jobs after it. The rest are counted,
// and the count opens the block out so they can still be reached.
const MAX_CLASH_ENTRIES = 3;

// Dragging a job snaps to the same 15 minutes the manual time picker
// offers. On a touchscreen a drag has to be a deliberate press-and-hold,
// so an ordinary tap still opens the job and a swipe still scrolls.
const DRAG_SNAP_MINUTES = 15;
const DRAG_MOVE_THRESHOLD = 5;
const TOUCH_HOLD_MS = 350;
const EDGE_SCROLL_ZONE = 44;
const EDGE_SCROLL_SPEED = 10;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_OPTIONS = [0, 15, 30, 45];

const JOB_SELECT = 'id, scheduled_at, status, duration_minutes, notes, series_id, properties(address, lat, lng, clients(name)), job_assignments(cleaner_id, profiles(full_name))';

// Sanity cap against a mistake (e.g. daily "forever") generating an
// unbounded number of jobs in one go.
const MAX_OCCURRENCES = 104;

function generateOccurrenceDates(start, recurrenceType, intervalCount, endMode, endDate, count) {
  const dates = [];
  const current = new Date(start);
  while (dates.length < MAX_OCCURRENCES) {
    dates.push(new Date(current));
    if (endMode === 'count' && dates.length >= count) break;
    if (recurrenceType === 'daily') current.setDate(current.getDate() + intervalCount);
    else if (recurrenceType === 'weekly') current.setDate(current.getDate() + intervalCount * 7);
    else if (recurrenceType === 'monthly') current.setMonth(current.getMonth() + intervalCount);
    if (endMode === 'date' && current > endDate) break;
  }
  return dates;
}

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

// A block only has so much room, and a one-hour job is 56px tall. Rather
// than let the address spill out of sight, drop lines as the block gets
// shorter: an hour holds the time and the address, and the staff line only
// appears once there's a real third line to put it on.
function linesForHeight(height) {
  if (height >= 84) return 3;
  if (height >= 46) return 2;
  return 1;
}

// Under about an hour and a half the block tightens up - less padding, a
// smaller staff line - so the two lines it does carry still fit.
function isCompactHeight(height) {
  return height < 90;
}

// 24-hour, zero-padded, so times line up in a column and read the same way
// they do on the dashboard. The grid is the one place a wobbling figure is
// most obvious.
function formatClock(minutesOfDay) {
  const total = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutesOfDayFor(job) {
  const d = new Date(job.scheduled_at);
  return d.getHours() * 60 + d.getMinutes();
}

function assignedNames(job) {
  return (job.job_assignments || []).map((a) => a.profiles?.full_name || 'Unknown');
}

export default function AdminRota() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [jobs, setJobs] = useState([]);
  const [cleaners, setCleaners] = useState([]);
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  // `drag` is only what the calendar needs to paint (which column, what
  // start time); everything the pointer handlers mutate mid-gesture lives
  // in refs so a re-render can't hand them a stale gesture.
  const [drag, setDrag] = useState(null);
  const [pendingJobId, setPendingJobId] = useState(null);
  // Which overlap block has been opened out to show every job in it. Only
  // one at a time - two expanded blocks in neighbouring columns overlap
  // each other and put us back where we started.
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  // A job id arrived in the URL and its modal hasn't been opened yet - the
  // week it belongs to has to load first.
  const [openJobId, setOpenJobId] = useState(null);
  // Starts null rather than `new Date()` so the server and the first client
  // render agree - the now-line only appears once we're on the client.
  const [now, setNow] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCoords, setPropertyCoords] = useState(null);
  const [jobDate, setJobDate] = useState('');
  const [jobHour, setJobHour] = useState('');
  const [jobMinute, setJobMinute] = useState('00');
  const [duration, setDuration] = useState(120);
  const [useCustomDuration, setUseCustomDuration] = useState(false);
  const [formCleanerIds, setFormCleanerIds] = useState([]);
  const [formTemplateId, setFormTemplateId] = useState('');
  const [repeatJob, setRepeatJob] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState('weekly');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceEndMode, setRecurrenceEndMode] = useState('count');
  const [recurrenceCount, setRecurrenceCount] = useState(8);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');

  const [jobTasks, setJobTasks] = useState([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [jobCheckins, setJobCheckins] = useState([]);
  const [jobPhotos, setJobPhotos] = useState([]);

  const [editDate, setEditDate] = useState('');
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('00');
  const [editDuration, setEditDuration] = useState(120);
  const [editUseCustomDuration, setEditUseCustomDuration] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [savingJob, setSavingJob] = useState(false);
  const [jobSaveError, setJobSaveError] = useState('');
  const [addCleanerSelection, setAddCleanerSelection] = useState('');
  const [applyTemplateSelection, setApplyTemplateSelection] = useState('');

  const calendarScrollRef = useRef(null);
  const dayColRefs = useRef([]);
  const pointerSessionRef = useRef(null);
  const pointerHandlersRef = useRef({});
  const windowListenersRef = useRef(null);
  const edgeScrollRef = useRef(0);
  const edgeScrollFrameRef = useRef(null);

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

  // Escape puts away whichever panel is open. For the form it closes without
  // clearing, so a stray keypress can't bin a half-filled job - discarding is
  // what the Cancel button is for.
  useEffect(() => {
    if (!showForm && !selectedJob && !expandedGroupId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selectedJob) setSelectedJob(null);
      else if (showForm) setShowForm(false);
      else setExpandedGroupId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, selectedJob, expandedGroupId]);

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    loadLookups();
  }, []);

  // The dashboard's "+ New job" links here with the form already open, and
  // its "Assign cleaner" button links to a single job's modal. Read on mount
  // rather than via useSearchParams, which would need the page wrapped in a
  // Suspense boundary to keep prerendering.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') setShowForm(true);

    const jobId = params.get('job');
    if (jobId) {
      setOpenJobId(jobId);
      // The job may well be in a different week from the one the rota opens
      // on - an upcoming job is usually next week - so move the calendar to
      // it rather than opening a modal over the wrong seven days.
      supabase
        .from('jobs')
        .select('scheduled_at')
        .eq('id', jobId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setWeekStart(getMonday(new Date(data.scheduled_at)));
        });
    }

    if (params.get('new') === '1' || jobId) {
      window.history.replaceState(null, '', '/admin/rota');
    }
  }, []);

  // Wait for the week to load before opening the modal - the row it needs
  // comes from `jobs`, so a deep link can't open anything until it's there.
  useEffect(() => {
    if (!openJobId) return;
    const job = jobs.find((j) => j.id === openJobId);
    if (job) {
      setSelectedJob(job);
      setOpenJobId(null);
    }
  }, [openJobId, jobs]);

  useEffect(() => {
    loadJobs();
  }, [weekStart]);

  useEffect(() => {
    if (selectedJob) loadTasks(selectedJob.id);
    else setJobTasks([]);
  }, [selectedJob?.id]);

  useEffect(() => {
    if (selectedJob) loadCheckins(selectedJob.id);
    else setJobCheckins([]);
  }, [selectedJob?.id]);

  useEffect(() => {
    if (selectedJob) loadPhotos(selectedJob.id);
    else setJobPhotos([]);
  }, [selectedJob?.id]);

  useEffect(() => {
    if (!selectedJob) return;
    const d = new Date(selectedJob.scheduled_at);
    setEditDate(localDateString(d));
    setEditHour(String(d.getHours()).padStart(2, '0'));
    setEditMinute(String(d.getMinutes() - (d.getMinutes() % 15)).padStart(2, '0'));
    setEditDuration(selectedJob.duration_minutes || 120);
    setEditUseCustomDuration(!QUICK_DURATIONS.includes(selectedJob.duration_minutes));
    setEditNotes(selectedJob.notes || '');
    setJobSaveError('');
    setAddCleanerSelection('');
  }, [selectedJob?.id]);

  const saveJobDetails = async () => {
    if (!selectedJob || !editDate || !editHour) return;
    setSavingJob(true);
    setJobSaveError('');

    const scheduledAtDate = new Date(`${editDate}T${editHour}:${editMinute}`);
    const previousAt = selectedJob.scheduled_at;

    for (const a of selectedJob.job_assignments || []) {
      const conflict = await findConflict(a.cleaner_id, scheduledAtDate, editDuration, selectedJob.id);
      if (conflict) {
        const proceed = await confirm(
          `${a.profiles?.full_name || 'This cleaner'} is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Save anyway?`,
          { title: 'Scheduling conflict', confirmLabel: 'Save anyway' }
        );
        if (!proceed) { setSavingJob(false); return; }
      }
      if (!(await confirmTimeOffConflict(a.cleaner_id, scheduledAtDate))) { setSavingJob(false); return; }
    }

    const { data, error } = await supabase
      .from('jobs')
      .update({
        scheduled_at: scheduledAtDate.toISOString(),
        duration_minutes: editDuration,
        notes: editNotes.trim() || null,
      })
      .eq('id', selectedJob.id)
      .select(JOB_SELECT)
      .single();

    setSavingJob(false);
    if (error) { setJobSaveError('Something went wrong saving those changes.'); return; }

    setJobs((prev) => prev.map((j) => (j.id === data.id ? { ...j, ...data } : j)));
    setSelectedJob(data);

    // Only when the time actually moved - editing just the notes or the
    // length shouldn't tell anyone their shift has been rescheduled.
    if (new Date(previousAt).getTime() !== scheduledAtDate.getTime()) {
      notifyShiftMoved(data, previousAt, scheduledAtDate.toISOString());
    }
  };

  const loadTasks = async (jobId) => {
    const { data } = await supabase
      .from('tasks')
      .select('id, description, completed')
      .eq('job_id', jobId)
      .order('completed_at', { ascending: true, nullsFirst: true });

    setJobTasks(data || []);
  };

  const loadCheckins = async (jobId) => {
    const { data } = await supabase
      .from('checkins')
      .select('id, cleaner_id, checked_in_at, checked_out_at, auto_checked_out, lat, lng, profiles(full_name)')
      .eq('job_id', jobId)
      .order('checked_in_at', { ascending: true });

    setJobCheckins(data || []);
  };

  const loadPhotos = async (jobId) => {
    const { data } = await supabase
      .from('photos')
      .select('id, url, caption')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    // photos.url stores the job-photos storage path, not a public URL -
    // the bucket is private, so each photo needs a freshly signed URL.
    const withUrls = await Promise.all(
      (data || []).map(async (p) => {
        const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: signed?.signedUrl };
      })
    );

    setJobPhotos(withUrls);
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

  // Always appends to whatever tasks the job already has - never clears
  // the existing list, so applying the wrong template by mistake never
  // loses work someone already did.
  const applyTemplateToJob = async () => {
    if (!applyTemplateSelection || !selectedJob) return;
    const template = templates.find((t) => t.id === applyTemplateSelection);
    if (!template || template.job_template_items.length === 0) return;

    const { data } = await supabase
      .from('tasks')
      .insert(template.job_template_items.map((item) => ({ job_id: selectedJob.id, description: item.description })))
      .select('id, description, completed');

    if (data) setJobTasks((prev) => [...prev, ...data]);
    setApplyTemplateSelection('');
  };

  const loadLookups = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: cleanersData } = await supabase
      .from('profiles').select('id, full_name').eq('role', 'cleaner');
    const { data: clientsData } = await supabase
      .from('clients').select('id, name').order('name');
    const { data: propertiesData } = await supabase
      .from('properties').select('id, client_id, address, lat, lng');
    const { data: templatesData } = await supabase
      .from('job_templates').select('id, name, job_template_items(id, description, sort_order)').order('name');

    setCleaners(cleanersData || []);
    setClients(clientsData || []);
    setProperties(propertiesData || []);
    setTemplates((templatesData || []).map((t) => ({
      ...t,
      job_template_items: (t.job_template_items || []).sort((a, b) => a.sort_order - b.sort_order),
    })));
  };

  const loadJobs = async () => {
    const rangeStart = weekStart.toISOString();
    const rangeEnd = addDays(weekStart, 7).toISOString();

    // Auto-marks overdue jobs missed/completed based on elapsed time
    // before reading, so the calendar's colours reflect reality even for
    // jobs nobody has touched since they were due.
    await supabase.rpc('reconcile_job_statuses');

    const { data } = await supabase
      .from('jobs')
      .select(JOB_SELECT)
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
      .from('job_assignments')
      .select('jobs!inner(id, scheduled_at, duration_minutes, properties(address))')
      .eq('cleaner_id', cleanerId)
      .gte('jobs.scheduled_at', dayStart.toISOString())
      .lt('jobs.scheduled_at', dayEnd.toISOString());

    const candidateJobs = (data || []).map((row) => row.jobs).filter(Boolean);
    return candidateJobs.find(
      (j) => j.id !== excludeJobId && jobsOverlap(start, durationMinutes, new Date(j.scheduled_at), j.duration_minutes || 120)
    ) || null;
  };

  // Separate from findConflict (double-booking against other jobs) - this
  // checks the job's date against the cleaner's own approved time off, so
  // scheduling someone during their holiday gets caught instead of only
  // being visible after the fact on their Rota.
  const findTimeOffConflict = async (cleanerId, date) => {
    if (!cleanerId) return null;
    const dateStr = localDateString(date);

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
      `This cleaner has approved ${conflict.type === 'holiday' ? 'holiday' : 'unavailability'} covering ${new Date(conflict.start_date).toLocaleDateString()}–${new Date(conflict.end_date).toLocaleDateString()}. Schedule anyway?`,
      { title: 'Time off conflict', confirmLabel: 'Schedule anyway' }
    );
  };

  const addCleanerToJob = async (jobId, cleanerId) => {
    if (!cleanerId) return;
    const job = jobs.find((j) => j.id === jobId) || selectedJob;
    if (!job) return;

    const conflict = await findConflict(cleanerId, new Date(job.scheduled_at), job.duration_minutes || 120, jobId);
    if (conflict) {
      const proceed = await confirm(
        `This cleaner is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Assign anyway?`,
        { title: 'Scheduling conflict', confirmLabel: 'Assign anyway' }
      );
      if (!proceed) return;
    }
    if (!(await confirmTimeOffConflict(cleanerId, new Date(job.scheduled_at)))) return;

    const { error } = await supabase.from('job_assignments').insert({ job_id: jobId, cleaner_id: cleanerId });
    if (error) { toast.error('Could not assign this cleaner.'); return; }

    const newAssignment = { cleaner_id: cleanerId, profiles: { full_name: cleaners.find((c) => c.id === cleanerId)?.full_name } };
    const withNewAssignment = (j) => ({ ...j, job_assignments: [...(j.job_assignments || []), newAssignment] });
    setJobs((prev) => prev.map((j) => (j.id === jobId ? withNewAssignment(j) : j)));
    setSelectedJob((sj) => (sj && sj.id === jobId ? withNewAssignment(sj) : sj));

    notify({ type: 'shift_assigned', cleanerId, address: job.properties?.address, scheduledAt: job.scheduled_at });
  };

  const removeCleanerFromJob = async (jobId, cleanerId) => {
    if (!(await confirm('Remove this cleaner from the job?', { danger: true, confirmLabel: 'Remove' }))) return;

    const { error } = await supabase.from('job_assignments').delete().eq('job_id', jobId).eq('cleaner_id', cleanerId);
    if (error) { toast.error('Could not remove this cleaner.'); return; }

    const withoutAssignment = (j) => ({ ...j, job_assignments: (j.job_assignments || []).filter((a) => a.cleaner_id !== cleanerId) });
    setJobs((prev) => prev.map((j) => (j.id === jobId ? withoutAssignment(j) : j)));
    setSelectedJob((sj) => (sj && sj.id === jobId ? withoutAssignment(sj) : sj));
  };

  const deleteJob = async (job) => {
    if (!(await confirm(`Delete this job at ${job.properties?.address} on ${new Date(job.scheduled_at).toLocaleString()}? This can't be undone.`, { title: 'Delete job', danger: true }))) return;

    const { error } = await supabase.from('jobs').delete().eq('id', job.id);
    if (error) { toast.error('Could not delete the job.'); return; }
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    setSelectedJob(null);
    toast.success('Job deleted.');
  };

  // Deletes this occurrence and every future one sharing the same
  // series_id - past occurrences (already happened) are left alone.
  const deleteFutureInSeries = async (job) => {
    if (!job.series_id) return;
    if (!(await confirm('Delete this and every future job in this recurring series? Past occurrences will be kept.', { title: 'Delete series', danger: true }))) return;

    const { data: deleted, error } = await supabase
      .from('jobs')
      .delete()
      .eq('series_id', job.series_id)
      .gte('scheduled_at', job.scheduled_at)
      .select('id');

    if (error) { toast.error('Could not delete the series.'); return; }

    const deletedIds = new Set((deleted || []).map((d) => d.id));
    setJobs((prev) => prev.filter((j) => !deletedIds.has(j.id)));
    setSelectedJob(null);
    toast.success(`${deletedIds.size} job${deletedIds.size === 1 ? '' : 's'} deleted.`);
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
    setFormCleanerIds([]);
    setFormTemplateId('');
    setRepeatJob(false);
    setRecurrenceType('weekly');
    setRecurrenceInterval(1);
    setRecurrenceEndMode('count');
    setRecurrenceCount(8);
    setRecurrenceEndDate('');
    setShowForm(false);
  };

  const createJob = async (e) => {
    e.preventDefault();
    if (!clientId || !propertyAddress.trim() || !jobDate || !jobHour) return;
    if (repeatJob && recurrenceEndMode === 'date' && !recurrenceEndDate) return;

    const jobTime = `${jobHour}:${jobMinute}`;
    const firstDate = new Date(`${jobDate}T${jobTime}`);

    const occurrenceDates = repeatJob
      ? generateOccurrenceDates(
          firstDate,
          recurrenceType,
          recurrenceInterval,
          recurrenceEndMode,
          recurrenceEndMode === 'date' ? new Date(`${recurrenceEndDate}T23:59`) : null,
          recurrenceCount
        )
      : [firstDate];

    // One combined confirmation across every occurrence x assigned
    // cleaner, rather than a popup per occurrence.
    let conflictCount = 0;
    let timeOffConflictCount = 0;
    for (const cid of formCleanerIds) {
      for (const d of occurrenceDates) {
        if (await findConflict(cid, d, duration, null)) conflictCount++;
        if (await findTimeOffConflict(cid, d)) timeOffConflictCount++;
      }
    }
    if (conflictCount > 0 || timeOffConflictCount > 0) {
      const parts = [];
      if (conflictCount > 0) parts.push(`${conflictCount} double-booking${conflictCount === 1 ? '' : 's'}`);
      if (timeOffConflictCount > 0) parts.push(`${timeOffConflictCount} clash${timeOffConflictCount === 1 ? '' : 'es'} with approved time off`);
      const proceed = await confirm(
        `This will create ${occurrenceDates.length} job${occurrenceDates.length === 1 ? '' : 's'}, including ${parts.join(' and ')}. Create anyway?`,
        { title: 'Scheduling conflicts', confirmLabel: 'Create anyway' }
      );
      if (!proceed) return;
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

    let seriesId = null;
    if (repeatJob && occurrenceDates.length > 1) {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: seriesRow } = await supabase
        .from('job_series')
        .insert({
          property_id: property.id,
          duration_minutes: duration,
          recurrence_type: recurrenceType,
          interval_count: recurrenceInterval,
          created_by: session.user.id,
        })
        .select('id')
        .single();
      seriesId = seriesRow?.id || null;
    }

    const { data: insertedJobs } = await supabase
      .from('jobs')
      .insert(occurrenceDates.map((d) => ({
        property_id: property.id,
        scheduled_at: d.toISOString(),
        duration_minutes: duration,
        series_id: seriesId,
      })))
      .select('id, scheduled_at, status, duration_minutes, series_id, properties(address, clients(name))');

    if (insertedJobs && insertedJobs.length > 0) {
      const assignmentsByJob = {};
      if (formCleanerIds.length > 0) {
        const { data: allAssignments } = await supabase
          .from('job_assignments')
          .insert(insertedJobs.flatMap((j) => formCleanerIds.map((cid) => ({ job_id: j.id, cleaner_id: cid }))))
          .select('job_id, cleaner_id, profiles(full_name)');

        (allAssignments || []).forEach((a) => {
          if (!assignmentsByJob[a.job_id]) assignmentsByJob[a.job_id] = [];
          assignmentsByJob[a.job_id].push(a);
        });
      }

      const fullJobs = insertedJobs.map((j) => ({ ...j, job_assignments: assignmentsByJob[j.id] || [] }));
      const inWeek = fullJobs.filter((j) => {
        const jd = new Date(j.scheduled_at);
        return jd >= weekStart && jd < addDays(weekStart, 7);
      });
      if (inWeek.length > 0) {
        setJobs((prev) => [...prev, ...inWeek].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)));
      }

      // One notification per cleaner for the series, not one per
      // occurrence - avoids spamming e.g. 8 "new shift" alerts at once.
      const firstJob = insertedJobs[0];
      formCleanerIds.forEach((cid) => {
        notify({ type: 'shift_assigned', cleanerId: cid, address: firstJob.properties?.address, scheduledAt: firstJob.scheduled_at });
      });

      const template = templates.find((t) => t.id === formTemplateId);
      if (template && template.job_template_items.length > 0) {
        await supabase.from('tasks').insert(
          insertedJobs.flatMap((j) => template.job_template_items.map((item) => ({ job_id: j.id, description: item.description })))
        );
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

  const minutesToTop = (minutes) => (minutes / 60 - START_HOUR) * HOUR_HEIGHT;

  const formatMinutesOfDay = (minutes) =>
    new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Where a job would land if it were let go right now: the column under
  // the pointer picks the day, and the block's own grab point - not the
  // pointer - picks the time, so it drops where it looks like it will.
  const dragPositionFor = (clientX, clientY, grabOffsetY, duration) => {
    const cols = dayColRefs.current;
    if (!cols.some(Boolean)) return null;

    let dayIndex = cols.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right;
    });
    if (dayIndex === -1) {
      const first = cols.find(Boolean).getBoundingClientRect();
      dayIndex = clientX < first.left ? 0 : cols.length - 1;
    }

    const rect = cols[dayIndex].getBoundingClientRect();
    const rawMinutes = ((clientY - rect.top - grabOffsetY) / HOUR_HEIGHT + START_HOUR) * 60;
    const snapped = Math.round(rawMinutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
    // Keep at least the first hour of the job on the grid, so a job dragged
    // off the bottom doesn't vanish past midnight.
    const latestStart = (END_HOUR - START_HOUR) * 60 - Math.min(duration, 60);
    return { dayIndex, minutes: Math.min(Math.max(snapped, 0), latestStart) };
  };

  const updateDragPreview = () => {
    const session = pointerSessionRef.current;
    if (!session) return;
    const next = dragPositionFor(session.lastX, session.lastY, session.grabOffsetY, session.duration);
    if (!next) return;
    setDrag((prev) =>
      prev && prev.dayIndex === next.dayIndex && prev.minutes === next.minutes
        ? prev
        : { jobId: session.jobId, ...next }
    );
  };

  // Holding a job near the top or bottom edge keeps the calendar scrolling,
  // so a 7am job can be moved to 9pm without ever letting go of it.
  const runEdgeScroll = () => {
    const el = calendarScrollRef.current;
    if (el && edgeScrollRef.current !== 0) {
      el.scrollTop += edgeScrollRef.current;
      updateDragPreview();
    }
    edgeScrollFrameRef.current = requestAnimationFrame(runEdgeScroll);
  };

  const stopEdgeScroll = () => {
    edgeScrollRef.current = 0;
    if (edgeScrollFrameRef.current) {
      cancelAnimationFrame(edgeScrollFrameRef.current);
      edgeScrollFrameRef.current = null;
    }
  };

  const clearHoldTimer = () => {
    const session = pointerSessionRef.current;
    if (session && session.holdTimer) {
      clearTimeout(session.holdTimer);
      session.holdTimer = null;
    }
  };

  const activateDrag = () => {
    const session = pointerSessionRef.current;
    if (!session || session.active) return;
    session.active = true;
    session.holdTimer = null;
    setPendingJobId(null);
    updateDragPreview();
    edgeScrollFrameRef.current = requestAnimationFrame(runEdgeScroll);
  };

  const detachPointerListeners = () => {
    const listeners = windowListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.up);
    window.removeEventListener('pointercancel', listeners.up);
    windowListenersRef.current = null;
  };

  // The listeners go on the window rather than the block, because a drag
  // routinely ends over a different day column than it started in. They
  // dispatch through a ref so a mid-drag re-render can't strand them on an
  // old closure - or leave them attached once the drag is over.
  const attachPointerListeners = () => {
    detachPointerListeners();
    const move = (e) => pointerHandlersRef.current.move(e);
    const up = (e) => pointerHandlersRef.current.up(e);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    windowListenersRef.current = { move, up };
  };

  // `anchorTop` is where the job's own slot actually starts on screen. For a
  // normal card that's the element under the pointer, but inside a grouped
  // clash block the row you grabbed sits wherever the list put it, not on
  // the job's start time - so the block passes the real edge in and the drop
  // lands where the clock says rather than where the text happens to be.
  const handleJobPointerDown = (e, job, anchorTop) => {
    if (e.button !== undefined && e.button > 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const top = anchorTop === undefined ? rect.top : anchorTop;
    const draggable = job.status === 'scheduled';
    const session = {
      jobId: job.id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      draggable,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      grabOffsetY: e.clientY - top,
      duration: job.duration_minutes || 120,
      active: false,
      panning: false,
      holdTimer: null,
    };
    pointerSessionRef.current = session;
    attachPointerListeners();

    if (draggable && e.pointerType !== 'mouse') {
      setPendingJobId(job.id);
      session.holdTimer = setTimeout(activateDrag, TOUCH_HOLD_MS);
    }
  };

  const handlePointerMove = (e) => {
    const session = pointerSessionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;

    if (session.active) {
      if (e.cancelable) e.preventDefault();
      session.lastX = e.clientX;
      session.lastY = e.clientY;
      updateDragPreview();

      const el = calendarScrollRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + EDGE_SCROLL_ZONE) edgeScrollRef.current = -EDGE_SCROLL_SPEED;
        else if (e.clientY > r.bottom - EDGE_SCROLL_ZONE) edgeScrollRef.current = EDGE_SCROLL_SPEED;
        else edgeScrollRef.current = 0;
      }
      return;
    }

    if (
      !session.panning
      && Math.abs(e.clientX - session.startX) < DRAG_MOVE_THRESHOLD
      && Math.abs(e.clientY - session.startY) < DRAG_MOVE_THRESHOLD
    ) return;

    if (session.pointerType === 'mouse') {
      session.lastX = e.clientX;
      session.lastY = e.clientY;
      if (session.draggable) activateDrag();
      return;
    }

    // A finger that moves before the hold completes was trying to scroll.
    // Draggable blocks opt out of the browser's own touch scrolling (they
    // have to, to be draggable at all), so pan the calendar by hand for
    // those. The rest still scroll natively - panning them too would move
    // the calendar twice as far as the finger.
    session.panning = true;
    clearHoldTimer();
    setPendingJobId(null);
    if (session.draggable) {
      const el = calendarScrollRef.current;
      if (el) {
        el.scrollTop -= e.clientY - session.lastY;
        el.scrollLeft -= e.clientX - session.lastX;
      }
    }
    session.lastX = e.clientX;
    session.lastY = e.clientY;
  };

  const handlePointerUp = (e) => {
    const session = pointerSessionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;

    const released = e.type === 'pointerup';
    if (released) {
      session.lastX = e.clientX;
      session.lastY = e.clientY;
    }

    clearHoldTimer();
    detachPointerListeners();
    stopEdgeScroll();
    pointerSessionRef.current = null;
    setPendingJobId(null);
    setDrag(null);

    if (session.active) {
      // A cancelled pointer (a system gesture taking over, say) leaves the
      // job where it started rather than committing a half-meant move.
      if (!released) return;
      const target = dragPositionFor(session.lastX, session.lastY, session.grabOffsetY, session.duration);
      if (target) moveJobTo(session.jobId, target.dayIndex, target.minutes);
      return;
    }

    const movedFar =
      Math.abs(session.lastX - session.startX) > DRAG_MOVE_THRESHOLD
      || Math.abs(session.lastY - session.startY) > DRAG_MOVE_THRESHOLD;
    if (released && !session.panning && !movedFar) {
      const job = jobs.find((j) => j.id === session.jobId);
      if (job) setSelectedJob(job);
    }
  };

  useEffect(() => {
    pointerHandlersRef.current = { move: handlePointerMove, up: handlePointerUp };
  });

  useEffect(() => () => {
    detachPointerListeners();
    clearHoldTimer();
    stopEdgeScroll();
  }, []);

  // Commits a dragged job to its new slot. Runs the same conflict and time
  // off checks as editing the time by hand, so a drag can't quietly create
  // a double-booking or land someone in the middle of their holiday. The
  // job row is what every cleaner's own rota reads from, so saving here is
  // what moves the shift on their side too.
  // Tells everyone on the job that its time changed. Fire-and-forget, like
  // the new-shift alert - a failed email must never undo a saved move.
  // Returns how many people were told, so the confirmation can say so.
  const notifyShiftMoved = (job, previousAt, newAt) => {
    const assignments = job.job_assignments || [];
    assignments.forEach((a) => {
      notify({
        type: 'shift_rescheduled',
        cleanerId: a.cleaner_id,
        jobId: job.id,
        address: job.properties?.address,
        previousAt,
        scheduledAt: newAt,
      });
    });
    return assignments.length;
  };

  const moveJobTo = async (jobId, dayIndex, minutes) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    const newDate = new Date(weekDays[dayIndex]);
    newDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

    const previousAt = job.scheduled_at;
    if (newDate.getTime() === new Date(previousAt).getTime()) return;

    for (const a of job.job_assignments || []) {
      const conflict = await findConflict(a.cleaner_id, newDate, job.duration_minutes || 120, job.id);
      if (conflict) {
        const proceed = await confirm(
          `${a.profiles?.full_name || 'This cleaner'} is already booked at ${conflict.properties?.address} around this time (${new Date(conflict.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}). Move anyway?`,
          { title: 'Scheduling conflict', confirmLabel: 'Move anyway' }
        );
        if (!proceed) return;
      }
      if (!(await confirmTimeOffConflict(a.cleaner_id, newDate))) return;
    }

    // Show the new time straight away and put it back if the save fails -
    // waiting on the round trip makes the block visibly snap back first.
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, scheduled_at: newDate.toISOString() } : j)));

    const { data, error } = await supabase
      .from('jobs')
      .update({ scheduled_at: newDate.toISOString() })
      .eq('id', jobId)
      .select(JOB_SELECT)
      .single();

    if (error) {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, scheduled_at: previousAt } : j)));
      toast.error('Could not move this job.');
      return;
    }

    setJobs((prev) => prev.map((j) => (j.id === data.id ? { ...j, ...data } : j)));
    setSelectedJob((sj) => (sj && sj.id === data.id ? { ...sj, ...data } : sj));

    const told = notifyShiftMoved(data, previousAt, newDate.toISOString());
    toast.success(
      `Moved to ${newDate.toLocaleDateString(undefined, { weekday: 'short' })} ${formatMinutesOfDay(minutes)}.`
      + (told > 0 ? ` ${told} cleaner${told === 1 ? '' : 's'} notified.` : '')
    );
  };

  const jobsForDay = (day) =>
    jobs.filter((j) => {
      const d = new Date(j.scheduled_at);
      return d.toDateString() === day.toDateString();
    });

  const todayKey = new Date().toDateString();
  const isCurrentWeek = weekStart.getTime() === getMonday(new Date()).getTime();

  // What an admin opens the rota to find out: is this week covered?
  const weekStats = useMemo(() => ({
    total: jobs.length,
    hours: jobs.reduce((sum, j) => sum + (j.duration_minutes || 120), 0) / 60,
    completed: jobs.filter((j) => j.status === 'completed').length,
    unassigned: jobs.filter((j) => (j.job_assignments || []).length === 0).length,
    missed: jobs.filter((j) => j.status === 'missed').length,
  }), [jobs]);

  // Vertical offset of the current-time line, or null when "now" is outside
  // the hours the grid draws (or before the clock has started on the client).
  const nowOffset = (() => {
    if (!now) return null;
    const hourFloat = now.getHours() + now.getMinutes() / 60;
    if (hourFloat < START_HOUR || hourFloat > END_HOUR) return null;
    return (hourFloat - START_HOUR) * HOUR_HEIGHT;
  })();

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const availableToAdd = selectedJob
    ? cleaners.filter((c) => !(selectedJob.job_assignments || []).some((a) => a.cleaner_id === c.id))
    : [];

  // One job, drawn on the clock. `dragging` swaps the job's own start time
  // for the one under the pointer, so the block follows the drag. `layout`
  // narrows the card to one lane of an opened-out overlap, so jobs that
  // share an hour sit beside each other instead of on top.
  const renderJobCard = (job, dragging, layout) => {
    const { top, height } = jobPosition(job);
    const duration = job.duration_minutes || 120;
    const startMinutes = dragging ? drag.minutes : minutesOfDayFor(job);
    const names = assignedNames(job);
    const unassigned = names.length === 0;
    const blockHeight = Math.max(height, 34);
    const lines = linesForHeight(blockHeight);
    const isDraggable = job.status === 'scheduled';
    const clientName = job.properties?.clients?.name || job.properties?.address || 'Unknown client';
    const timeLabel = `${formatClock(startMinutes)} – ${formatClock(startMinutes + duration)}`;

    // The lanes this card holds, of however many the group needs. The 5px
    // either side is the gutter an ungrouped card already leaves, kept so a
    // lane of one looks no different from an ordinary block.
    const laneStyle = layout && layout.lanes > 1
      ? {
        left: `calc(${(layout.lane / layout.lanes) * 100}% + 5px)`,
        width: `calc(${((layout.span || 1) / layout.lanes) * 100}% - 10px)`,
        right: 'auto',
      }
      : null;

    // The two states an admin is scanning for get a word as well as a
    // colour; the rest are read off the fill.
    const pill = job.status === 'completed' ? 'Completed' : unassigned ? 'Unassigned' : null;
    const staffLabel = unassigned
      ? 'Needs a cleaner'
      : job.status === 'in_progress'
        ? `${names.join(', ')} · on site`
        : names.join(', ');

    return (
      <div
        key={job.id}
        className={[
          'calendar-job',
          job.status,
          selectedJob?.id === job.id ? 'selected' : '',
          isDraggable ? 'draggable' : '',
          dragging ? 'dragging' : '',
          pendingJobId === job.id ? 'drag-pending' : '',
          unassigned ? 'unassigned' : '',
          isCompactHeight(blockHeight) ? 'compact' : '',
          // Three or more abreast, the padding is worth more as characters
          // of the client's name than as whitespace.
          layout && layout.lanes >= 3 ? 'is-narrow-lane' : '',
        ].filter(Boolean).join(' ')}
        style={{ top: dragging ? minutesToTop(drag.minutes) : top, height: blockHeight, ...laneStyle }}
        onPointerDown={(e) => handleJobPointerDown(e, job)}
        // Four jobs sharing an hour leave a card too narrow to read a client
        // name off, and the whole point of opening the run out is to see what
        // is in it. Hovering says in full what the card had to cut.
        title={layout
          ? `${timeLabel} · ${clientName} · ${staffLabel}${isDraggable ? ' - drag to move, or click to open' : ''}`
          : isDraggable ? 'Drag to a new day or time - press and hold first on a touchscreen' : undefined}
      >
        {lines === 1 ? (
          <div className="calendar-job-time calendar-job-oneline">
            {formatClock(startMinutes)} · {clientName}
          </div>
        ) : (
          <>
            <div className="calendar-job-time">
              {timeLabel}{job.status === 'missed' ? ' · missed' : ''}
            </div>
            <div className="calendar-job-client">{clientName}</div>
            {lines >= 3 && (
              <div className={`calendar-job-staff${unassigned ? ' is-unassigned' : ''}`}>
                {staffLabel}
              </div>
            )}
            {pill && blockHeight >= 104 && (
              <span className="wf-pill calendar-job-pill">{pill}</span>
            )}
          </>
        )}
      </div>
    );
  };

  // Jobs that share a slice of clock are drawn as one block listing each
  // start time, rather than as bars stacked on top of each other where the
  // one underneath can't be read or clicked at all. The same cleaner twice
  // over isn't a drawing problem but a mistake, so that block turns red and
  // names whose diary is clashing.
  const renderClashBlock = (group) => {
    const startMinutes = group.start.getHours() * 60 + group.start.getMinutes();
    const top = Math.max(0, (startMinutes / 60 - START_HOUR) * HOUR_HEIGHT);
    const span = ((group.end - group.start) / 3600000) * HOUR_HEIGHT;
    const expanded = expandedGroupId === group.id;

    // Opened out, the group stops being a list and goes back on the clock:
    // each job at its own start time, at its own length, in a lane beside
    // the ones it shares an hour with. That is the view the block was
    // standing in for - the list only exists because bars drawn straight
    // onto the clock would cover one another.
    if (expanded) {
      const { lanes, placed } = assignLanes(group.jobs);
      return (
        <Fragment key={group.id}>
          <button
            type="button"
            className={`calendar-clash-collapse${group.doubleBooked ? ' is-double-booked' : ''}`}
            style={{ top: Math.max(0, top - 15) }}
            onClick={() => setExpandedGroupId(null)}
            title="Close these back into one block"
          >
            {group.doubleBooked
              ? `${abbreviateName(group.doubleBookedName)} · double-booked · show less`
              : `${group.jobs.length} jobs · show less`}
          </button>
          {placed.map(({ job, lane, span }) => renderJobCard(job, false, { lane, lanes, span }))}
        </Fragment>
      );
    }

    const shown = group.jobs.slice(0, MAX_CLASH_ENTRIES);
    // The clock alone can make the block shorter than the list inside it -
    // three half-hour jobs on top of each other span 30 minutes - and the
    // block clips what doesn't fit, which is no good when the thing at the
    // bottom is the button to the rest of them.
    const overflowing = group.jobs.length > MAX_CLASH_ENTRIES;
    const height = Math.max(span, (shown.length >= 3 ? 140 : 112) + (overflowing ? 18 : 0));

    return (
      <div
        key={group.id}
        className={`calendar-clash${group.doubleBooked ? ' is-double-booked' : ''}`}
        style={{ top, height }}
      >
        <div className="calendar-clash-head">
          {group.doubleBooked
            ? `${abbreviateName(group.doubleBookedName)} · double-booked`
            : `${group.jobs.length} jobs overlap`}
        </div>
        {shown.map((job) => {
          const names = assignedNames(job);
          const isDraggable = job.status === 'scheduled';
          return (
            <div
              key={job.id}
              className={[
                'calendar-clash-job',
                selectedJob?.id === job.id ? 'selected' : '',
                isDraggable ? 'draggable' : '',
                pendingJobId === job.id ? 'drag-pending' : '',
              ].filter(Boolean).join(' ')}
              onPointerDown={(e) => {
                const block = e.currentTarget.closest('.calendar-clash');
                const offsetInBlock = ((new Date(job.scheduled_at) - group.start) / 3600000) * HOUR_HEIGHT;
                handleJobPointerDown(
                  e,
                  job,
                  block ? block.getBoundingClientRect().top + offsetInBlock : undefined
                );
              }}
              title={isDraggable ? 'Drag to a new day or time - press and hold first on a touchscreen' : undefined}
            >
              <span className="calendar-clash-time">
                {formatClock(minutesOfDayFor(job))} · {names.length === 0 ? 'no one' : abbreviateName(names[0])}
              </span>
              <span className="calendar-clash-client">
                {job.properties?.clients?.name || job.properties?.address || 'Unknown client'}
              </span>
            </div>
          );
        })}
        {overflowing && (
          <button
            type="button"
            className="calendar-clash-more"
            aria-expanded={false}
            onClick={() => setExpandedGroupId(group.id)}
            title="Put every job in this overlap back on the clock"
          >
            +{group.jobs.length - shown.length} more
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="page-inner">
      <BackButton />
      <div className="rota-header">
        <div>
          <p className="rota-eyebrow">Rota · week view</p>
          <h1 className="rota-week">{weekLabel}</h1>
        </div>
        <div className="rota-actions">
          {/* Prev / Today / Next are one control because they do one job -
              moving through weeks. As three loose buttons they carried the
              same weight as the page's primary action. */}
          <div className="segmented" role="group" aria-label="Change week">
            <button className="segmented-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} title="Go back a week" aria-label="Previous week">‹</button>
            <button className="segmented-btn" onClick={() => setWeekStart(getMonday(new Date()))} title="Jump back to this week" disabled={isCurrentWeek}>Today</button>
            <button className="segmented-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} title="Go forward a week" aria-label="Next week">›</button>
          </div>
          <button className="btn-primary btn-compact" onClick={() => setShowForm(true)} title="Schedule a new job and assign staff to it">
            + New Job
          </button>
        </div>
      </div>

      <div className="stat-row stat-row-compact">
        <div className="stat-card stat-jobs">
          <div className="stat-number">{weekStats.total}</div>
          <div className="stat-label">Jobs</div>
          <div className="stat-sublabel">{weekStats.completed} completed</div>
        </div>
        <div className="stat-card stat-hours">
          <div className="stat-number">{weekStats.hours.toFixed(1)}</div>
          <div className="stat-label">Hours</div>
          <div className="stat-sublabel">scheduled</div>
        </div>
        <div className={`stat-card stat-unassigned${weekStats.unassigned > 0 ? ' is-alert' : ''}`}>
          <div className="stat-number">{weekStats.unassigned}</div>
          <div className="stat-label">Unassigned</div>
          <div className="stat-sublabel">no one on the job</div>
        </div>
        <div className={`stat-card stat-missed${weekStats.missed > 0 ? ' is-alert' : ''}`}>
          <div className="stat-number">{weekStats.missed}</div>
          <div className="stat-label">Missed</div>
          <div className="stat-sublabel">this week</div>
        </div>
      </div>

      <div className="calendar">
        {/* The day headings live inside the scroller and stick to its top.
            Outside it they'd be a separate grid, and the scrollbar's width
            (or a sideways scroll on a phone) would pull them out of line
            with the columns underneath. */}
        <div className="calendar-scroll" ref={calendarScrollRef}>
          <div className="calendar-header">
            <div className="calendar-hour-col" />
            {weekDays.map((day, i) => {
              const isToday = day.toDateString() === todayKey;
              return (
                <div
                  key={i}
                  className={[
                    'calendar-day-head',
                    isToday ? 'today' : '',
                    i > 4 ? 'weekend' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="calendar-day-name">{DAY_NAMES[i]}{isToday ? ' · today' : ''}</div>
                  <div className="calendar-day-date">{day.getDate()}</div>
                </div>
              );
            })}
          </div>

          <div className="calendar-body" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
            <div className="calendar-hour-col">
              {hourSlots.map((h) => (
                <div key={h} className="calendar-hour-label" style={{ height: HOUR_HEIGHT }}>
                  <span>{formatClock(h * 60)}</span>
                </div>
              ))}
            </div>

            {weekDays.map((day, i) => {
              // A job being dragged is drawn in the column it's currently
              // over, not the one it started in, so it follows the pointer
              // across days instead of leaving a copy behind. It's drawn
              // outside the grouping too - mid-drag it no longer belongs to
              // whatever it used to clash with.
              const draggedJob = drag ? jobs.find((j) => j.id === drag.jobId) : null;
              const dayJobs = jobsForDay(day).filter((j) => !drag || j.id !== drag.jobId);
              const groups = groupOverlappingJobs(dayJobs);

              const isToday = day.toDateString() === todayKey;

              return (
              <div
                key={i}
                ref={(el) => { dayColRefs.current[i] = el; }}
                className={[
                  'calendar-day-col',
                  isToday ? 'today' : '',
                  i > 4 ? 'weekend' : '',
                  drag && drag.dayIndex === i ? 'drag-over' : '',
                ].filter(Boolean).join(' ')}
              >
                {hourSlots.map((h) => (
                  <div key={h} className="calendar-hour-line" style={{ height: HOUR_HEIGHT }} />
                ))}

                {isToday && nowOffset !== null && (
                  <div className="calendar-now" style={{ top: nowOffset }} />
                )}

                {groups.map((group) => (
                  group.jobs.length === 1 ? renderJobCard(group.jobs[0]) : renderClashBlock(group)
                ))}

                {draggedJob && drag.dayIndex === i && renderJobCard(draggedJob, true)}
              </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="calendar-legend">
        {[
          ['completed', 'Completed'],
          ['in_progress', 'On site'],
          ['scheduled', 'Scheduled'],
          ['unassigned', 'Needs a cleaner'],
          ['clash', 'Double-booked or missed'],
        ].map(([key, label]) => (
          <span key={key} className="calendar-legend-item">
            <span className={`calendar-legend-swatch ${key}`} />
            {label}
          </span>
        ))}
      </div>

      <div className="calendar-foot">
        <span className="calendar-foot-hint">
          Drag a job to a new day or time. On a touchscreen, press and hold it first.
          Jobs that clash are grouped into one block with each start time listed - and
          turn red when it's the same cleaner twice over.
        </span>
        <Link href="/admin/rota/history" className="calendar-foot-link">Job history &rarr;</Link>
      </div>

      {selectedJob && (
        <div className="job-modal-overlay" onClick={() => setSelectedJob(null)}>
        <div className="card job-modal" onClick={(e) => e.stopPropagation()}>
          <div className="job-modal-head">
            <div>
              <span className={`badge ${selectedJob.status}`}>{selectedJob.status.replace('_', ' ')}</span>
              <h2>{selectedJob.properties?.address}</h2>
              <p className="job-modal-sub">
                {selectedJob.properties?.clients?.name || 'Unknown client'}
                {' · '}
                {new Date(selectedJob.scheduled_at).toLocaleString(undefined, {
                  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                })}
                {' · '}{formatDuration(selectedJob.duration_minutes || 120)}
                {selectedJob.series_id && ' · part of a recurring series'}
              </p>
            </div>
            <button className="job-modal-close" onClick={() => setSelectedJob(null)} aria-label="Close" title="Close">×</button>
          </div>

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
                  title="Enter a length that is not one of the presets"
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
                  background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
                }}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={saveJobDetails}
              disabled={savingJob}
              style={{ marginTop: 10, width: '100%' }}
              title="Save the changes to this job's date, time and length"
            >
              {savingJob ? 'Saving...' : 'Save Changes'}
            </button>
            {jobSaveError && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, marginTop: 8 }}>{jobSaveError}</p>}
          </div>

          <div style={{ marginTop: 16 }}>
            <label>Assigned staff</label>
            {(selectedJob.job_assignments || []).length === 0 && (
              <p className="empty-state" style={{ padding: '4px 0' }}>No one assigned yet.</p>
            )}
            {(selectedJob.job_assignments || []).map((a) => (
              <div key={a.cleaner_id} className="task-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14 }}>{a.profiles?.full_name || 'Unknown'}</span>
                <button className="btn-secondary" onClick={() => removeCleanerFromJob(selectedJob.id, a.cleaner_id)} title="Take this person off the job - they are told it has been unassigned">Remove</button>
              </div>
            ))}
            {availableToAdd.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <select
                  value={addCleanerSelection}
                  onChange={(e) => setAddCleanerSelection(e.target.value)}
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <option value="">Add a cleaner...</option>
                  {availableToAdd.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.id}</option>
                  ))}
                </select>
                <button
                  className="btn-primary"
                  disabled={!addCleanerSelection}
                  onClick={() => { addCleanerToJob(selectedJob.id, addCleanerSelection); setAddCleanerSelection(''); }}
                  title="Put this person on the job - they get a notification about the new shift"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          {jobCheckins.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label>Check-ins</label>
              {jobCheckins.map((c) => {
                // Only flag a missing location as "unverified" when the
                // property actually has coordinates to check against -
                // otherwise geofencing was never attempted for this job.
                const propertyHasCoords = selectedJob.properties?.lat != null && selectedJob.properties?.lng != null;
                const unverified = propertyHasCoords && (c.lat == null || c.lng == null);
                return (
                  <div key={c.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{c.profiles?.full_name || 'Unknown'}</span>
                      {unverified && <span className="badge scheduled">location unverified</span>}
                    </div>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      Checked in {new Date(c.checked_in_at).toLocaleTimeString()}
                      {c.checked_out_at && ` – out ${new Date(c.checked_out_at).toLocaleTimeString()}`}
                      {c.checked_out_at && c.auto_checked_out && ' (auto)'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {jobPhotos.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label>Photos</label>
              <div className="photo-grid">
                {jobPhotos.map((p) => (
                  <img
                    key={p.id}
                    src={p.signedUrl}
                    alt={p.caption || 'job photo'}
                    onClick={() => window.open(p.signedUrl, '_blank', 'noopener,noreferrer')}
                    style={{ cursor: 'pointer' }}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <label>To-do list</label>
            {templates.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select
                  value={applyTemplateSelection}
                  onChange={(e) => setApplyTemplateSelection(e.target.value)}
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <option value="">Apply a template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.job_template_items.length} items)</option>
                  ))}
                </select>
                <button className="btn-secondary" disabled={!applyTemplateSelection} onClick={applyTemplateToJob} title="Copy every task from the chosen template onto this job">Apply</button>
              </div>
            )}
            {jobTasks.length === 0 && (
              <p className="empty-state" style={{ padding: '4px 0' }}>No tasks yet.</p>
            )}
            {jobTasks.map((task) => (
              <div key={task.id} className={`task-row ${task.completed ? 'done' : ''}`}>
                <span style={{ flex: 1 }}>{task.description}</span>
                <button className="btn-secondary" onClick={() => deleteTask(task.id)} title="Remove this task from the job">Remove</button>
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

          {/* Deleting lives at the foot of the panel in its own bounded area.
              Sat next to Close at the top, the two read as a matching pair of
              ways to dismiss the job. */}
          <div className="job-modal-danger">
            <div>
              <p className="job-modal-danger-title">Delete this job</p>
              <p className="job-modal-danger-note">This cannot be undone.</p>
            </div>
            <div className="job-modal-danger-actions">
              {selectedJob.series_id && (
                <button className="btn-secondary" onClick={() => deleteFutureInSeries(selectedJob)} title="Delete this job and every future one in the recurring series - past ones are kept">
                  Delete this + future
                </button>
              )}
              <button className="btn-danger" onClick={() => deleteJob(selectedJob)} title="Delete just this one job - this cannot be undone">
                Delete job
              </button>
            </div>
          </div>
        </div>
        </div>
      )}
      {showForm && (
        <div className="job-modal-overlay">
        <div className="card job-form-card job-form-modal">
          <div className="job-form-header">
            <h2>New Job</h2>
            <button className="job-modal-close" onClick={() => setShowForm(false)} type="button" aria-label="Close" title="Close - keeps what you have filled in">×</button>
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
                    title="Enter a length that is not one of the presets"
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
                <label className="field-label">Checklist template (optional)</label>
                <select value={formTemplateId} onChange={(e) => setFormTemplateId(e.target.value)}>
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.job_template_items.length} items)</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label">Cleaners</label>
                {cleaners.length === 0 && <p className="empty-state" style={{ padding: '4px 0' }}>No cleaners yet.</p>}
                <div className="duration-chips">
                  {cleaners.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className={`duration-chip ${formCleanerIds.includes(c.id) ? 'active' : ''}`}
                      onClick={() => setFormCleanerIds((prev) =>
                        prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                      )}
                    >
                      {c.full_name || c.id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={repeatJob}
                    onChange={(e) => setRepeatJob(e.target.checked)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  Repeat this job
                </label>

                {repeatJob && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                    <div className="field-row">
                      <div className="field">
                        <label className="field-label">Frequency</label>
                        <select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                      <div className="field">
                        <label className="field-label">
                          Every {recurrenceInterval > 1 ? `${recurrenceInterval} ` : ''}
                          {recurrenceType === 'daily' ? `day${recurrenceInterval > 1 ? 's' : ''}` : recurrenceType === 'weekly' ? `week${recurrenceInterval > 1 ? 's' : ''}` : `month${recurrenceInterval > 1 ? 's' : ''}`}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="52"
                          value={recurrenceInterval}
                          onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value)))}
                        />
                      </div>
                    </div>

                    <label className="field-label">Ends</label>
                    <div className="field-row">
                      <div className="field">
                        <select value={recurrenceEndMode} onChange={(e) => setRecurrenceEndMode(e.target.value)}>
                          <option value="count">After a number of times</option>
                          <option value="date">On a date</option>
                        </select>
                      </div>
                      <div className="field">
                        {recurrenceEndMode === 'count' ? (
                          <input
                            type="number"
                            min="1"
                            max={MAX_OCCURRENCES}
                            value={recurrenceCount}
                            onChange={(e) => setRecurrenceCount(Math.max(1, Number(e.target.value)))}
                          />
                        ) : (
                          <input
                            type="date"
                            value={recurrenceEndDate}
                            onChange={(e) => setRecurrenceEndDate(e.target.value)}
                            required={repeatJob && recurrenceEndMode === 'date'}
                          />
                        )}
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      Capped at {MAX_OCCURRENCES} occurrences. Each one can be moved, reassigned, or deleted individually afterwards.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn-primary" title="Create this job and notify anyone you have assigned to it">Add Job</button>
            </div>
          </form>
        </div>
        </div>
      )}

    </div>
  );
}
