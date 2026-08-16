'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
const STATUS_BADGE_CLASS = { draft: 'scheduled', sent: 'in_progress', accepted: 'completed', declined: 'missed', expired: 'missed' };

function formatPrice(price) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(price);
}

export default function AdminQuotes() {
  const router = useRouter();
  const [quotes, setQuotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | decided | all

  const [showForm, setShowForm] = useState(false);
  const [recipientType, setRecipientType] = useState('client'); // client | prospect
  const [clientId, setClientId] = useState('');
  const [prospectName, setProspectName] = useState('');
  const [prospectEmail, setProspectEmail] = useState('');
  const [prospectPhone, setProspectPhone] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [{ data: quotesData }, { data: clientsData }] = await Promise.all([
      supabase
        .from('quotes')
        .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, status, valid_until, notes, created_at, clients(name)')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').order('name'),
    ]);

    setQuotes(quotesData || []);
    setClients(clientsData || []);
    setLoading(false);
  };

  const resetForm = () => {
    setRecipientType('client');
    setClientId('');
    setProspectName('');
    setProspectEmail('');
    setProspectPhone('');
    setDescription('');
    setPrice('');
    setValidUntil('');
    setNotes('');
  };

  const createQuote = async (e) => {
    e.preventDefault();
    if (!description.trim() || !price) return;
    if (recipientType === 'client' && !clientId) return;
    if (recipientType === 'prospect' && !prospectName.trim()) return;
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();

    const payload = {
      client_id: recipientType === 'client' ? clientId : null,
      prospect_name: recipientType === 'prospect' ? prospectName.trim() : null,
      prospect_email: recipientType === 'prospect' ? (prospectEmail.trim() || null) : null,
      prospect_phone: recipientType === 'prospect' ? (prospectPhone.trim() || null) : null,
      description: description.trim(),
      price: parseFloat(price),
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      created_by: session.user.id,
    };

    const { data } = await supabase
      .from('quotes')
      .insert(payload)
      .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, status, valid_until, notes, created_at, clients(name)')
      .single();

    setCreating(false);
    if (data) setQuotes((prev) => [data, ...prev]);
    resetForm();
    setShowForm(false);
  };

  const changeStatus = async (quote, status) => {
    const decided_at = status === 'accepted' || status === 'declined' ? new Date().toISOString() : quote.decided_at || null;

    const { data } = await supabase
      .from('quotes').update({ status, decided_at }).eq('id', quote.id)
      .select('id, status, decided_at').single();

    if (data) {
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: data.status, decided_at: data.decided_at } : q)));
    }
  };

  const deleteQuote = async (quoteId) => {
    if (!confirm('Delete this quote?')) return;
    await supabase.from('quotes').delete().eq('id', quoteId);
    setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
  };

  const filteredQuotes = useMemo(() => {
    if (filter === 'decided') return quotes.filter((q) => q.status !== 'draft' && q.status !== 'sent');
    if (filter === 'all') return quotes;
    return quotes.filter((q) => q.status === 'draft' || q.status === 'sent');
  }, [quotes, filter]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Quotes</h1>
          <p className="page-subtitle">Priced proposals for clients and prospects</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ New Quote'}
        </button>
      </div>

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Quote</h2>
            <button className="job-form-close" type="button" onClick={() => setShowForm(false)}>×</button>
          </div>
          <form onSubmit={createQuote}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Who's this for?</label>
                <select value={recipientType} onChange={(e) => setRecipientType(e.target.value)}>
                  <option value="client">An existing client</option>
                  <option value="prospect">A new prospect</option>
                </select>
              </div>

              {recipientType === 'client' ? (
                <div className="field">
                  <label className="field-label">Client</label>
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                    <option value="">Select...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label">Prospect name</label>
                    <input value={prospectName} onChange={(e) => setProspectName(e.target.value)} placeholder="e.g. New Build Co" required />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label className="field-label">Email (optional)</label>
                      <input type="email" value={prospectEmail} onChange={(e) => setProspectEmail(e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="field-label">Phone (optional)</label>
                      <input value={prospectPhone} onChange={(e) => setProspectPhone(e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              <div className="field">
                <label className="field-label">Description of work</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Weekly office clean, 2 cleaners, 2 hours"
                  required
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Price (£)</label>
                  <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="field-label">Valid until (optional)</label>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Notes (optional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes, not shown to the client" />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Adding...' : 'Add Quote'}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>Open</button>
        <button className={filter === 'decided' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('decided')}>Decided</button>
        <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
      </div>

      {filteredQuotes.length === 0 && <p className="empty-state">Nothing here.</p>}

      <div className="job-list">
        {filteredQuotes.map((quote) => (
          <div key={quote.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2>
                  {quote.client_id ? (
                    <Link href={`/admin/clients/${quote.client_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {quote.clients?.name || 'Unknown client'}
                    </Link>
                  ) : (
                    quote.prospect_name
                  )}
                  {!quote.client_id && <span className="badge scheduled" style={{ marginLeft: 8, verticalAlign: 'middle' }}>prospect</span>}
                </h2>
                <p className="job-time">{quote.description}</p>
                <p className="job-time">
                  {(quote.prospect_email || quote.prospect_phone) && (
                    <>{[quote.prospect_email, quote.prospect_phone].filter(Boolean).join(' · ')}{' · '}</>
                  )}
                  {quote.valid_until && <>Valid until {new Date(quote.valid_until).toLocaleDateString()}{' · '}</>}
                  Quoted {new Date(quote.created_at).toLocaleDateString()}
                </p>
                {quote.notes && <p className="job-time" style={{ fontStyle: 'italic' }}>{quote.notes}</p>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontSize: 18 }}>{formatPrice(quote.price)}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
              <span className={`badge ${STATUS_BADGE_CLASS[quote.status]}`}>{STATUS_LABELS[quote.status]}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={quote.status}
                  onChange={(e) => changeStatus(quote, e.target.value)}
                  style={{ width: 'auto', margin: 0 }}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button className="btn-secondary" onClick={() => deleteQuote(quote.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
