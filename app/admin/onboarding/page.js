'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function AdminOnboarding() {
  const router = useRouter();
  const [invites, setInvites] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [expectedName, setExpectedName] = useState('');
  const [justCreatedLink, setJustCreatedLink] = useState(null);

  const [expandedId, setExpandedId] = useState(null);
  const [docUrl, setDocUrl] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: invitesData } = await supabase
      .from('staff_invites')
      .select('id, token, expected_name, status, created_at, expires_at')
      .order('created_at', { ascending: false });

    const { data: submissionsData } = await supabase
      .from('staff_onboarding_submissions')
      .select('*');

    setInvites(invitesData || []);
    setSubmissions(submissionsData || []);
    setLoading(false);
  };

  const createInvite = async (e) => {
    e.preventDefault();

    const { data } = await supabase
      .from('staff_invites')
      .insert({ expected_name: expectedName.trim() || null })
      .select('id, token, expected_name, status, created_at, expires_at')
      .single();

    if (data) {
      setInvites((prev) => [data, ...prev]);
      setJustCreatedLink(`${window.location.origin}/onboard/${data.token}`);
    }
    setExpectedName('');
    setShowForm(false);
  };

  const deleteInvite = async (id) => {
    if (!confirm('Delete this invite? If it was already used, their submitted details will be deleted too.')) return;
    await supabase.from('staff_invites').delete().eq('id', id);
    setInvites((prev) => prev.filter((i) => i.id !== id));
    setSubmissions((prev) => prev.filter((s) => s.invite_id !== id));
    if (justCreatedLink) setJustCreatedLink(null);
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
      return;
    }

    setExpandedId(invite.id);
    setDocUrl(null);

    if (submission.id_document_path) {
      setDocLoading(true);
      const { data } = await supabase.storage
        .from('staff-documents')
        .createSignedUrl(submission.id_document_path, 300);
      setDocUrl(data?.signedUrl || null);
      setDocLoading(false);
    }
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Onboarding</h1>
          <p className="page-subtitle">Invite links for new starters to complete their details, ID, and contract</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowForm((s) => !s); setJustCreatedLink(null); }}
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
                <label className="field-label">Expected name (optional)</label>
                <input
                  value={expectedName}
                  onChange={(e) => setExpectedName(e.target.value)}
                  placeholder="e.g. Sam Taylor"
                  autoFocus
                />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Generate Link</button>
            </div>
          </form>
        </div>
      )}

      {justCreatedLink && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 13.5, wordBreak: 'break-all' }}>{justCreatedLink}</div>
          <button
            className="btn-secondary"
            onClick={() => copyLink(justCreatedLink.split('/onboard/')[1])}
          >
            Copy
          </button>
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
                    Created {new Date(invite.created_at).toLocaleDateString()}
                    {invite.status === 'pending' && !expired && ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`}
                  </p>
                  <span className={`badge ${expired ? 'missed' : invite.status === 'submitted' ? 'completed' : 'scheduled'}`}>
                    {expired ? 'expired' : invite.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {invite.status === 'pending' && !expired && (
                    <button className="btn-secondary" onClick={() => copyLink(invite.token)}>Copy Link</button>
                  )}
                  {submission && (
                    <button className="btn-secondary" onClick={() => toggleExpand(invite)}>
                      {isExpanded ? 'Hide details' : 'View details'}
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => deleteInvite(invite.id)}>Delete</button>
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
