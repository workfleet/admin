'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

const EMPTY_PROFILE = { name: '', contact_name: '', email: '', phone: '', billing_address: '', notes: '' };

export default function AdminClients() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [propertyCounts, setPropertyCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState(EMPTY_PROFILE);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: clientsData } = await supabase
      .from('clients')
      .select('id, name, contact_name, email, phone')
      .order('name');
    const { data: propertiesData } = await supabase
      .from('properties').select('client_id');

    const counts = {};
    (propertiesData || []).forEach((p) => { counts[p.client_id] = (counts[p.client_id] || 0) + 1; });

    setClients(clientsData || []);
    setPropertyCounts(counts);
    setLoading(false);
  };

  const addClient = async (e) => {
    e.preventDefault();
    if (!clientForm.name.trim()) return;

    const payload = {
      name: clientForm.name.trim(),
      contact_name: clientForm.contact_name.trim() || null,
      email: clientForm.email.trim() || null,
      phone: clientForm.phone.trim() || null,
      billing_address: clientForm.billing_address.trim() || null,
      notes: clientForm.notes.trim() || null,
    };

    const { data } = await supabase
      .from('clients').insert(payload)
      .select('id, name, contact_name, email, phone')
      .single();

    if (data) {
      setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      router.push(`/admin/clients/${data.id}`);
      return;
    }
    setClientForm(EMPTY_PROFILE);
    setShowClientForm(false);
  };

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.name, c.contact_name, c.email, c.phone].some((v) => v?.toLowerCase().includes(q))
    );
  }, [clients, search]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Clients</h1>
          <p className="page-subtitle">{clients.length} client{clients.length === 1 ? '' : 's'}</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowClientForm((s) => !s); setClientForm(EMPTY_PROFILE); }}
        >
          {showClientForm ? 'Cancel' : '+ New Client'}
        </button>
      </div>

      {showClientForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Client</h2>
            <button className="job-form-close" type="button" onClick={() => setShowClientForm(false)}>×</button>
          </div>
          <form onSubmit={addClient}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Client / Business name</label>
                <input
                  value={clientForm.name}
                  onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Acme Offices"
                  required
                  autoFocus
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Contact name</label>
                  <input
                    value={clientForm.contact_name}
                    onChange={(e) => setClientForm((f) => ({ ...f, contact_name: e.target.value }))}
                    placeholder="e.g. Jane Smith"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Phone</label>
                  <input
                    value={clientForm.phone}
                    onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="e.g. 07123 456789"
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="e.g. jane@acmeoffices.com"
                />
              </div>
              <div className="field">
                <label className="field-label">Billing address</label>
                <input
                  value={clientForm.billing_address}
                  onChange={(e) => setClientForm((f) => ({ ...f, billing_address: e.target.value }))}
                  placeholder="e.g. 1 Acme Way, London"
                />
              </div>
              <div className="field">
                <label className="field-label">Notes</label>
                <input
                  value={clientForm.notes}
                  onChange={(e) => setClientForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Invoices monthly, prefers email"
                />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowClientForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Add Client</button>
            </div>
          </form>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search clients by name, contact, email, or phone..."
        style={{
          width: '100%', padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
          background: 'white', fontSize: 14, fontFamily: 'inherit', marginBottom: 16,
        }}
      />

      {filteredClients.length === 0 && (
        <p className="empty-state">{search ? 'No clients match your search.' : 'No clients yet.'}</p>
      )}

      <div className="job-list">
        {filteredClients.map((client) => (
          <div
            key={client.id}
            className="card job-card"
            onClick={() => router.push(`/admin/clients/${client.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div>
              <h2>{client.name}</h2>
              <p className="job-time">
                {[client.contact_name, client.email, client.phone].filter(Boolean).join(' · ') || 'No contact details yet'}
              </p>
            </div>
            <span className="badge scheduled">
              {propertyCounts[client.id] || 0} propert{(propertyCounts[client.id] || 0) === 1 ? 'y' : 'ies'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
