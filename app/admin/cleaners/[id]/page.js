'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';
import { lateMinutes } from '../../../../lib/clockIn';
import BackButton from '../../../components/BackButton';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

// Each sub-score is 0-100; components with no underlying data (e.g. no
// ratings yet) are left out of the average entirely rather than counted
// as 0, so a new cleaner isn't unfairly penalised before there's enough
// history to judge them on.
function computeReliability(pastJobs, completedJobIds, checkins, photoRows, ratingRows) {
  const parts = [];

  if (checkins.length > 0) {
    const onTimeCount = checkins.filter((c) => (lateMinutes(c.checked_in_at, c.jobs?.scheduled_at) ?? 0) <= 0).length;
    parts.push({ key: 'punctuality', label: 'Punctuality', score: (onTimeCount / checkins.length) * 100 });
  }

  if (pastJobs.length > 0) {
    const completedCount = pastJobs.filter((j) => j.status === 'completed').length;
    parts.push({ key: 'completion', label: 'Completion Rate', score: (completedCount / pastJobs.length) * 100 });
  }

  if (completedJobIds.length > 0) {
    const jobsWithPhotos = new Set(photoRows.map((p) => p.job_id));
    const withPhotos = completedJobIds.filter((jid) => jobsWithPhotos.has(jid)).length;
    parts.push({ key: 'photos', label: 'Photo Compliance', score: (withPhotos / completedJobIds.length) * 100 });
  }

  if (ratingRows.length > 0) {
    const avgRating = ratingRows.reduce((sum, r) => sum + r.rating, 0) / ratingRows.length;
    parts.push({ key: 'rating', label: 'Client Rating', score: (avgRating / 5) * 100, avgRating });
  }

  const overall = parts.length > 0 ? parts.reduce((sum, p) => sum + p.score, 0) / parts.length : null;
  return { overall, parts };
}

