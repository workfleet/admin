'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';
import { SkeletonLines } from './Skeleton';

const PORTAL_URL = 'https://crewconnect-cleaning.vercel.app';

const ERRORS = {
  email_taken: 'That email already has a login - staff or another client may be using it.',
  missing_required_fields: 'Fill in a name, an email and a password of at least 8 characters.',
  password_too_short: 'The password needs at least 8 characters.',
  unauthorized: 'Only admins can manage portal logins.',
};

async function call(clientId, method, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/admin/clients/${clientId}/portal-logins`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[json.error] || 'Something went wrong - try again.');
  return json.logins || [];
}

// A readable temporary password: no 0/O or 1/l to misread over the phone.
function makePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function when(iso) {
  if (!iso) return 'Never signed in';
  return `Last signed in ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function ClientPortalLogins({ clientId, clientName }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [logins, setLogins] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // The details to pass on, shown once after a login is made or reset.
  const [handover, setHandover] = useState(null);

  const load = async () => {
    setLoadError('');
    try { setLogins(await call(clientId, 'GET')); }
    catch (e) { setLoadError(e.message); }
  };

  useEffect(() => { load(); }, [clientId]);

  const startAdd = () => {
    setName(''); setEmail(''); setPassword(makePassword()); setAdding(true); setHandover(null);
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await call(clientId, 'POST', { full_name: name, email, password });
      setLogins(next);
      setHandover({ name: name.trim(), email: email.trim().toLowerCase(), password });
      setAdding(false);
      toast.success('Portal login made.');
    } catch (err) { toast.error(err.message); }
    setBusy(false);
  };

  const resetPassword = async (login) => {
    if (!(await confirm(`Give ${login.full_name || login.email} a new password? Their old one stops working straight away.`, { title: 'New password' }))) return;
    const pw = makePassword();
    try {
      setLogins(await call(clientId, 'PATCH', { user_id: login.id, action: 'reset_password', password: pw }));
      setHandover({ name: login.full_name, email: login.email, password: pw });
      toast.success('New password set.');
    } catch (err) { toast.error(err.message); }
  };

  const toggle = async (login) => {
    const off = login.active;
    if (off && !(await confirm(`Turn off ${login.full_name || login.email}'s login? They're signed out within the hour and can't sign back in. You can turn it back on later.`, { title: 'Turn off login', danger: true }))) return;
    try {
      setLogins(await call(clientId, 'PATCH', { user_id: login.id, action: off ? 'turn_off' : 'turn_on' }));
      toast.success(off ? 'Login turned off.' : 'Login turned back on.');
    } catch (err) { toast.error(err.message); }
  };

  const copyHandover = async () => {
    const text = `Hi ${handover.name?.split(' ')[0] || ''},\n\nYou can now see your cleaning visits, reports and documents in the CrewConnect client portal.\n\nSign in at ${PORTAL_URL}\nEmail: ${handover.email}\nPassword: ${handover.password}\n\nYou can message us from the portal too.`;
    try { await navigator.clipboard.writeText(text); toast.success('Copied - paste it into an email or text.'); }
    catch { toast.error("Couldn't copy - select the details and copy them by hand."); }
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2>Portal logins</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
              People at {clientName} who can sign in to the client portal to see their visits, reports and documents, and message you.
            </p>
          </div>
          {!adding && <button type="button" onClick={startAdd}>Add login</button>}
        </div>

        {adding && (
          <form onSubmit={add} style={{ marginTop: 16 }}>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Sarah Jones" />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>Made up for you - you'll pass it on with the sign-in link. No email is sent.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" disabled={busy}>{busy ? 'Making login...' : 'Make login'}</button>
              <button type="button" className="btn-secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      {handover && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent, #e8603c)' }}>
          <h2>Send these to {handover.name || handover.email}</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
            This is the only time the password is shown. Copy it now and send it by email or text.
          </p>
          <div style={{ fontSize: 14, lineHeight: 1.7, userSelect: 'all' }}>
            <div>Sign in at <strong>{PORTAL_URL}</strong></div>
            <div>Email: <strong>{handover.email}</strong></div>
            <div>Password: <strong style={{ fontFamily: 'monospace', fontSize: 15 }}>{handover.password}</strong></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={copyHandover}>Copy message</button>
            <button type="button" className="btn-secondary" onClick={() => setHandover(null)}>Done</button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="card">
          <p style={{ marginBottom: 8 }}>{loadError}</p>
          <button type="button" className="btn-secondary" onClick={load}>Retry</button>
        </div>
      )}
      {!loadError && logins === null && <SkeletonLines />}
      {!loadError && logins?.length === 0 && <p className="empty-state">No one at {clientName} has a portal login yet.</p>}
      {logins?.length > 0 && (
        <div className="card">
          {logins.map((l) => (
            <div key={l.id} className="task-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {l.full_name || l.email}
                  {!l.active && <span className="badge" style={{ marginLeft: 8 }}>Turned off</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.email} · {when(l.last_sign_in_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {l.active && <button type="button" className="btn-secondary" onClick={() => resetPassword(l)}>New password</button>}
                <button type="button" className="btn-secondary" onClick={() => toggle(l)}>{l.active ? 'Turn off' : 'Turn back on'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
