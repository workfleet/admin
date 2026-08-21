'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from './ToastProvider';

const KIND_LABELS = { key: 'Key', fob: 'Fob', alarm_code: 'Alarm code', other: 'Other' };

// What this cleaner is currently responsible for, and the one write they
// make against the key register: signing to confirm they were handed it.
// Returns are recorded by admin — nobody signs their own key back in.
export default function KeyHoldingsCard({ userId }) {
  const toast = useToast();
  const [holdings, setHoldings] = useState([]);
  const [signatures, setSignatures] = useState({});
  const [signing, setSigning] = useState(null);

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  const load = async () => {
    const { data } = await supabase
      .from('key_holdings')
      .select('id, issued_at, due_back_at, issue_note, acknowledged_at, acknowledged_signature, site_keys(label, kind, properties(address))')
      .eq('holder_id', userId)
      .is('returned_at', null)
      .order('issued_at', { ascending: false });

    setHoldings(data || []);
  };

  const sign = async (holding) => {
    const signature = (signatures[holding.id] || '').trim();
    if (!signature) return;
    setSigning(holding.id);

    const signedAt = new Date().toISOString();
    const { error } = await supabase
      .from('key_holdings')
      .update({ acknowledged_at: signedAt, acknowledged_signature: signature })
      .eq('id', holding.id);

    setSigning(null);
    if (error) { toast.error("Couldn't save your signature — try again."); return; }

    setHoldings((prev) =>
      prev.map((h) => (h.id === holding.id ? { ...h, acknowledged_at: signedAt, acknowledged_signature: signature } : h))
    );
    toast.success('Thanks — signed for.');
  };

  if (holdings.length === 0) return null;

  const unsigned = holdings.filter((h) => !h.acknowledged_at).length;

  return (
    <div className="card">
      <h2>Keys you're holding ({holdings.length})</h2>
      {unsigned > 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '-4px 0 10px' }}>
          Please confirm you've got {unsigned === 1 ? 'this one' : 'these'} — it goes on the record that
          {unsigned === 1 ? ' it was' : ' they were'} handed to you.
        </p>
      )}

      {holdings.map((h) => (
        <div key={h.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <KeyRound size={18} color="var(--muted)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{h.site_keys?.label}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {KIND_LABELS[h.site_keys?.kind] || 'Key'} · {h.site_keys?.properties?.address || 'Site not shown'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Given to you {new Date(h.issued_at).toLocaleDateString()}
                {h.due_back_at && ` · due back ${new Date(h.due_back_at).toLocaleDateString()}`}
              </div>
              {h.issue_note && (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                  "{h.issue_note}"
                </div>
              )}
            </div>
          </div>

          {h.acknowledged_at ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Signed for by {h.acknowledged_signature} on {new Date(h.acknowledged_at).toLocaleDateString()}
            </div>
          ) : (
            <div style={{ background: 'var(--wf-ash)', borderRadius: 10, padding: 12 }}>
              <label className="field-label">Type your full name to confirm you have this</label>
              <input
                value={signatures[h.id] || ''}
                onChange={(e) => setSignatures((prev) => ({ ...prev, [h.id]: e.target.value }))}
                placeholder="Your full name"
                style={{ marginBottom: 8 }}
              />
              <button
                type="button"
                onClick={() => sign(h)}
                disabled={signing === h.id || !(signatures[h.id] || '').trim()}
                style={{ width: '100%' }}
                title="Sign to confirm you were handed this - it goes on the record and cannot be changed afterwards"
              >
                {signing === h.id ? 'Saving...' : 'Confirm I have it'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
