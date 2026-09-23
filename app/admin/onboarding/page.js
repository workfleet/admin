'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { notify } from '../../../lib/notify';
import { CONTRACT_DEFAULTS, PAY_FREQUENCIES, termsSummary } from '../../../lib/staffContract';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

export default function AdminOnboarding() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [invites, setInvites] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [justCreatedLink, setJustCreatedLink] = useState(null);
  const [justCreatedEmail, setJustCreatedEmail] = useState(null);
  const [userId, setUserId] = useState(null);

  // Everything the office fills in before sending the link: the contract
  // terms this hire is being offered, and a head start on their own details.
  // The rate is left blank until pricing_settings has been read, so the
  // field doesn't flash a stale £13 and get sent as one.
  const emptyForm = {
    expectedName: '',
    expectedEmail: '',
    jobTitle: CONTRACT_DEFAULTS.jobTitle,
    hourlyRate: '',
    payFrequency: CONTRACT_DEFAULTS.payFrequency,
    startDate: '',
    reportsTo: CONTRACT_DEFAULTS.reportsTo,
    expectedAddress: '',
    expectedPhone: '',
    expectedDob: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [standardRate, setStandardRate] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [docUrl, setDocUrl] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [contractUrl, setContractUrl] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    // Onboarding involves reviewing ID documents and other sensitive
    // personal data - stays full-admin only, checked here too in case
    // someone navigates here directly by URL rather than via the nav.
    const { data: ownProfile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (ownProfile?.role !== 'admin') { router.push('/admin'); return; }
    setUserId(session.user.id);

    const { data: invitesData } = await supabase
      .from('staff_invites')
      .select(`
        id, token, expected_name, email, status, created_at, expires_at,
        job_title, hourly_rate, pay_frequency, start_date, reports_to
      `)
      .order('created_at', { ascending: false });

    const { data: submissionsData } = await supabase
      .from('staff_onboarding_submissions')
      .select('*');

    // The rate a new cleaner is normally started on is already a setting -
    // the one the quote calculator costs jobs at. The form offers it rather
    // than making the office remember it, and it stays editable per hire.
    const { data: pricing } = await supabase
      .from('pricing_settings')
      .select('cleaner_hourly_pay')
      .limit(1)
      .maybeSingle();
    const rate = pricing?.cleaner_hourly_pay ?? CONTRACT_DEFAULTS.hourlyRate;
    setStandardRate(String(rate));
    setForm((f) => (f.hourlyRate === '' ? { ...f, hourlyRate: String(rate) } : f));

    setInvites(invitesData || []);
    setSubmissions(submissionsData || []);
    setLoading(false);
  };

  const updateForm = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const createInvite = async (e) => {
    e.preventDefault();

    const rate = Number(form.hourlyRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter the hourly pay rate for this contract.');
      return;
    }

    const { data, error } = await supabase
      .from('staff_invites')
      .insert({
        expected_name: form.expectedName.trim() || null,
        email: form.expectedEmail.trim(),
        created_by: userId,
        job_title: form.jobTitle.trim() || CONTRACT_DEFAULTS.jobTitle,
        hourly_rate: rate,
        pay_frequency: form.payFrequency,
        start_date: form.startDate || null,
        reports_to: form.reportsTo.trim() || null,
        expected_address: form.expectedAddress.trim() || null,
        expected_phone: form.expectedPhone.trim() || null,
        expected_date_of_birth: form.expectedDob || null,
      })
      .select(`
        id, token, expected_name, email, status, created_at, expires_at,
        job_title, hourly_rate, pay_frequency, start_date, reports_to
      `)
      .single();

    if (error || !data) {
      toast.error('Could not create the invite. Check the details and try again.');
      return;
    }

    setInvites((prev) => [data, ...prev]);
    const link = `${window.location.origin}/onboard/${data.token}`;
    setJustCreatedLink(link);
    setJustCreatedEmail(data.email);
    notify({ type: 'staff_invite', email: data.email, link, expectedName: data.expected_name });

    setForm({ ...emptyForm, hourlyRate: standardRate });
    setShowForm(false);
  };

  const deleteInvite = async (id) => {
    if (!(await confirm('Delete this invite? If it was already used, their submitted details will be deleted too.', { danger: true }))) return;
    const { error } = await supabase.from('staff_invites').delete().eq('id', id);
    if (error) { toast.error('Could not delete the invite.'); return; }
    setInvites((prev) => prev.filter((i) => i.id !== id));
    setSubmissions((prev) => prev.filter((s) => s.invite_id !== id));
    if (justCreatedLink) setJustCreatedLink(null);
    toast.success('Invite deleted.');
  };

  const copyLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/onboard/${token}`);
  };

  const submissionFor = (inviteId) => submissions.find((s) => s.invite_id === inviteId);

  const toggleExpand = async (invite) => {
    const submission = submissionFor(invite.id);
    if (!submission) return;

    if (expandedId === invite.id) {
      setExpandedId(null);
      setDocUrl(null);
      setContractUrl(null);
      return;
    }

    setExpandedId(invite.id);
    setDocUrl(null);
    setContractUrl(null);

    if (submission.id_document_path) {
      setDocLoading(true);
      const { data } = await supabase.storage
        .from('staff-documents')
        .createSignedUrl(submission.id_document_path, 300);
      setDocUrl(data?.signedUrl || null);
      setDocLoading(false);
    }

    // The same PDF that's sitting in their Documents tab - fetched through
    // the library rather than kept on the submission, so there's one copy
    // and deleting it from Documents doesn't leave a dead link here.
    if (submission.contract_document_id) {
      const { data: document } = await supabase
        .from('company_documents')
        .select('storage_path')
        .eq('id', submission.contract_document_id)
        .maybeSingle();
      if (document?.storage_path) {
        const { data } = await supabase.storage
          .from('company-documents')
          .createSignedUrl(document.storage_path, 300);
        setContractUrl(data?.signedUrl || null);
      }
    }
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Onboarding</h1>
          <p className="page-subtitle">Invite links for new starters to complete their details, ID, and contract</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowForm((s) => !s); setJustCreatedLink(null); }}
          title={showForm ? 'Close the form' : 'Create an invite link for a new starter to set up their own account'}
        >
          {showForm ? 'Cancel' : '+ New Invite'}
        </button>
      </div>

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Starter Invite</h2>
            <button className="job-form-close" type="button" onClick={() => setShowForm(false)}>×</button>
          </div>
          <form onSubmit={createInvite}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Name</label>
                <input
                  value={form.expectedName}
                  onChange={updateForm('expectedName')}
                  placeholder="e.g. Sam Taylor"
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input
                  type="email"
                  value={form.expectedEmail}
                  onChange={updateForm('expectedEmail')}
                  placeholder="e.g. sam@example.com"
                  required
                />
              </div>

              <h3 style={{ fontSize: 14, margin: '6px 0 0' }}>Contract terms</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '-2px 0 0' }}>
                These are written into the contract they sign. They can read them, but not change them.
              </p>
              <div className="field">
                <label className="field-label">Job title</label>
                <input
                  value={form.jobTitle}
                  onChange={updateForm('jobTitle')}
                  placeholder={CONTRACT_DEFAULTS.jobTitle}
                />
              </div>
              <div className="field">
                <label className="field-label">Hourly pay (£)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.hourlyRate}
                  onChange={updateForm('hourlyRate')}
                  required
                />
              </div>
              <div className="field">
                <label className="field-label">Paid</label>
                <select value={form.payFrequency} onChange={updateForm('payFrequency')}>
                  {PAY_FREQUENCIES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Start date (optional)</label>
                <input type="date" value={form.startDate} onChange={updateForm('startDate')} />
              </div>
              <div className="field">
                <label className="field-label">Reports to</label>
                <input
                  value={form.reportsTo}
                  onChange={updateForm('reportsTo')}
                  placeholder={CONTRACT_DEFAULTS.reportsTo}
                />
              </div>

              <h3 style={{ fontSize: 14, margin: '6px 0 0' }}>Their details (optional)</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '-2px 0 0' }}>
                Anything you fill in here is already on the form when they open the link, and they can correct it.
              </p>
              <div className="field">
                <label className="field-label">Home address</label>
                <input value={form.expectedAddress} onChange={updateForm('expectedAddress')} />
              </div>
              <div className="field">
                <label className="field-label">Phone</label>
                <input type="tel" value={form.expectedPhone} onChange={updateForm('expectedPhone')} />
              </div>
              <div className="field">
                <label className="field-label">Date of birth</label>
                <input type="date" value={form.expectedDob} onChange={updateForm('expectedDob')} />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" title="Create the invite and email them a link to set up their own account">Send Invite</button>
            </div>
          </form>
        </div>
      )}

      {justCreatedLink && (
        <div className="card">
          <p style={{ fontSize: 13.5, margin: '0 0 8px' }}>
            Invite emailed to <strong>{justCreatedEmail}</strong>. You can also share the link directly:
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, fontSize: 13.5, wordBreak: 'break-all' }}>{justCreatedLink}</div>
            <button
              className="btn-secondary"
              onClick={() => copyLink(justCreatedLink.split('/onboard/')[1])}
              title="Copy this link so you can send it to them yourself"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {invites.length === 0 && <p className="empty-state">No invites sent yet.</p>}

      <div className="job-list">
        {invites.map((invite) => {
          const submission = submissionFor(invite.id);
          const isExpanded = expandedId === invite.id;
          const expired = new Date(invite.expires_at) < new Date() && invite.status === 'pending';

          return (
            <div key={invite.id} className="card">
              <div className="page-header-row" style={{ marginBottom: isExpanded ? 12 : 0 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{invite.expected_name || submission?.full_name || 'Unnamed invite'}</h2>
                  <p className="job-time">
                    {invite.email && `${invite.email} · `}
                    Created {new Date(invite.created_at).toLocaleDateString()}
                    {invite.status === 'pending' && !expired && ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`}
                  </p>
                  <p className="job-time">{termsSummary(invite)}</p>
                  <span className={`badge ${expired ? 'missed' : invite.status === 'submitted' ? 'completed' : 'scheduled'}`}>
                    {expired ? 'expired' : invite.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {invite.status === 'pending' && !expired && (
                    <button className="btn-secondary" onClick={() => copyLink(invite.token)} title="Copy this invite link so you can send it to them yourself">Copy Link</button>
                  )}
                  {submission && (
                    <button className="btn-secondary" onClick={() => toggleExpand(invite)} title="Show or hide the details they submitted">
                      {isExpanded ? 'Hide details' : 'View details'}
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => deleteInvite(invite.id)} title="Delete this invite - the link stops working immediately">Delete</button>
                </div>
              </div>

              {isExpanded && submission && (
                <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                  <div className="task-row"><strong style={{ width: 160 }}>Full name</strong><span>{submission.full_name}</span></div>
                  {submission.date_of_birth && <div className="task-row"><strong style={{ width: 160 }}>Date of birth</strong><span>{submission.date_of_birth}</span></div>}
                  {submission.address && <div className="task-row"><strong style={{ width: 160 }}>Address</strong><span>{submission.address}</span></div>}
                  {submission.phone && <div className="task-row"><strong style={{ width: 160 }}>Phone</strong><span>{submission.phone}</span></div>}
                  {submission.email && <div className="task-row"><strong style={{ width: 160 }}>Email</strong><span>{submission.email}</span></div>}
                  {submission.ni_number && <div className="task-row"><strong style={{ width: 160 }}>NI number</strong><span>{submission.ni_number}</span></div>}
                  {submission.emergency_contact_name && (
                    <div className="task-row">
                      <strong style={{ width: 160 }}>Emergency contact</strong>
                      <span>{submission.emergency_contact_name}{submission.emergency_contact_phone ? ` · ${submission.emergency_contact_phone}` : ''}</span>
                    </div>
                  )}
                  <div className="task-row">
                    <strong style={{ width: 160 }}>ID document</strong>
                    <span>
                      {docLoading && 'Loading...'}
                      {!docLoading && docUrl && <a href={docUrl} target="_blank" rel="noreferrer">View document</a>}
                      {!docLoading && !docUrl && !submission.id_document_path && 'Not provided'}
                    </span>
                  </div>
                  <div className="task-row">
                    <strong style={{ width: 160 }}>Signed</strong>
                    <span>"{submission.signed_name}" on {new Date(submission.signed_at).toLocaleString()}</span>
                  </div>
                  <div className="task-row">
                    <strong style={{ width: 160 }}>Signed contract</strong>
                    <span>
                      {contractUrl && <a href={contractUrl} target="_blank" rel="noreferrer">Open PDF</a>}
                      {!contractUrl && (submission.contract_document_id
                        ? 'Loading...'
                        : 'Not filed - the contract they agreed to is on this record, but no PDF was produced.')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
