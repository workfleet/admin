'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { flattenPrivate } from '../../../../lib/profilePrivate';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';
import { claimFor, describeClockRecord, indexClaims, lateMinutes } from '../../../../lib/clockIn';
import { STAFF_DETAIL_FIELDS, detailsToForm, formToDetails, formatDateOnly, missingEssentials } from '../../../../lib/staffDetails';
import { countsAgainstCleaner, outcomeLabel } from '../../../../lib/missedShiftOutcomes';
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
  const [claimIndex, setClaimIndex] = useState(() => new Map());
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editingAdjustment, setEditingAdjustment] = useState(false);
  const [adjustmentInput, setAdjustmentInput] = useState('');

  const [docUrl, setDocUrl] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  const [details, setDetails] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState(() => detailsToForm(null));
  const [savingDetails, setSavingDetails] = useState(false);

  const [removing, setRemoving] = useState(false);

  // The account itself - name, login email, role, password. Email comes from
  // the admin API route, since auth.users is not readable from the browser.
  const [email, setEmail] = useState(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ full_name: '', email: '', role: 'cleaner', password: '' });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [handedPassword, setHandedPassword] = useState(null);
  const [removedEmail, setRemovedEmail] = useState(null);

  const [certifications, setCertifications] = useState([]);
  const [isAddingCert, setIsAddingCert] = useState(false);
  const [newCertName, setNewCertName] = useState('');
  const [newCertExpiry, setNewCertExpiry] = useState('');
  const [newCertNotes, setNewCertNotes] = useState('');

  const [reliability, setReliability] = useState(null);
  // Why each missed shift went unpaid (0093), by job - so a client's
  // cancellation is named as such in the history and kept out of the score.
  const [missedOutcomes, setMissedOutcomes] = useState({});
  // The same rows with their jobs, newest first - this person's absence
  // record, as the office recorded it.
  const [absences, setAbsences] = useState([]);

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
      .select('id, full_name, role, created_at, active, profile_private(holiday_adjustment_hours, deactivated_at)')
      .eq('id', id)
      .single()
      .then((res) => ({ ...res, data: flattenPrivate(res.data) }));

    if (!cleanerData) { router.push('/admin/cleaners'); return; }

    fetch(`/api/admin/cleaners/${id}/account`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setEmail(body?.email ?? null))
      .catch(() => setEmail(null));

    const { data: assignmentRows } = await supabase
      .from('job_assignments')
      .select('job_id, paid_minutes, paid_minutes_reason, jobs(id, scheduled_at, status, duration_minutes, properties(address))')
      .eq('cleaner_id', id);

    const jobIds = (assignmentRows || []).map((r) => r.job_id);
    const { data: allAssignmentsForJobs } = jobIds.length > 0
      ? await supabase.from('job_assignments').select('job_id').in('job_id', jobIds)
      : { data: [] };

    const assigneeCounts = {};
    (allAssignmentsForJobs || []).forEach((r) => { assigneeCounts[r.job_id] = (assigneeCounts[r.job_id] || 0) + 1; });

    const jobsData = (assignmentRows || [])
      .map((r) => ({ ...r.jobs, assigneeCount: assigneeCounts[r.job_id] || 1, paid_minutes: r.paid_minutes ?? null, paid_minutes_reason: r.paid_minutes_reason || null }))
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

    // The living record of their details (staff_details, 0092) - present
    // for anyone who has filled it in or been filled in by the office,
    // whichever way they joined. Queried on its own rather than embedded
    // on profiles so that nothing else on this page depends on it.
    const { data: detailsData } = await supabase
      .from('staff_details')
      .select('phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone, start_date, updated_at')
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
      .select('id, job_id, cleaner_id, checked_in_at, checked_out_at, auto_checked_out, self_declared, closed_at_booked_end, jobs(scheduled_at, properties(address))')
      .eq('cleaner_id', id)
      .order('checked_in_at', { ascending: false });

    // Only needed to tell "they told us and we agreed" from "we recorded it
    // for them". Bounded to this cleaner, so one extra query rather than one
    // per row - see describeClockRecord in lib/clockIn.js.
    const { data: claimRows } = await supabase
      .from('missed_clockin_claims')
      .select('job_id, cleaner_id, status, raised_by_admin')
      .eq('cleaner_id', id);

    const { data: outcomeRows } = await supabase
      .from('missed_shift_outcomes')
      .select('job_id, outcome, decided_at, jobs(scheduled_at, properties(address))')
      .eq('cleaner_id', id)
      .order('decided_at', { ascending: false });
    const outcomeByJob = {};
    (outcomeRows || []).forEach((o) => { outcomeByJob[o.job_id] = o.outcome; });
    setAbsences((outcomeRows || []).filter((o) => o.jobs)
      .sort((a, b) => new Date(b.jobs.scheduled_at) - new Date(a.jobs.scheduled_at)));

    // A missed shift counts against completion unless the office has
    // recorded a reason that is not theirs - a cancellation, sickness,
    // being turned away. A no-show, or nothing recorded, still counts.
    const pastJobs = jobsData.filter((j) => j.status === 'completed'
      || (j.status === 'missed' && countsAgainstCleaner(outcomeByJob[j.id])));
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
    setMissedOutcomes(outcomeByJob);
    setCheckins(checkinsData || []);
    setClaimIndex(indexClaims(claimRows || []));
    setCertifications(certsData || []);
    setReliability(computeReliability(pastJobs, completedJobIds, checkinsData || [], photoRows || [], ratingRows || []));
    setTimeOffRequests(timeOffData || []);
    setSubmission(submissionData || null);
    setDetails(detailsData || null);
    setDetailsForm(detailsToForm(detailsData));
    setReminders(remindersData || []);
    setLoading(false);
  };

  const startEditDetails = () => {
    setDetailsForm(detailsToForm(details));
    setEditingDetails(true);
  };

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from('staff_details')
      .upsert({
        profile_id: id,
        ...formToDetails(detailsForm),
        updated_at: new Date().toISOString(),
        updated_by: session.user.id,
      }, { onConflict: 'profile_id' })
      .select('phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone, start_date, updated_at')
      .single();
    setSavingDetails(false);

    if (error || !data) { toast.error("Couldn't save their details. Please try again."); return; }
    setDetails(data);
    setEditingDetails(false);
    toast.success('Details saved.');
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

  const startEditAccount = () => {
    setAccountForm({ full_name: cleaner.full_name || '', email: email || '', role: cleaner.role === 'supervisor' ? 'supervisor' : 'cleaner', password: '' });
    setAccountError('');
    setHandedPassword(null);
    setEditingAccount(true);
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setAccountForm((f) => ({ ...f, password: pw }));
  };

  // Only what changed is sent, so an untouched field cannot overwrite
  // anything. A new password is shown once afterwards for handing over,
  // the same way the create form does it.
  const saveAccount = async (e) => {
    e.preventDefault();
    setAccountError('');
    const changes = {};
    if (accountForm.full_name.trim() !== (cleaner.full_name || '')) changes.full_name = accountForm.full_name.trim();
    if (accountForm.email.trim().toLowerCase() !== (email || '').toLowerCase()) changes.email = accountForm.email.trim();
    if (accountForm.role !== cleaner.role) changes.role = accountForm.role;
    if (accountForm.password) changes.password = accountForm.password;
    if (Object.keys(changes).length === 0) { setEditingAccount(false); return; }

    if (changes.role === 'supervisor' && !(await confirm(
      `Make ${accountForm.full_name || 'this person'} a supervisor? They will be able to manage the rota, clients and requests like an admin, but not staff accounts or payroll.`,
      { title: 'Change role', confirmLabel: 'Make supervisor' }
    ))) return;

    setSavingAccount(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/cleaners/${id}/account`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(changes),
    });
    const body = await res.json().catch(() => ({}));
    setSavingAccount(false);

    if (!res.ok) {
      setAccountError({
        email_taken: 'Another account already uses that email.',
        bad_email: 'That does not look like an email address.',
        password_too_short: 'The password needs at least 8 characters.',
        name_required: 'A name is needed.',
      }[body.error] || 'Could not update the account. Please try again.');
      return;
    }

    setCleaner((c) => ({ ...c, full_name: body.full_name, role: body.role }));
    setEmail(body.email);
    setHandedPassword(body.password_changed ? changes.password : null);
    setEditingAccount(false);
    toast.success('Account updated.');
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
      .from('profile_private').update({ holiday_adjustment_hours: value, updated_at: new Date().toISOString() }).eq('profile_id', id)
      .select('profile_id, holiday_adjustment_hours').single();

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

  // Their own figure for a job where the office set one (0094), else the
  // even split - the same rule as lib/hoursWorked.js and the database.
  const worked = jobs
    .filter((j) => j.status === 'completed')
    .reduce((sum, j) => sum + (j.paid_minutes != null ? j.paid_minutes : (j.duration_minutes || 0) / j.assigneeCount), 0) / 60;
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
            <p className="job-time" style={{ marginTop: 4 }}>
              Joined {new Date(cleaner.created_at).toLocaleDateString()}
              {email ? ` · ${email}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => (editingAccount ? setEditingAccount(false) : startEditAccount())} title="Change their name, login email, role, or set a new password">
              {editingAccount ? 'Cancel' : 'Edit Account'}
            </button>
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

        {editingAccount && (
          <form onSubmit={saveAccount} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}>
            <div className="field">
              <label className="field-label">Full name</label>
              <input value={accountForm.full_name} onChange={(e) => setAccountForm((f) => ({ ...f, full_name: e.target.value }))} required autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Login email</label>
              <input type="email" value={accountForm.email} onChange={(e) => setAccountForm((f) => ({ ...f, email: e.target.value }))} placeholder={email === null ? 'Loading...' : ''} />
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                Changing this changes what they sign in with. Tell them.
              </p>
            </div>
            <div className="field">
              <label className="field-label">Role</label>
              <select value={accountForm.role} onChange={(e) => setAccountForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="cleaner">Cleaner</option>
                <option value="supervisor">Office Staff / Supervisor</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">New password (leave blank to keep theirs)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={accountForm.password}
                  onChange={(e) => setAccountForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  style={{ flex: 1, marginBottom: 0 }}
                />
                <button type="button" className="btn-secondary" onClick={generatePassword} title="Generate a random password for them">Generate</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                Setting one signs them in with it straight away. You&apos;ll need to pass it on yourself - it is shown once after saving.
              </p>
            </div>
            {accountError && <p style={{ color: 'var(--wf-overdue)', fontSize: 14, margin: '0 0 10px' }}>{accountError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setEditingAccount(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={savingAccount}>{savingAccount ? 'Saving...' : 'Save Account'}</button>
            </div>
          </form>
        )}

        {handedPassword && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(52, 199, 123, 0.10)' }}>
            <p style={{ fontSize: 13.5, margin: 0 }}>
              New password set for <strong>{cleaner.full_name}</strong>. Share it with them directly - it will not be shown again:
            </p>
            <p style={{ fontSize: 13.5, marginTop: 8, marginBottom: 0, fontFamily: 'monospace' }}>{email}<br />{handedPassword}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Personal Details</h2>
          <button
            className="btn-secondary"
            onClick={() => (editingDetails ? setEditingDetails(false) : startEditDetails())}
            title="Edit their phone, address, date of birth, NI number and emergency contact - they can also keep these up to date themselves from My Profile"
          >
            {editingDetails ? 'Cancel' : (details ? 'Edit' : 'Add Details')}
          </button>
        </div>

        {editingDetails ? (
          <form onSubmit={saveDetails}>
            {STAFF_DETAIL_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label className="field-label">{f.label}</label>
                <input
                  type={f.type}
                  value={detailsForm[f.key]}
                  onChange={(e) => setDetailsForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete={f.autoComplete || 'off'}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn-secondary" onClick={() => setEditingDetails(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={savingDetails} title="Save these details against this person">
                {savingDetails ? 'Saving...' : 'Save Details'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {!details && (
              <p className="empty-state" style={{ marginBottom: 8 }}>
                No details on file yet. Add them here, or ask {cleaner.full_name ? cleaner.full_name.split(' ')[0] : 'them'} to fill in My Profile in their app.
              </p>
            )}
            {details && missingEssentials(details).length > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--wf-graphite)', margin: '0 0 8px' }}>
                Still missing: {missingEssentials(details).join(', ')}.
              </p>
            )}
            {details && (
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.9 }}>
                {details.phone && <div>Phone: <a href={`tel:${details.phone.replace(/\s+/g, '')}`} style={{ color: 'var(--ink)' }}>{details.phone}</a></div>}
                {details.address && <div>Address: <span style={{ color: 'var(--ink)' }}>{details.address}</span></div>}
                {details.date_of_birth && <div>Date of birth: <span style={{ color: 'var(--ink)' }}>{formatDateOnly(details.date_of_birth)}</span></div>}
                {details.ni_number && <div>NI number: <span style={{ color: 'var(--ink)' }}>{details.ni_number}</span></div>}
                {(details.emergency_contact_name || details.emergency_contact_phone) && (
                  <div>
                    Emergency contact:{' '}
                    <span style={{ color: 'var(--ink)' }}>{details.emergency_contact_name}</span>
                    {details.emergency_contact_phone && (
                      <>
                        {details.emergency_contact_name ? ' · ' : ''}
                        <a href={`tel:${details.emergency_contact_phone.replace(/\s+/g, '')}`} style={{ color: 'var(--ink)' }}>{details.emergency_contact_phone}</a>
                      </>
                    )}
                  </div>
                )}
                {details.start_date && <div>Started: <span style={{ color: 'var(--ink)' }}>{formatDateOnly(details.start_date)}</span></div>}
                {details.updated_at && (
                  <div style={{ fontSize: 12, marginTop: 2 }}>Last updated {new Date(details.updated_at).toLocaleDateString()}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {submission && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Onboarding Record</h2>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.9 }}>
            <div>Contract signed {new Date(submission.signed_at).toLocaleDateString()}{submission.email ? ` as ${submission.email}` : ''}</div>
            <div style={{ fontSize: 12.5 }}>
              What they gave us on the day is kept as signed. Their current details are in the card above.
            </div>
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
        <h2>Absences ({absences.length})</h2>
        {absences.length === 0 ? (
          <p className="empty-state">No absences recorded.</p>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 6px' }}>
              {Object.entries(absences.reduce((acc, a) => { acc[a.outcome] = (acc[a.outcome] || 0) + 1; return acc; }, {}))
                .map(([k, n]) => `${n} ${outcomeLabel(k).toLowerCase()}`).join(' · ')}
              {' '}— only &ldquo;did not turn up&rdquo; counts against the reliability score.
            </p>
            {absences.map((a) => (
              <div key={a.job_id} className="task-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14 }}>{a.jobs.properties?.address || 'Job'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(a.jobs.scheduled_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
                <span style={{ fontSize: 12.5, color: a.outcome === 'no_show' ? 'var(--wf-overdue)' : 'var(--muted)', fontWeight: 600 }}>{outcomeLabel(a.outcome)}</span>
              </div>
            ))}
          </>
        )}
      </div>

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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {job.status === 'missed' && missedOutcomes[job.id] && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{outcomeLabel(missedOutcomes[job.id])}</span>
              )}
              {job.status === 'completed' && job.paid_minutes != null && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }} title={job.paid_minutes_reason || 'Hours set by the office for this job'}>
                  paid {job.paid_minutes} min
                </span>
              )}
              <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
            </span>
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
                  </div>
                  {/* How this row came to exist, when that is not simply
                      "they pressed the button". */}
                  {(() => {
                    const how = describeClockRecord(c, claimFor(claimIndex, c));
                    if (!how) return null;
                    return (
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                        {how.label}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