export default function CleanerProfile() {
  const router = useRouter();
  const { id } = useParams();
  const confirm = useConfirm();
  const toast = useToast();

  const [cleaner, setCleaner] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [checkins, setCheckins] = useState(null);
  const [showClockIns, setShowClockIns] = useState(false);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editingAdjustment, setEditingAdjustment] = useState(false);
  const [adjustmentInput, setAdjustmentInput] = useState('');

  const [docUrl, setDocUrl] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  const [removing, setRemoving] = useState(false);
  const [removedEmail, setRemovedEmail] = useState(null);

  const [certifications, setCertifications] = useState([]);
  const [isAddingCert, setIsAddingCert] = useState(false);
  const [newCertName, setNewCertName] = useState('');
  const [newCertExpiry, setNewCertExpiry] = useState('');
  const [newCertNotes, setNewCertNotes] = useState('');

  const [reliability, setReliability] = useState(null);

  const [reminders, setReminders] = useState([]);
  const [isAddingReminder, setIsAddingReminder] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState('');
  const [newReminderRecurs, setNewReminderRecurs] = useState(true);
  const [newReminderNotes, setNewReminderNotes] = useState('');

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    // Same admin-only gate as the Cleaners list this page is reached
    // from - staff records (and onboarding PII below) aren't for
    // supervisors, checked here too in case of a direct URL visit.
    const { data: ownProfile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (ownProfile?.role !== 'admin') { router.push('/admin'); return; }

    const { data: cleanerData } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at, active, holiday_adjustment_hours, deactivated_at')
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

    const { data: certsData } = await supabase
      .from('staff_certifications')
      .select('id, name, expiry_date, notes')
      .eq('staff_id', id)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    const { data: checkinsData } = await supabase
      .from('checkins')
      .select('id, job_id, checked_in_at, checked_out_at, auto_checked_out, jobs(scheduled_at, properties(address))')
      .eq('cleaner_id', id)
      .order('checked_in_at', { ascending: false });

    const pastJobs = jobsData.filter((j) => j.status === 'completed' || j.status === 'missed');
    const completedJobIds = jobsData.filter((j) => j.status === 'completed').map((j) => j.id);

    const [{ data: photoRows }, { data: ratingRows }] = await Promise.all([
      completedJobIds.length > 0
        ? supabase.from('photos').select('job_id').in('job_id', completedJobIds)
        : Promise.resolve({ data: [] }),
      jobIds.length > 0
        ? supabase.from('job_ratings').select('rating, job_id').in('job_id', jobIds)
        : Promise.resolve({ data: [] }),
    ]);

    setCleaner(cleanerData);
    setJobs(jobsData);
    setCheckins(checkinsData || []);
    setCertifications(certsData || []);
    setReliability(computeReliability(pastJobs, completedJobIds, checkinsData || [], photoRows || [], ratingRows || []));
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

  const addCertification = async (e) => {
    e.preventDefault();
    if (!newCertName.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    const { data } = await supabase
      .from('staff_certifications')
      .insert({
        staff_id: id,
        name: newCertName.trim(),
        expiry_date: newCertExpiry || null,
        notes: newCertNotes.trim() || null,
        created_by: session.user.id,
      })
      .select('id, name, expiry_date, notes')
      .single();

    if (data) {
      setCertifications((prev) => [...prev, data].sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999')));
    }
    setNewCertName('');
    setNewCertExpiry('');
    setNewCertNotes('');
    setIsAddingCert(false);
  };

  const deleteCertification = async (certId) => {
    if (!(await confirm('Delete this certification?', { danger: true }))) return;
    const { error } = await supabase.from('staff_certifications').delete().eq('id', certId);
    if (error) { toast.error('Could not delete the certification.'); return; }
    setCertifications((prev) => prev.filter((c) => c.id !== certId));
    toast.success('Certification deleted.');
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
    if (!(await confirm('Delete this reminder?', { danger: true }))) return;
    const { error } = await supabase.from('reminders').delete().eq('id', reminderId);
    if (error) { toast.error('Could not delete the reminder.'); return; }
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    toast.success('Reminder deleted.');
  };

  const exportCleanerData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/cleaners/${id}/export`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { toast.error("Couldn't generate the export."); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-${id}-data-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleActive = async () => {
    const nextActive = !cleaner.active;
    if (!nextActive && !(await confirm(`Deactivate ${cleaner.full_name || 'this cleaner'}? They won't be able to log in until reactivated.`, { danger: true, confirmLabel: 'Deactivate' }))) return;

    const { data, error } = await supabase
      .from('profiles').update({ active: nextActive }).eq('id', id)
      .select('id, active').single();

    if (error) { toast.error('Could not update this account.'); return; }
    if (data) {
      setCleaner((c) => ({ ...c, active: data.active }));
      toast.success(nextActive ? 'Account reactivated.' : 'Account deactivated.');
    }
  };

  const removeAccount = async () => {
    if (!(await confirm(
      `Remove ${cleaner.full_name || 'this account'}? This deactivates them and frees up their email so it can be reused ` +
      `for a new starter, but keeps all their job history, photos, and reports intact. This can't be easily undone.`,
      { title: 'Remove account', danger: true, confirmLabel: 'Remove' }
    ))) return;

    await sendRemoval(false);
  };

  const sendRemoval = async (force) => {
    setRemoving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/cleaners/${id}/remove`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    setRemoving(false);

    if (res.ok) {
      const body = await res.json();
      setRemovedEmail(body.releasedEmail);
      setCleaner((c) => ({ ...c, active: false }));
      toast.success('Account removed.');
      return;
    }

    // They still hold company keys. Removing anyway is allowed, but only
    // as a second, explicit decision with the list in front of you.
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'keys_outstanding') {
        const list = (body.keys || []).map((k) => `• ${k.label} (${k.address})`).join('\n');
        const proceed = await confirm(
          `${cleaner.full_name || 'This person'} still has company keys signed out:\n\n${list}\n\n` +
          `Record them back in on the Key Register first. Remove the account anyway?`,
          { title: 'Keys not returned', danger: true, confirmLabel: 'Remove anyway' }
        );
        if (proceed) await sendRemoval(true);
        return;
      }
    }

    toast.error("Couldn't remove this account. Please try again.");
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
      <BackButton />
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={exportCleanerData} title="Download everything held about this person as a file - use this to answer a data request">Export Data</button>
            <button className="btn-secondary" onClick={toggleActive} title="Switch this account between active and deactivated - deactivating blocks login but keeps all their history">
              {cleaner.active === false ? 'Reactivate' : 'Deactivate'}
            </button>
            {cleaner.active !== false && (
              <button className="btn-secondary" onClick={removeAccount} disabled={removing} title="Deactivate them and free up their email so a new starter can use it - their history is kept, and this is blocked while they still hold keys">
                {removing ? 'Removing...' : 'Remove Account'}
              </button>
            )}
          </div>
        </div>
        {cleaner.active === false && cleaner.deactivated_at && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 0' }}>
            Deactivated {new Date(cleaner.deactivated_at).toLocaleDateString()} - their onboarding ID and personal details will be automatically redacted on {new Date(new Date(cleaner.deactivated_at).setFullYear(new Date(cleaner.deactivated_at).getFullYear() + 6)).toLocaleDateString()} if they stay deactivated.
          </p>
        )}
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
                <button className="btn-secondary" onClick={viewDocument} disabled={docLoading} title="Open the ID document they uploaded when they onboarded">
                  {docLoading ? 'Loading...' : 'View ID Document'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Reliability Score</h2>
        {reliability?.overall === null || !reliability ? (
          <p className="empty-state">Not enough history yet to score this cleaner.</p>
        ) : (
          <>
            <p style={{ fontFamily: 'var(--wf-data)', fontSize: 28, fontWeight: 500, margin: '4px 0 10px', color: 'var(--ink)' }}>
              {reliability.overall.toFixed(0)}<span style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 600 }}> / 100</span>
            </p>
            {reliability.parts.map((p) => (
              <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span style={{ color: 'var(--muted)' }}>
                  {p.label}{p.key === 'rating' && ` (${p.avgRating.toFixed(1)}★ avg)`}
                </span>
                <strong>{p.score.toFixed(0)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Certifications</h2>
        {certifications.length === 0 && !isAddingCert && <p className="empty-state">No certifications on file.</p>}

        {certifications.map((c) => {
          const expired = c.expiry_date && new Date(c.expiry_date) < new Date(new Date().toDateString());
          const soon = c.expiry_date && !expired && new Date(c.expiry_date) < new Date(Date.now() + 30 * 86400000);
          return (
            <div key={c.id} className="task-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                {c.expiry_date && (
                  <div style={{ fontSize: 12.5, color: expired ? 'var(--wf-overdue)' : soon ? 'var(--wf-graphite)' : 'var(--muted)' }}>
                    {expired ? 'Expired' : 'Expires'} {new Date(c.expiry_date).toLocaleDateString()}
                  </div>
                )}
                {c.notes && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{c.notes}</div>}
              </div>
              <button className="btn-secondary" onClick={() => deleteCertification(c.id)} title="Delete this certification record">Delete</button>
            </div>
          );
        })}

        {isAddingCert ? (
          <form onSubmit={addCertification} style={{ marginTop: 12 }}>
            <label>Name</label>
            <input value={newCertName} onChange={(e) => setNewCertName(e.target.value)} placeholder="e.g. DBS Check" required autoFocus />
            <label>Expiry date (optional)</label>
            <input type="date" value={newCertExpiry} onChange={(e) => setNewCertExpiry(e.target.value)} />
            <label>Notes (optional)</label>
            <input value={newCertNotes} onChange={(e) => setNewCertNotes(e.target.value)} placeholder="e.g. Reference number, issuing body" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setIsAddingCert(false)}>Cancel</button>
              <button type="submit" className="btn-primary" title="Save this certification against this person">Add Certification</button>
            </div>
          </form>
        ) : (
          <button className="btn-secondary" onClick={() => setIsAddingCert(true)} style={{ marginTop: certifications.length ? 12 : 0 }} title="Record a certification or check against this person, with its expiry date">
            + Certification
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: editingAdjustment ? 12 : 0 }}>
          <h2 style={{ margin: 0 }}>Holiday</h2>
          <button className="btn-secondary" onClick={() => (editingAdjustment ? setEditingAdjustment(false) : startEditAdjustment())} title="Manually adjust their holiday balance up or down">
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
            <button className="btn-primary" onClick={saveAdjustment} title="Save the holiday adjustment">Save</button>
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
                  <span style={overdue ? { color: 'var(--wf-overdue)', fontWeight: 600 } : { fontWeight: 600 }}>
                    {new Date(r.due_date).toLocaleDateString()}
                  </span>
                  {r.recurs_yearly && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}> · yearly</span>}
                </div>
                {r.notes && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary" onClick={() => completeReminder(r)} title="Mark this reminder done - yearly ones roll forward to next year">
                  {r.recurs_yearly ? 'Done (reset to next year)' : 'Done'}
                </button>
                <button className="btn-secondary" onClick={() => deleteReminder(r.id)} title="Delete this reminder">Delete</button>
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
              <button type="submit" className="btn-primary" title="Save this reminder">Add Reminder</button>
            </div>
          </form>
        ) : (
          <button className="btn-secondary" onClick={() => setIsAddingReminder(true)} style={{ marginTop: reminders.length ? 12 : 0 }} title="Set a reminder about this person, such as a review or an expiring document">
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

      <div className="card" style={{ cursor: 'pointer' }} onClick={() => setShowClockIns((s) => !s)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Clock-in Summary</h2>
          <span style={{ fontSize: 13, color: 'var(--brand-link)', fontWeight: 600 }}>{showClockIns ? 'Hide' : 'Show'}</span>
        </div>
        {showClockIns && (
          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>
            {checkins === null && <p className="empty-state">Loading...</p>}
            {checkins?.length === 0 && <p className="empty-state">No check-ins yet.</p>}
            {checkins?.map((c) => {
              const late = lateMinutes(c.checked_in_at, c.jobs?.scheduled_at);
              return (
                <div key={c.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14 }}>{c.jobs?.properties?.address || 'Unknown property'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Scheduled {c.jobs?.scheduled_at ? new Date(c.jobs.scheduled_at).toLocaleString() : '—'}
                      </div>
                    </div>
                    {late > 0 && <span className="badge missed">{late}m late</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Clocked in {new Date(c.checked_in_at).toLocaleTimeString()}
                    {c.checked_out_at ? ` · out ${new Date(c.checked_out_at).toLocaleTimeString()}` : ' · still on site'}
                    {c.checked_out_at && c.auto_checked_out && ' (auto - left the geofence)'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
