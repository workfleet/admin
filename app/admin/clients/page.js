'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { INDUSTRY_OPTIONS } from '../../../lib/clientIndustries';
import BackButton from '../../components/BackButton';

const EMPTY_PROFILE = { name: '', contact_name: '', email: '', phone: '', billing_address: '', notes: '', industry: '' };

export default function AdminClients() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [propertyCounts, setPropertyCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');

  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState(EMPTY_PROFILE);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: clientsData } = await supabase
      .from('clients')
      .select('id, name, contact_name, email, phone, industry')
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
      industry: clientForm.industry || null,
    };

    const { data } = await supabase
      .from('clients').insert(payload)
      .select('id, name, contact_name, email, phone, industry')
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
    return clients.filter((c) => {
      if (industryFilter && c.industry !== industryFilter) return false;
      if (!q) return true;
      return [c.name, c.contact_name, c.email, c.phone].some((v) => v?.toLowerCase().includes(q));
    });
  }, [clients, search, industryFilter]);

  const industriesInUse = useMemo(
    () => INDUSTRY_OPTIONS.filter((i) => clients.some((c) => c.industry === i)),
    [clients]
  );

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Clients</h1>
          <p className="page-subtitle">{clients.length} client{clients.length === 1 ? '' : 's'}</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setShowClientForm((s) => !s); setClientForm(EMPTY_PROFILE); }}
          title="Add a new client and their first site"
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
                <label className="field-label">Industry</label>
                <select
                  value={clientForm.industry}
                  onChange={(e) => setClientForm((f) => ({ ...f, industry: e.target.value }))}
                >
                  <option value="">Not set</option>
                  {INDUSTRY_OPTIONS.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients by name, contact, email, or phone..."
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
            background: 'white', fontSize: 14, fontFamily: 'inherit',
          }}
        />
        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          style={{
            width: 'auto', padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
            background: 'white', fontSize: 14, fontFamily: 'inherit',
          }}
        >
          <option value="">All industries ({industriesInUse.length})</option>
          {industriesInUse.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

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
              {client.industry && <span className="badge scheduled" style={{ marginTop: 4 }}>{client.industry}</span>}
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
