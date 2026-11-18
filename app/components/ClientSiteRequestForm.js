'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Two client requests that name a site (0148):
//   supplies   - "running low on toilet roll and soap at Unit 4"
//   extra_work - "can you do the windows / a deep clean", which the office
//                can turn into a quote the client accepts in the portal.
// They land in admin Requests > Client requests like any other request.

export const SUPPLY_ITEMS = [
  'Toilet roll', 'Hand soap', 'Paper towels', 'Bin bags', 'Washing-up liquid',
  'Dishwasher tablets', 'Hand sanitiser', 'Cleaning cloths',
];

export default function ClientSiteRequestForm({ kind, clientId, sites, defaultSite, onSent, onCancel }) {
  const onlyOne = sites && sites.length === 1;
  const [propertyId, setPropertyId] = useState(defaultSite || (onlyOne ? sites[0].id : ''));
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const isSupplies = kind === 'supplies';
  const toggle = (item) => setItems((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  const canSend = propertyId && (isSupplies ? items.length > 0 || text.trim() : text.trim());

  const send = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const description = isSupplies
      ? [items.join(', '), text.trim()].filter(Boolean).join(' - ')
      : text.trim();
    const { data, error: insertError } = await supabase
      .from('client_requests')
      .insert({
        client_id: clientId,
        kind,
        property_id: propertyId,
        items: isSupplies ? items : [],
        preferred_date: !isSupplies && preferredDate ? preferredDate : null,
        description,
        created_by: session?.user?.id,
      })
      .select('id, description, status, resolution_note, created_at')
      .single();
    setSending(false);
    if (insertError || !data) { setError("That didn't send - please try again."); return; }
    onSent?.(data);
  };

  return (
    <form onSubmit={send}>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
        {isSupplies
          ? 'Tick what\'s running low and we\'ll bring more on the next visit.'
          : 'Tell us what you need - a deep clean, windows, carpets, an extra visit - and we\'ll send you a price to accept here.'}
      </p>

      {!onlyOne && (
        <div className="field">
          <label className="field-label" htmlFor={`${kind}-site`}>Site</label>
          <select id={`${kind}-site`} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
            <option value="">Choose a site</option>
            {(sites || []).map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
          </select>
        </div>
      )}

      {isSupplies && (
        <div className="supply-items">
          {SUPPLY_ITEMS.map((item) => (
            <label key={item} className={`supply-item${items.includes(item) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={items.includes(item)} onChange={() => toggle(item)} />
              {item}
            </label>
          ))}
        </div>
      )}

      <label className="field-label" htmlFor={`${kind}-text`}>{isSupplies ? 'Anything else? (optional)' : 'What would you like done?'}</label>
      <textarea
        id={`${kind}-text`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isSupplies ? 'e.g. Air freshener for the toilets' : 'e.g. A deep clean of the kitchen before an inspection'}
        rows={3}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
          background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', margin: '4px 0 10px', resize: 'vertical',
        }}
      />

      {!isSupplies && (
        <div className="field">
          <label className="field-label" htmlFor="extra-date">Ideally by (optional)</label>
          <input id="extra-date" type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
        </div>
      )}

      {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={sending}>Cancel</button>
        <button type="submit" disabled={sending || !canSend}>
          {sending ? 'Sending...' : isSupplies ? 'Send to the office' : 'Ask for a price'}
        </button>
      </div>
    </form>
  );
}
