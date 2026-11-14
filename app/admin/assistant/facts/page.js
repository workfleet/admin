'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../../lib/authGate';
import { FACT_SECTIONS, FACT_KEYS, factsMap, factsFilled } from '../../../../lib/companyFacts';
import { PageSkeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/ToastProvider';
import BackButton from '../../../components/BackButton';

// One page of answers the AI assistant treats as true: what the company
// does, its cover, how it works, who signs letters, and what it must never
// claim. Admins edit; supervisors can read.
export default function CompanyFacts() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [userId, setUserId] = useState(null);
  const [saved, setSaved] = useState({});
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { session, profile } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);
    setCanEdit(profile?.role === 'admin');
    const { data, error } = await supabase.from('company_facts').select('key, value');
    if (error) { setNotSetUp(true); setLoading(false); return; }
    const map = factsMap(data);
    setSaved(map);
    setValues(map);
    setLoading(false);
  };

  const changed = useMemo(() => FACT_KEYS.filter((k) => (values[k] || '').trim() !== (saved[k] || '')), [values, saved]);

  const save = async () => {
    if (!changed.length) return;
    setSaving(true);
    const now = new Date().toISOString();
    const rows = changed.map((key) => ({ key, value: (values[key] || '').trim(), updated_at: now, updated_by: userId }));
    const { error } = await supabase.from('company_facts').upsert(rows, { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error('Couldn\'t save. Please try again.'); return; }
    setSaved((s) => {
      const next = { ...s };
      rows.forEach((r) => { if (r.value) next[r.key] = r.value; else delete next[r.key]; });
      return next;
    });
    toast.success('Saved. Every new draft will use these.');
  };

  if (loading) return <PageSkeleton />;

  if (notSetUp) {
    return (
      <div className="page-inner">
        <BackButton />
        <h1>Company facts</h1>
        <div className="card"><p style={{ margin: 0 }}>This page isn't switched on yet. Run <code>supabase/migrations/0140_company_facts.sql</code> in Supabase, then reload.</p></div>
      </div>
    );
  }

  const filled = factsFilled(saved);

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Company facts</h1>
          <p className="page-subtitle">
            The AI assistant treats everything here as true and uses it in every draft, so fewer blanks are left for you to fill.
            Only put what is true today. {filled} of {FACT_KEYS.length} answered.
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={save} disabled={saving || !changed.length}>
            {saving ? 'Saving...' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Saved'}
          </button>
        )}
      </div>

      {!canEdit && <div className="card" style={{ marginBottom: 16 }}><p style={{ margin: 0 }}>Only admins can change these. You can read them.</p></div>}

      {FACT_SECTIONS.map((section) => (
        <div key={section.title} className="card" style={{ marginBottom: 16 }}>
          <h2>{section.title}</h2>
          {section.facts.map((f) => (
            <div key={f.key} className={`field facts-field${f.strong ? ' is-strong' : ''}`}>
              <label className="field-label" htmlFor={`fact-${f.key}`}>{f.label}</label>
              <textarea
                id={`fact-${f.key}`}
                rows={f.strong ? 3 : 2}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.hint}
                readOnly={!canEdit}
              />
              {f.strong && <p className="pj-muted ai-hint" style={{ marginTop: 4 }}>The AI is told never to state or hint at any of this, even if someone asks it to.</p>}
            </div>
          ))}
        </div>
      ))}

      {canEdit && changed.length > 0 && (
        <div className="facts-savebar">
          <span>{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</span>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      )}

      <p className="pj-muted"><Link href="/admin/assistant">Back to the AI assistant</Link></p>
    </div>
  );
}
