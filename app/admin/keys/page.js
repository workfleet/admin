'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Undo2, Archive, History } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const KIND_LABELS = { key: 'Key', fob: 'Fob', alarm_code: 'Alarm code', other: 'Other' };
const KIND_ORDER = ['key', 'fob', 'alarm_code', 'other'];

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '');

// A due-back date that's already passed is the whole reason this page
// exists — it's the only state here that needs to shout.
const isOverdue = (holding) =>
  holding?.due_back_at && new Date(`${holding.due_back_at}T23:59:59`) < new Date();

export default function AdminKeys() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [keys, setKeys] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [properties, setProperties] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState({ property_id: '', kind: 'key', label: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const [issuingKeyId, setIssuingKeyId] = useState(null);
  const [issueForm, setIssueForm] = useState({ holder_id: '', due_back_at: '', issue_note: '' });
  const [historyKeyId, setHistoryKeyId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [{ data: keyRows }, { data: holdingRows }, { data: propertyRows }, { data: staffRows }] = await Promise.all([
      supabase
        .from('site_keys')
        .select('id, property_id, label, kind, notes, active, created_at, properties(address, clients(name))')
        .order('created_at', { ascending: true }),
      supabase
        .from('key_holdings')
        .select(
          'id, key_id, holder_id, issued_at, issue_note, due_back_at, acknowledged_at, acknowledged_signature,'
          + ' returned_at, return_note,'
          + ' holder:profiles!key_holdings_holder_id_fkey(full_name),'
          + ' issuer:profiles!key_holdings_issued_by_fkey(full_name)'
        )
        .order('issued_at', { ascending: false }),
      supabase.from('properties').select('id, address, clients(name)').order('address'),
      supabase.from('profiles').select('id, full_name').in('role', ['cleaner', 'supervisor']).eq('active', true).order('full_name'),
    ]);

    setKeys(keyRows || []);
    setHoldings(holdingRows || []);
    setProperties(propertyRows || []);
    setStaff(staffRows || []);
    setLoading(false);
  };

  const openHoldingFor = (keyId) => holdings.find((h) => h.key_id === keyId && !h.returned_at);
  const historyFor = (keyId) => holdings.filter((h) => h.key_id === keyId && h.returned_at);

  const addKey = async (e) => {
    e.preventDefault();
    if (!newKey.property_id || !newKey.label.trim()) return;
    setSaving(true);

    const { data, error } = await supabase
      .from('site_keys')
      .insert({
        property_id: newKey.property_id,
        kind: newKey.kind,
        label: newKey.label.trim(),
        notes: newKey.notes.trim() || null,
        created_by: userId,
      })
      .select('id, property_id, label, kind, notes, active, created_at, properties(address, clients(name))')
      .single();

    setSaving(false);
    if (error || !data) { toast.error("Couldn't add that key."); return; }

    setKeys((prev) => [...prev, data]);
    setNewKey({ property_id: '', kind: 'key', label: '', notes: '' });
    setShowAddForm(false);
    toast.success('Key added to the register.');
  };

  const startIssue = (keyId) => {
    setIssuingKeyId(issuingKeyId === keyId ? null : keyId);
    setIssueForm({ holder_id: '', due_back_at: '', issue_note: '' });
  };

  const issueKey = async (e, key) => {
    e.preventDefault();
    if (!issueForm.holder_id) return;
    setSaving(true);

    const { data, error } = await supabase
      .from('key_holdings')
      .insert({
        key_id: key.id,
        holder_id: issueForm.holder_id,
        issued_by: userId,
        due_back_at: issueForm.due_back_at || null,
        issue_note: issueForm.issue_note.trim() || null,
      })
      .select(
        'id, key_id, holder_id, issued_at, issue_note, due_back_at, acknowledged_at, acknowledged_signature,'
        + ' returned_at, return_note,'
        + ' holder:profiles!key_holdings_holder_id_fkey(full_name),'
        + ' issuer:profiles!key_holdings_issued_by_fkey(full_name)'
      )
      .single();

    setSaving(false);
    if (error || !data) { toast.error("Couldn't issue that key — it may already be out."); return; }

    setHoldings((prev) => [data, ...prev]);
    setIssuingKeyId(null);
    toast.success(`Issued to ${data.holder?.full_name || 'staff member'}. They'll be asked to sign for it.`);
  };

  const returnKey = async (key, holding) => {
    const ok = await confirm(
      `Mark "${key.label}" as handed back by ${holding.holder?.full_name || 'this staff member'}?`,
      { title: 'Record return' }
    );
    if (!ok) return;

    const { error } = await supabase
      .from('key_holdings')
      .update({ returned_at: new Date().toISOString(), returned_to: userId })
      .eq('id', holding.id);

    if (error) { toast.error("Couldn't record that return."); return; }

    setHoldings((prev) =>
      prev.map((h) => (h.id === holding.id ? { ...h, returned_at: new Date().toISOString() } : h))
    );
    toast.success('Return recorded.');
  };

  const retireKey = async (key) => {
    if (openHoldingFor(key.id)) {
      toast.error("That key is still out — record it back in first.");
      return;
    }
    const ok = await confirm(
      `Retire "${key.label}"? It stays on the record with its full history, but can't be issued again.`,
      { title: 'Retire key', danger: true }
    );
    if (!ok) return;

    const { error } = await supabase.from('site_keys').update({ active: false }).eq('id', key.id);
    if (error) { toast.error("Couldn't retire that key."); return; }

    setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, active: false } : k)));
    toast.success('Key retired.');
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const activeKeys = keys.filter((k) => k.active);
  const outNow = activeKeys
    .map((key) => ({ key, holding: openHoldingFor(key.id) }))
    .filter((row) => row.holding)
    .sort((a, b) => (isOverdue(b.holding) ? 1 : 0) - (isOverdue(a.holding) ? 1 : 0));

  const propertiesWithKeys = properties.filter((p) => keys.some((k) => k.property_id === p.id));

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Key Register</h1>
          <p className="page-subtitle">
            Every key, fob and access code issued — who holds it now, and the signed handover trail
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((s) => !s)}
          title={showAddForm ? 'Close the form without adding anything' : 'Add a new key, fob or access code to the register'}
        >
          {showAddForm ? 'Cancel' : 'Add Key'}
        </button>
      </div>

      {showAddForm && (
        <form className="card" onSubmit={addKey} style={{ marginBottom: 16 }}>
          <h2>Add a key</h2>
          <div className="field">
            <label className="field-label">Site</label>
            <select
              value={newKey.property_id}
              onChange={(e) => setNewKey({ ...newKey, property_id: e.target.value })}
              required
            >
              <option value="">Choose a site...</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clients?.name ? `${p.clients.name} — ` : ''}{p.address}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Type</label>
            <select value={newKey.kind} onChange={(e) => setNewKey({ ...newKey, kind: e.target.value })}>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Label</label>
            <input
              value={newKey.label}
              onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
              placeholder="e.g. Front door key #2, Alarm code (main panel)"
              required
            />
          </div>
          <div className="field">
            <label className="field-label">Notes (optional)</label>
            <input
              value={newKey.notes}
              onChange={(e) => setNewKey({ ...newKey, notes: e.target.value })}
              placeholder="e.g. Yale, blue tag. Opens side gate too"
            />
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
            Don't write the actual alarm code or key-safe number here. The register records who
            was given it and when it was handed back — the code itself stays out of the system.
          </p>
          <button
            type="submit"
            disabled={saving}
            title="Save this key to the register - it starts off in the office, not issued to anyone"
          >
            {saving ? 'Saving...' : 'Add Key'}
          </button>
        </form>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Out now ({outNow.length})</h2>
        {outNow.length === 0 && <p className="empty-state">Every key is accounted for.</p>}
        {outNow.map(({ key, holding }) => (
          <div key={key.id} className="task-row" style={{ justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <KeyRound size={18} color={isOverdue(holding) ? 'var(--wf-overdue)' : 'var(--muted)'} style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {holding.holder?.full_name || 'Unknown holder'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {key.label} · {key.properties?.address}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Since {formatDate(holding.issued_at)}
                  {holding.due_back_at && ` · due back ${formatDate(holding.due_back_at)}`}
                  {holding.acknowledged_at
                    ? ` · signed for by ${holding.acknowledged_signature}`
                    : ' · not signed for yet'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {isOverdue(holding) && <span className="badge missed">Overdue</span>}
              {!holding.acknowledged_at && <span className="badge scheduled">Unsigned</span>}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => returnKey(key, holding)}
                style={{ padding: '8px 10px' }}
                aria-label="Record return" title="Record this key as handed back to the office"
              >
                <Undo2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {propertiesWithKeys.length === 0 && (
        <p className="empty-state">No keys on the register yet. Add the first one above.</p>
      )}

      {propertiesWithKeys.map((property) => {
        const propertyKeys = keys.filter((k) => k.property_id === property.id);
        return (
          <div key={property.id} className="card" style={{ marginBottom: 16 }}>
            <h2>{property.address}</h2>
            {property.clients?.name && (
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '-4px 0 10px' }}>{property.clients.name}</p>
            )}

            {propertyKeys.map((key) => {
              const holding = openHoldingFor(key.id);
              const history = historyFor(key.id);
              return (
                <div key={key.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, opacity: key.active ? 1 : 0.5 }}>
                        {key.label}
                        <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {KIND_LABELS[key.kind]}</span>
                        {!key.active && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · retired</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                        {holding
                          ? `Held by ${holding.holder?.full_name || 'unknown'} since ${formatDate(holding.issued_at)}`
                          : 'In the office'}
                      </div>
                      {key.notes && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{key.notes}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                      {key.active && !holding && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => startIssue(key.id)}
                          title={issuingKeyId === key.id ? 'Close without issuing' : 'Hand this key to a staff member - they will be asked to sign for it'}
                        >
                          {issuingKeyId === key.id ? 'Cancel' : 'Issue'}
                        </button>
                      )}
                      {key.active && holding && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => returnKey(key, holding)}
                          aria-label="Record return" title="Record this key as handed back to the office"
                          style={{ padding: '8px 10px' }}
                        >
                          <Undo2 size={16} />
                        </button>
                      )}
                      {history.length > 0 && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setHistoryKeyId(historyKeyId === key.id ? null : key.id)}
                          aria-label="History" title="Show everyone who has held this key"
                          style={{ padding: '8px 10px' }}
                        >
                          <History size={16} />
                        </button>
                      )}
                      {key.active && !holding && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => retireKey(key)}
                          aria-label="Retire key" title="Retire this key — keeps its history, stops it being issued again"
                          style={{ padding: '8px 10px' }}
                        >
                          <Archive size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {issuingKeyId === key.id && (
                    <form onSubmit={(e) => issueKey(e, key)} style={{ background: 'var(--wf-ash)', borderRadius: 10, padding: 12 }}>
                      <div className="field">
                        <label className="field-label">Issue to</label>
                        <select
                          value={issueForm.holder_id}
                          onChange={(e) => setIssueForm({ ...issueForm, holder_id: e.target.value })}
                          required
                        >
                          <option value="">Choose a staff member...</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>{s.full_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label className="field-label">Due back (optional)</label>
                        <input
                          type="date"
                          value={issueForm.due_back_at}
                          onChange={(e) => setIssueForm({ ...issueForm, due_back_at: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label">Note (optional)</label>
                        <input
                          value={issueForm.issue_note}
                          onChange={(e) => setIssueForm({ ...issueForm, issue_note: e.target.value })}
                          placeholder="e.g. Handed over at the office, on the blue fob"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        style={{ width: '100%' }}
                        title="Sign this key out to the chosen person and notify them to confirm they have it"
                      >
                        {saving ? 'Issuing...' : 'Issue Key'}
                      </button>
                    </form>
                  )}

                  {historyKeyId === key.id && (
                    <div style={{ background: 'var(--wf-ash)', borderRadius: 10, padding: 12 }}>
                      {history.map((h) => (
                        <div key={h.id} style={{ fontSize: 12.5, color: 'var(--muted)', padding: '3px 0' }}>
                          {h.holder?.full_name || 'Unknown'} · {formatDate(h.issued_at)} → {formatDate(h.returned_at)}
                          {h.acknowledged_at ? ` · signed ${h.acknowledged_signature}` : ' · never signed for'}
                          {h.return_note && ` · ${h.return_note}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
