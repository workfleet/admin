'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

export default function CleanerProfile() {
  const router = useRouter();
  const { id } = useParams();

  const [cleaner, setCleaner] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editingAdjustment, setEditingAdjustment] = useState(false);
  const [adjustmentInput, setAdjustmentInput] = useState('');

  const [docUrl, setDocUrl] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  const [removing, setRemoving] = useState(false);
  const [removedEmail, setRemovedEmail] = useState(null);

  const [reminders, setReminders] = useState([]);
  const [isAddingReminder, setIsAddingReminder] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState('');
  const [newReminderRecurs, setNewReminderRecurs] = useState(true);
  const [newReminderNotes, setNewReminderNotes] = useState('');

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    // Same admin-only gate as the Cleaners list this page is reached
    // from - staff records (and onboarding PII below) aren't for
    // supervisors, checked here too in case of a direct URL visit.
    const { data: ownProfile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (ownProfile?.role !== 'admin') { router.push('/admin'); return; }

    const { data: cleanerData } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at, active, holiday_adjustment_hours')
      .eq('id', id)
      .single();

    if (!cleanerData) { router.push('/admin/cleaners'); return; }

    const { data: assignmentRows } = await supabase
      .from('job_assignments')
      .select('job_id, jobs(id, scheduled_at, status, duration_minutes, properties(address))')
      .eq('cleaner_id', id);

    const jobIds = (assignmentRows || []).map((r) => r.job_id);
    const { data: allAssignmentsForJobs } = jobIds.length > 0
      ? await supabase.from('job_assignments').select('job_id').in('job_id', jobIds)
      : { data: [] };

    const assigneeCounts = {};
    (allAssignmentsForJobs || []).forEach((r) => { assigneeCounts[r.job_id] = (assigneeCounts[r.job_id] || 0) + 1; });

    const jobsData = (assignmentRows || [])
      .map((r) => ({ ...r.jobs, assigneeCount: assigneeCounts[r.job_id] || 1 }))
      .filter((j) => j.id)
      .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

    const { data: timeOffData } = await supabase
      .from('time_off_requests')
      .select('type, status, hours')
      .eq('cleaner_id', id);

    // Only present if this account came through the onboarding flow
    // rather than being added directly by an admin - no submission row
    // means there's nothing more to show here.
    const { data: submissionData } = await supabase
      .from('staff_onboarding_submissions')
      .select('date_of_birth, address, phone, email, ni_number, emergency_contact_name, emergency_contact_phone, id_document_path, signed_at')
      .eq('profile_id', id)
      .maybeSingle();

    const { data: remindersData } = await supabase
      .from('reminders')
      .select('id, due_date, recurs_yearly, notes')
      .eq('staff_id', id)
      .order('due_date', { ascending: true });

    setCleaner(cleanerData);
    setJobs(jobsData);
    setTimeOffRequests(timeOffData || []);
    setSubmission(submissionData || null);
    setReminders(remindersData || []);
    setLoading(false);
  };

  const addReminder = async (e) => {
    e.preventDefault();
    if (!newReminderDate) return;

    const { data: { session } } = await supabase.auth.getSession();
    const { data } = await supabase
      .from('reminders')
      .insert({
        staff_id: id,
        due_date: newReminderDate,
        recurs_yearly: newReminderRecurs,
        notes: newReminderNotes.trim() || null,
        created_by: session.user.id,
      })
      .select('id, due_date, recurs_yearly, notes')
      .single();

    if (data) setReminders((prev) => [...prev, data].sort((a, b) => a.due_date.localeCompare(b.due_date)));
    setNewReminderDate('');
    setNewReminderRecurs(true);
    setNewReminderNotes('');
    setIsAddingReminder(false);
  };

  const completeReminder = async (reminder) => {
    if (reminder.recurs_yearly) {
      const next = new Date(reminder.due_date);
      next.setFullYear(next.getFullYear() + 1);
      const nextDate = next.toISOString().slice(0, 10);
      const { data } = await supabase
        .from('reminders').update({ due_date: nextDate }).eq('id', reminder.id)
        .select('id, due_date, recurs_yearly, notes').single();
      if (data) setReminders((prev) => prev.map((r) => (r.id === reminder.id ? data : r)));
    } else {
      await supabase.from('reminders').delete().eq('id', reminder.id);
      setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
    }
  };

  const deleteReminder = async (reminderId) => {
    if (!confirm('Delete this reminder?')) return;
    await supabase.from('reminders').delete().eq('id', reminderId);
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
  };

  const toggleActive = async () => {
    const nextActive = !cleaner.active;
    if (!nextActive && !confirm(`Deactivate ${cleaner.full_name || 'this cleaner'}? They won't be able to log in until reactivated.`)) return;

    const { data } = await supabase
      .from('profiles').update({ active: nextActive }).eq('id', id)
      .select('id, active').single();

    if (data) setCleaner((c) => ({ ...c, active: data.active }));
  };

  const removeAccount = async () => {
    if (!confirm(
      `Remove ${cleaner.full_name || 'this account'}? This deactivates them and frees up their email so it can be reused ` +
      `for a new starter, but keeps all their job history, photos, and reports intact. This can't be easily undone.`
    )) return;

    setRemoving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/cleaners/${id}/remove`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setRemoving(false);

    if (res.ok) {
      const body = await res.json();
      setRemovedEmail(body.releasedEmail);
      setCleaner((c) => ({ ...c, active: false }));
    } else {
      alert("Couldn't remove this account. Please try again.");
    }
  };

  const startEditAdjustment = () => {
    setAdjustmentInput(String(cleaner.holiday_adjustment_hours));
    setEditingAdjustment(true);
  };

  const saveAdjustment = async () => {
    const value = parseFloat(adjustmentInput);
    if (isNaN(value)) return;

    const { data } = await supabase
      .from('profiles').update({ holiday_adjustment_hours: value }).eq('id', id)
      .select('id, holiday_adjustment_hours').single();

    if (data) setCleaner((c) => ({ ...c, holiday_adjustment_hours: data.holiday_adjustment_hours }));
    setEditingAdjustment(false);
  };

  const viewDocument = async () => {
    if (!submission?.id_document_path || docUrl) return;
    setDocLoading(true);
    const { data } = await supabase.storage
      .from('staff-documents')
      .createSignedUrl(submission.id_document_path, 300);
    setDocUrl(data?.signedUrl || null);
    setDocLoading(false);
  };

  if (loading || !cleaner) return <div className="page-inner">Loading...</div>;

  const worked = jobs
    .filter((j) => j.status === 'completed')
    .reduce((sum, j) => sum + (j.duration_minutes || 0) / j.assigneeCount, 0) / 60;
  const accrued = worked * HOLIDAY_ACCRUAL_RATE + (cleaner.holiday_adjustment_hours || 0);
  const used = timeOffRequests
    .filter((t) => t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
  const remaining = accrued - used;

  return (
    <div className="page-inner">
      <Link href="/admin/cleaners" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
        <ArrowLeft size={15} /> All staff
      </Link>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row">
          <div>
            <h1 style={{ margin: 0 }}>
              {cleaner.full_name || 'Unnamed cleaner'}
              {cleaner.role === 'supervisor' && (
                <span className="badge scheduled" style={{ marginLeft: 8, verticalAlign: 'middle' }}>supervisor</span>
              )}
              {cleaner.active === false && (
                <span className="badge missed" style={{ marginLeft: 8, verticalAlign: 'middle' }}>deactivated</span>
              )}
            </h1>
            <p className="job-time" style={{ marginTop: 4 }}>Joined {new Date(cleaner.created_at).toLocaleDateString()}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={toggleActive}>
              {cleaner.active === false ? 'Reactivate' : 'Deactivate'}
            </button>
            {cleaner.active !== false && (
              <button className="btn-secondary" onClick={removeAccount} disabled={removing}>
                {removing ? 'Removing...' : 'Remove Account'}
              </button>
            )}
          </div>
        </div>
        {removedEmail && (
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
            Removed — <strong>{removedEmail}</strong> is now free to use for a new onboarding invite.
          </p>
        )}
      </div>

      {submission && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Contact & Onboarding Details</h2>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.9 }}>
            {(submission.email || submission.phone) && (
              <div>{[submission.email, submission.phone].filter(Boolean).join(' · ')}</div>
            )}
            {submission.address && <div>{submission.address}</div>}
            {submission.date_of_birth && <div>DOB: {new Date(submission.date_of_birth).toLocaleDateString()}</div>}
            {submission.ni_number && <div>NI number: {submission.ni_number}</div>}
            {(submission.emergency_contact_name || submission.emergency_contact_phone) && (
              <div>
                Emergency contact: {[submission.emergency_contact_name, submission.emergency_contact_phone].filter(Boolean).join(' · ')}
              </div>
            )}
            <div>Contract signed {new Date(submission.signed_at).toLocaleDateString()}</div>
          </div>
          {submission.id_document_path && (
            <div style={{ marginTop: 10 }}>
              {docUrl ? (
                <a href={docUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Open ID Document
                </a>
              ) : (
                <button className="btn-secondary" onClick={viewDocument} disabled={docLoading}>
                  {docLoading ? 'Loading...' : 'View ID Document'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: editingAdjustment ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>Holiday</h2>
          <button className="btn-secondary" onClick={() => (editingAdjustment ? setEditingAdjustment(false) : startEditAdjustment())}>
            {editingAdjustment ? 'Cancel' : 'Adjust'}
          </button>
        </div>
        <p className="job-time" style={{ marginTop: editingAdjustment ? 0 : 8 }}>
          {remaining.toFixed(1)} of {accrued.toFixed(1)} hours remaining
          {' '}(12.07% of {worked.toFixed(1)}h worked
          {cleaner.holiday_adjustment_hours ? `, ${cleaner.holiday_adjustment_hours > 0 ? '+' : ''}${cleaner.holiday_adjustment_hours}h adjustment` : ''})
        </p>
        {editingAdjustment && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Manual adjustment (hours, +/-)</label>
            <input
              type="number"
              step="0.5"
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(e.target.value)}
              style={{ width: 80 }}
              autoFocus
            />
            <button className="btn-primary" onClick={saveAdjustment}>Save</button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>1:1 Reviews</h2>
        {reminders.length === 0 && !isAddingReminder && <p className="empty-state">No reminders set.</p>}

        {reminders.map((r) => {
          const overdue = new Date(r.due_date) < new Date(new Date().toDateString());
          return (
            <div key={r.id} className="task-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14 }}>
                  <span style={overdue ? { color: 'crimson', fontWeight: 600 } : { fontWeight: 600 }}>
                    {new Date(r.due_date).toLocaleDateString()}
                  </span>
                  {r.recurs_yearly && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}> · yearly</span>}
                </div>
                {r.notes && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary" onClick={() => completeReminder(r)}>
                  {r.recurs_yearly ? 'Done (reset to next year)' : 'Done'}
                </button>
                <button className="btn-secondary" onClick={() => deleteReminder(r.id)}>Delete</button>
              </div>
            </div>
          );
        })}

        {isAddingReminder ? (
          <form onSubmit={addReminder} style={{ marginTop: 12 }}>
            <label>Due date</label>
            <input type="date" value={newReminderDate} onChange={(e) => setNewReminderDate(e.target.value)} required />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={newReminderRecurs}
                onChange={(e) => setNewReminderRecurs(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Repeats yearly
            </label>
            <label>Notes (optional)</label>
            <input
              value={newReminderNotes}
              onChange={(e) => setNewReminderNotes(e.target.value)}
              placeholder="e.g. Annual review and goal-setting"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setIsAddingReminder(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Add Reminder</button>
            </div>
          </form>
        ) : (
          <button className="btn-secondary" onClick={() => setIsAddingReminder(true)} style={{ marginTop: reminders.length ? 12 : 0 }}>
            + Reminder
          </button>
        )}
      </div>

      <div className="card">
        <h2>Job History ({jobs.length})</h2>
        {jobs.length === 0 && <p className="empty-state">No jobs assigned yet.</p>}
        {jobs.map((job) => (
          <div key={job.id} className="task-row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14 }}>{job.properties?.address}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(job.scheduled_at).toLocaleString()}</div>
            </div>
            <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
