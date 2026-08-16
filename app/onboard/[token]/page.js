'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { POLICY_SECTIONS } from '../../../lib/companyPolicies';

// PLACEHOLDER — replace with your actual reviewed employment contract text
// before using this for real new starters. This is not legal advice and is
// not a legally reviewed contract template.
const CONTRACT_TEXT = `[PLACEHOLDER CONTRACT — replace this text with your own reviewed
employment contract before sending real invite links.]

By typing your full name below and clicking "Sign & Submit", you confirm
that the details you've provided are accurate and that you agree to the
terms of employment discussed with your employer.`;

// PLACEHOLDER — a starting point, not legal advice. Review with a solicitor
// or your usual HR guidance before using this for real staff, and fill in
// the bracketed retention period to match your actual policy.
const PRIVACY_NOTICE = `We collect the details on this form (including your
date of birth, home address, National Insurance number, and a photo of
your ID) to set you up as a member of staff, run payroll, and meet our
legal obligations as an employer.

This information is stored securely and is only accessible to admin staff
who need it for these purposes. We keep it for [RETENTION PERIOD — e.g.
the duration of your employment plus 6 years, or as required by law], after
which it is deleted. You can ask what information we hold about you, or
ask us to correct it, at any time by contacting your employer.`;

export default function OnboardPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | ready | error | done
  const [errorReason, setErrorReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    full_name: '',
    date_of_birth: '',
    address: '',
    phone: '',
    email: '',
    ni_number: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });
  const [emailLocked, setEmailLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [idFile, setIdFile] = useState(null);
  const [policiesAgreed, setPoliciesAgreed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetch(`/api/onboarding/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorReason(body.error || 'error');
          setStatus('error');
          return;
        }
        const body = await res.json();
        setForm((f) => ({
          ...f,
          full_name: body.expected_name || '',
          email: body.email || '',
        }));
        setEmailLocked(!!body.email);
        setStatus('ready');
      })
      .catch(() => {
        setErrorReason('error');
        setStatus('error');
      });
  }, [token]);

  const updateField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!policiesAgreed || !agreed || !signedName.trim()) return;

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.append(key, value));
    body.append('password', password);
    body.append('contract_text', CONTRACT_TEXT);
    body.append('signed_name', signedName.trim());
    body.append('policies_agreed', 'true');
    if (idFile) body.append('id_document', idFile);

    const res = await fetch(`/api/onboarding/${token}/submit`, { method: 'POST', body });

    setSubmitting(false);
    if (res.ok) {
      setStatus('done');
    } else {
      const respBody = await res.json().catch(() => ({}));
      const reason = respBody.error || 'error';
      if (reason === 'email_taken') {
        setFormError('An account with this email already exists. Contact your employer for help.');
      } else if (reason === 'missing_required_fields') {
        setFormError('Please fill in all required fields.');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  };

  if (status === 'loading') {
    return <div className="container"><p>Loading...</p></div>;
  }

  if (status === 'error') {
    const messages = {
      not_found: 'This invite link is not valid.',
      already_submitted: 'This invite has already been completed.',
      expired: 'This invite link has expired. Please ask for a new one.',
      error: 'Something went wrong. Please try again or ask for a new link.',
    };
    return (
      <div className="container">
        <h1>Workfleet</h1>
        <div className="card">{messages[errorReason] || messages.error}</div>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="container">
        <h1>Workfleet</h1>
        <div className="card">
          <h2>Thanks — you're all set</h2>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            Your account has been created and your details submitted. You can now log in using the
            email and password you just set. Your employer will be in touch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Welcome aboard</h1>
      <p className="login-subtitle" style={{ marginBottom: 20 }}>
        Please fill in your details, upload your ID, and sign below.
      </p>

      <div className="card" style={{ background: '#f8fafc' }}>
        <h2>How we use your information</h2>
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap', margin: 0 }}>
          {PRIVACY_NOTICE}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h2>Create Your Login</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>
            You'll use this email and password to log in to the app.
          </p>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={updateField('email')}
              readOnly={emailLocked}
              style={emailLocked ? { background: '#f1f5f9', color: 'var(--muted)' } : undefined}
              required
            />
          </div>
          <div className="field">
            <label className="field-label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />
          </div>
          <div className="field">
            <label className="field-label">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
            />
          </div>
        </div>

        <div className="card">
          <h2>Your details</h2>
          <div className="field">
            <label className="field-label">Full name</label>
            <input value={form.full_name} onChange={updateField('full_name')} required />
          </div>
          <div className="field">
            <label className="field-label">Date of birth</label>
            <input type="date" value={form.date_of_birth} onChange={updateField('date_of_birth')} />
          </div>
          <div className="field">
            <label className="field-label">Home address</label>
            <input value={form.address} onChange={updateField('address')} />
          </div>
          <div className="field">
            <label className="field-label">Phone</label>
            <input type="tel" value={form.phone} onChange={updateField('phone')} />
          </div>
          <div className="field">
            <label className="field-label">National Insurance number</label>
            <input value={form.ni_number} onChange={updateField('ni_number')} />
          </div>
          <div className="field">
            <label className="field-label">Emergency contact name</label>
            <input value={form.emergency_contact_name} onChange={updateField('emergency_contact_name')} />
          </div>
          <div className="field">
            <label className="field-label">Emergency contact phone</label>
            <input type="tel" value={form.emergency_contact_phone} onChange={updateField('emergency_contact_phone')} />
          </div>
        </div>

        <div className="card">
          <h2>ID document</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>
            A clear photo of your passport or driving licence.
          </p>
          <input type="file" accept="image/*,.pdf" onChange={(e) => setIdFile(e.target.files[0] || null)} />
        </div>

        <div className="card">
          <h2>Company Policies</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>
            Please read through how we work at CrewConnect Cleaning before you get started.
          </p>
          <div
            style={{
              border: '1px solid var(--hairline)',
              borderRadius: 10,
              maxHeight: 260,
              overflowY: 'auto',
              marginBottom: 14,
            }}
          >
            {POLICY_SECTIONS.map((policy, i) => (
              <div
                key={policy.title}
                style={{
                  padding: 14,
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                  background: '#f8fafc',
                }}
              >
                <strong style={{ fontSize: 14 }}>{policy.title}</strong>
                <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', margin: '4px 0 0', lineHeight: 1.5 }}>{policy.body}</p>
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>
            <input
              type="checkbox"
              checked={policiesAgreed}
              onChange={(e) => setPoliciesAgreed(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            I have read and agree to follow these policies
          </label>
        </div>

        <div className="card">
          <h2>Contract</h2>
          <div
            style={{
              fontSize: 13.5,
              color: 'var(--ink-soft)',
              whiteSpace: 'pre-wrap',
              background: '#f8fafc',
              border: '1px solid var(--hairline)',
              borderRadius: 10,
              padding: 14,
              maxHeight: 220,
              overflowY: 'auto',
              marginBottom: 14,
            }}
          >
            {CONTRACT_TEXT}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontWeight: 500, fontSize: 14, color: 'var(--ink)' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            I have read and agree to the above
          </label>

          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">Type your full name to sign</label>
            <input value={signedName} onChange={(e) => setSignedName(e.target.value)} required />
          </div>
        </div>

        {formError && <p style={{ color: 'crimson', fontSize: 14, marginBottom: 10 }}>{formError}</p>}

        <button type="submit" disabled={submitting || !policiesAgreed || !agreed || !signedName.trim()} style={{ width: '100%' }}>
          {submitting ? 'Submitting...' : 'Create Account & Submit'}
        </button>
      </form>
    </div>
  );
}
