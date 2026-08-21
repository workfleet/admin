'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { SERVICE_TYPES } from '../../../../lib/quoteCalculator';
import { useToast } from '../../../components/ToastProvider';
import BackButton from '../../../components/BackButton';

const DOCUMENT_OPTIONS = [
  { value: 'contract', label: 'Contract quotes only' },
  { value: 'short', label: 'One-off quotes only' },
  { value: 'both', label: 'Both' },
];

export default function QuoteWording() {
  const router = useRouter();
  const toast = useToast();
  const [role, setRole] = useState(null);
  const [sections, setSections] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const [{ data: profile }, { data }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', session.user.id).single(),
      supabase.from('quote_template_sections').select('*').order('position'),
    ]);

    setRole(profile?.role || null);
    setSections(data || []);
    setLoading(false);
  };

  const draftFor = (section) => drafts[section.id] ?? section;

  const edit = (section, patch) => {
    setDrafts((d) => ({ ...d, [section.id]: { ...draftFor(section), ...patch } }));
  };

  const dirty = (section) => Boolean(drafts[section.id]);

  const save = async (section) => {
    const draft = draftFor(section);
    setSavingKey(section.id);

    const { data, error } = await supabase
      .from('quote_template_sections')
      .update({
        title: draft.title.trim(),
        body: draft.body,
        document: draft.document,
        service_types: draft.service_types,
        enabled: draft.enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', section.id)
      .select('*')
      .single();

    setSavingKey(null);
    if (error || !data) { toast.error('Could not save that section.'); return; }

    setSections((prev) => prev.map((s) => (s.id === data.id ? data : s)));
    setDrafts((d) => { const next = { ...d }; delete next[section.id]; return next; });
    toast.success('Saved. New quotes will use it.');
  };

  const revert = (section) => {
    setDrafts((d) => { const next = { ...d }; delete next[section.id]; return next; });
  };

  // Swaps two sections' positions. Two writes rather than a reshuffle of
  // the whole list - the positions are spaced ten apart precisely so
  // moving one thing never needs renumbering everything.
  const move = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;

    const a = sections[index];
    const b = sections[target];

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('quote_template_sections').update({ position: b.position }).eq('id', a.id),
      supabase.from('quote_template_sections').update({ position: a.position }).eq('id', b.id),
    ]);

    if (e1 || e2) { toast.error('Could not reorder those sections.'); return; }

    setSections((prev) => {
      const next = [...prev];
      next[index] = { ...b, position: a.position };
      next[target] = { ...a, position: b.position };
      return next;
    });
  };

  const counts = useMemo(() => ({
    total: sections.length,
    off: sections.filter((s) => !s.enabled).length,
  }), [sections]);

  if (loading) return <div className="page-inner">Loading...</div>;

  if (role !== 'admin') {
    return (
      <div className="page-inner">
        <BackButton />
        <p className="empty-state">Only an admin can change the wording of quotes.</p>
      </div>
    );
  }

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Quote Wording</h1>
          <p className="page-subtitle">
            {counts.total} sections{counts.off > 0 ? `, ${counts.off} switched off` : ''} — changes apply to quotes generated from now on
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--ink)' }}>Writing a section</strong>
        <div>Leave a blank line between paragraphs. Start a line with <code>## </code> for a subheading, or <code>- </code> for a bullet.</div>
        <div style={{ marginTop: 6 }}>
          <strong style={{ color: 'var(--ink)' }}>Placeholders</strong> — <code>{'{company}'}</code> your trading name,
          {' '}<code>{'{client}'}</code> who the quote is for, <code>{'{site}'}</code> the site address,
          {' '}<code>{'{initial_period}'}</code> the proposed contract length.
        </div>
        <div style={{ marginTop: 6 }}>
          Sections marked <em>built from the quote</em> take their content from the quote itself — the price, the schedule,
          the room list. You can retitle them, move them or switch them off, but there is no wording to edit.
        </div>
      </div>

      <div className="job-list">
        {sections.map((section, i) => {
          const draft = draftFor(section);
          const isDirty = dirty(section);

          return (
            <div key={section.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', opacity: draft.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label className="field-label">Section title</label>
                    <input value={draft.title} onChange={(e) => edit(section, { title: e.target.value })} />
                  </div>
                  <p className="job-time" style={{ margin: 0 }}>
                    {section.generated ? 'Built from the quote' : 'Your wording'}
                    {' · '}<code>{section.key}</code>
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary" onClick={() => move(i, -1)} disabled={i === 0} title="Move earlier in the document" style={{ padding: '2px 10px' }}>↑</button>
                    <button className="btn-secondary" onClick={() => move(i, 1)} disabled={i === sections.length - 1} title="Move later in the document" style={{ padding: '2px 10px' }}>↓</button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => edit(section, { enabled: e.target.checked })}
                      style={{ width: 'auto' }}
                    />
                    Include
                  </label>
                </div>
              </div>

              {!section.generated && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label className="field-label">Wording</label>
                  <textarea
                    value={draft.body}
                    onChange={(e) => edit(section, { body: e.target.value })}
                    rows={Math.min(18, Math.max(4, draft.body.split('\n').length + 1))}
                    style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}
                  />
                </div>
              )}

              <div className="field-row" style={{ marginTop: 8 }}>
                <div className="field">
                  <label className="field-label">Appears on</label>
                  <select value={draft.document} onChange={(e) => edit(section, { document: e.target.value })}>
                    {DOCUMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Only for these services</label>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 6 }}>
                    {SERVICE_TYPES.map((s) => {
                      const selected = draft.service_types || [];
                      const on = selected.includes(s.value);
                      return (
                        <label key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 400 }}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const next = on ? selected.filter((v) => v !== s.value) : [...selected, s.value];
                              // Empty means every service, which is what
                              // null records - clearing the last tick
                              // shouldn't hide the section everywhere.
                              edit(section, { service_types: next.length === 0 ? null : next });
                            }}
                            style={{ width: 'auto' }}
                          />
                          {s.label}
                        </label>
                      );
                    })}
                    {!draft.service_types && <span style={{ fontSize: 13, color: 'var(--muted)' }}>(all)</span>}
                  </div>
                </div>
              </div>

              {isDirty && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                  <button className="btn-secondary" onClick={() => revert(section)}>Discard</button>
                  <button className="btn-primary" onClick={() => save(section)} disabled={savingKey === section.id}>
                    {savingKey === section.id ? 'Saving...' : 'Save Section'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
