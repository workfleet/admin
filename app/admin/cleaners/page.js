'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const HOLIDAY_ACCRUAL_RATE = 0.1207; // UK statutory: 5.6 weeks / 46.4 working weeks

// A job's duration is split evenly across everyone assigned to it - a
// 2-hour job with 2 people counts as 1 hour each, not 2 hours each.
function buildAssigneeCounts(assignmentRows) {
  const counts = {};
  assignmentRows.forEach((row) => {
    if (!row.jobs) return;
    counts[row.jobs.id] = (counts[row.jobs.id] || 0) + 1;
  });
  return counts;
}

function hoursWorked(cleanerId, assignmentRows, assigneeCounts) {
  return assignmentRows
    .filter((row) => row.cleaner_id === cleanerId && row.jobs?.status === 'completed')
    .reduce((sum, row) => sum + (row.jobs.duration_minutes || 0) / (assigneeCounts[row.jobs.id] || 1), 0) / 60;
}

function jobCount(cleanerId, assignmentRows) {
  return assignmentRows.filter((row) => row.cleaner_id === cleanerId).length;
}

function holidayHoursUsed(cleanerId, timeOffRequests) {
  return timeOffRequests
    .filter((t) => t.cleaner_id === cleanerId && t.type === 'holiday' && t.status === 'approved')
    .reduce((sum, t) => sum + (t.hours || 0), 0);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export default function AdminCleaners() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [cleaners, setCleaners] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);
  const [adjustmentInput, setAdjustmentInput] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('cleaner');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [justCreated, setJustCreated] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    // Managing staff accounts stays full-admin only, even though
    // supervisors can reach most of the rest of /admin - checked here
    // too, not just hidden from the nav, in case someone navigates here
    // directly by URL.
    const { data: ownProfile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (ownProfile?.role !== 'admin') { router.push('/admin'); return; }

    const [{ data: cleanersData }, { data: assignmentsData }, { data: timeOffData }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, created_at, active, holiday_adjustment_hours').in('role', ['cleaner', 'supervisor']).order('created_at'),
      supabase.from('job_assignments').select('cleaner_id, jobs(id, status, duration_minutes)'),
      supabase.from('time_off_requests').select('cleaner_id, type, status, hours'),
    ]);

    setCleaners(cleanersData || []);
    setJobs(assignmentsData || []);
    setTimeOffRequests(timeOffData || []);
    setLoading(false);
  };

  const startEditAdjustment = (cleaner) => {
    setEditingAdjustmentId(cleaner.id);
    setAdjustmentInput(String(cleaner.holiday_adjustment_hours));
  };

  const saveAdjustment = async (cleanerId) => {
    const value = parseFloat(adjustmentInput);
    if (isNaN(value)) return;

    const { data } = await supabase
      .from('profiles').update({ holiday_adjustment_hours: value }).eq('id', cleanerId)
      .select('id, holiday_adjustment_hours').single();

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleanerId ? { ...c, holiday_adjustment_hours: data.holiday_adjustment_hours } : c)));
    }
    setEditingAdjustmentId(null);
  };

  const toggleActive = async (cleaner) => {
    const nextActive = !cleaner.active;
    if (!nextActive && !(await confirm(`Deactivate ${cleaner.full_name || 'this cleaner'}? They won't be able to log in until reactivated.`, { danger: true, confirmLabel: 'Deactivate' }))) return;

    const { data, error } = await supabase
      .from('profiles').update({ active: nextActive }).eq('id', cleaner.id)
      .select('id, active').single();

    if (error) { toast.error('Could not update this account.'); return; }

    if (data) {
      setCleaners((prev) => prev.map((c) => (c.id === cleaner.id ? { ...c, active: data.active } : c)));
      toast.success(nextActive ? 'Account reactivated.' : 'Account deactivated.');
    }
  };

  const createCleaner = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/cleaners/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ full_name: newName, email: newEmail, password: newPassword, role: newRole }),
    });
    const body = await res.json().catch(() => ({}));

    setCreating(false);

    if (!res.ok) {
      setCreateError(
        body.error === 'email_taken'
          ? 'An account with this email already exists.'
          : 'Please fill in all fields (password needs at least 8 characters).'
      );
      return;
    }

    setCleaners((prev) => [...prev, body]);
    setJustCreated({ full_name: newName, email: newEmail, password: newPassword });
    setShowAddForm(false);
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewRole('cleaner');
  };

  const assigneeCounts = useMemo(() => buildAssigneeCounts(jobs), [jobs]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Cleaners</h1>
          <p className="page-subtitle">
            {cleaners.filter((c) => c.role !== 'supervisor').length} cleaner{cleaners.filter((c) => c.role !== 'supervisor').length === 1 ? '' : 's'}
            {' · '}{cleaners.filter((c) => c.role === 'supervisor').length} supervisor{cleaners.filter((c) => c.role === 'supervisor').length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowAddForm((s) => !s); setJustCreated(null); setCreateError(''); }}
          title="Create a staff account directly, without sending an onboarding invite"
        >
          {showAddForm ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {showAddForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>Add Staff</h2>
            <button className="job-form-close" type="button" onClick={() => setShowAddForm(false)}>×</button>
          </div>
          <form onSubmit={createCleaner}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Full name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-label">Role</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                  <option value="cleaner">Cleaner</option>
                  <option value="supervisor">Office Staff / Supervisor</option>
                </select>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Supervisors can manage the rota, clients, and requests like an admin, but can't manage staff accounts or see payroll.
                </p>
              </div>
              <div className="field">
                <label className="field-label">Password</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <button type="button" className="btn-secondary" onClick={() => setNewPassword(generatePassword())} title="Generate a random password for them">
                    Generate
                  </button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  You'll need to share this with them yourself — note it down before submitting.
                </p>
              </div>
            </div>
            {createError && <p style={{ color: 'var(--wf-overdue)', fontSize: 14, margin: '0 0 10px' }}>{createError}</p>}
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Adding...' : 'Add Staff'}</button>
            </div>
          </form>
        </div>
      )}

      {justCreated && (
        <div className="card" style={{ background: 'rgba(52, 199, 123, 0.10)' }}>
          <p style={{ fontSize: 13.5, margin: 0 }}>
            <strong>{justCreated.full_name}</strong> has been added. Share these login details with them directly:
          </p>
          <p style={{ fontSize: 13.5, marginTop: 8, fontFamily: 'monospace' }}>
            {justCreated.email}<br />{justCreated.password}
          </p>
        </div>
      )}

      <p className="empty-state" style={{ marginTop: showAddForm || justCreated ? 0 : -8 }}>
        Add staff directly above, or send an onboarding invite from the Onboarding page for a new cleaner to fill in their own details, ID, and contract.
      </p>

      {cleaners.length === 0 && <p className="empty-state">No staff yet.</p>}

      <div className="job-list">
        {cleaners.map((c) => {
          const worked = hoursWorked(c.id, jobs, assigneeCounts);
          const accrued = worked * HOLIDAY_ACCRUAL_RATE + (c.holiday_adjustment_hours || 0);
          const used = holidayHoursUsed(c.id, timeOffRequests);
          const remaining = accrued - used;
          const isEditingAdjustment = editingAdjustmentId === c.id;
          const cJobCount = jobCount(c.id, jobs);

          return (
            <div
              key={c.id}
              className="card job-card"
              style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer' }}
              onClick={() => router.push(`/admin/cleaners/${c.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2>
                    {c.full_name || 'Unnamed cleaner'}
                    {c.role === 'supervisor' && (
                      <span className="badge scheduled" style={{ marginLeft: 8, verticalAlign: 'middle' }}>supervisor</span>
                    )}
                  </h2>
                  <p className="job-time">
                    Joined {new Date(c.created_at).toLocaleDateString()}
                    {' · '}{cJobCount} job{cJobCount === 1 ? '' : 's'} assigned
                  </p>
                  <p className="job-time">
                    Holiday: {remaining.toFixed(1)} of {accrued.toFixed(1)} hours remaining
                    {' '}(12.07% of {worked.toFixed(1)}h worked
                    {c.holiday_adjustment_hours ? `, ${c.holiday_adjustment_hours > 0 ? '+' : ''}${c.holiday_adjustment_hours}h adjustment` : ''})
                    {' '}
                    <button
                      className="btn-secondary"
                      onClick={(e) => { e.stopPropagation(); isEditingAdjustment ? setEditingAdjustmentId(null) : startEditAdjustment(c); }}
                      style={{ padding: '2px 10px', fontSize: 12, marginLeft: 4 }}
                      title="Manually adjust this person's holiday balance up or down"
                    >
                      {isEditingAdjustment ? 'Cancel' : 'Adjust'}
                    </button>
                  </p>
                  {c.active === false && <span className="badge missed">deactivated</span>}
                </div>
                <button
                  className="btn-secondary"
                  onClick={(e) => { e.stopPropagation(); toggleActive(c); }}
                  style={{ height: 'fit-content' }}
                  title="Switch this account between active and deactivated - deactivating blocks login but keeps their history"
                >
                  {c.active === false ? 'Reactivate' : 'Deactivate'}
                </button>
              </div>

              {isEditingAdjustment && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <label style={{ margin: 0 }}>Manual adjustment (hours, +/-)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={adjustmentInput}
                    onChange={(e) => setAdjustmentInput(e.target.value)}
                    style={{ width: 80 }}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={() => saveAdjustment(c.id)} title="Save the holiday adjustment">Save</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
