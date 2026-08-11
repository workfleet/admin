'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const EMPTY_PROFILE = { name: '', contact_name: '', email: '', phone: '', billing_address: '', notes: '' };

export default function AdminClients() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState(EMPTY_PROFILE);

  const [editingClientId, setEditingClientId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_PROFILE);

  const [propertyFormFor, setPropertyFormFor] = useState(null);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressCoords, setNewAddressCoords] = useState(null);
  const [newNotes, setNewNotes] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: clientsData } = await supabase
      .from('clients')
      .select('id, name, contact_name, email, phone, billing_address, notes')
      .order('name');
    const { data: propertiesData } = await supabase
      .from('properties').select('id, client_id, address, notes, lat, lng').order('address');

    setClients(clientsData || []);
    setProperties(propertiesData || []);
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
      .select('id, name, contact_name, email, phone, billing_address, notes')
      .single();

    if (data) setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setClientForm(EMPTY_PROFILE);
    setShowClientForm(false);
  };

  const startEdit = (client) => {
    setEditingClientId(client.id);
    setEditForm({
      name: client.name || '',
      contact_name: client.contact_name || '',
      email: client.email || '',
      phone: client.phone || '',
      billing_address: client.billing_address || '',
      notes: client.notes || '',
    });
  };

  const saveEdit = async (e, clientId) => {
    e.preventDefault();
    if (!editForm.name.trim()) return;

    const payload = {
      name: editForm.name.trim(),
      contact_name: editForm.contact_name.trim() || null,
      email: editForm.email.trim() || null,
      phone: editForm.phone.trim() || null,
      billing_address: editForm.billing_address.trim() || null,
      notes: editForm.notes.trim() || null,
    };

    const { data } = await supabase
      .from('clients').update(payload).eq('id', clientId)
      .select('id, name, contact_name, email, phone, billing_address, notes')
      .single();

    if (data) {
      setClients((prev) =>
        prev.map((c) => (c.id === clientId ? data : c)).sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    setEditingClientId(null);
  };

  const deleteClient = async (id) => {
    if (!confirm('Delete this client and all their properties? This cannot be undone.')) return;
    await supabase.from('clients').delete().eq('id', id);
    setClients((prev) => prev.filter((c) => c.id !== id));
    setProperties((prev) => prev.filter((p) => p.client_id !== id));
  };

  const addProperty = async (e, clientId) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    const { data } = await supabase
      .from('properties')
      .insert({
        client_id: clientId,
        address: newAddress.trim(),
        notes: newNotes.trim() || null,
        lat: newAddressCoords?.lat ?? null,
        lng: newAddressCoords?.lng ?? null,
      })
      .select('id, client_id, address, notes, lat, lng')
      .single();

    if (data) setProperties((prev) => [...prev, data]);
    setNewAddress('');
    setNewAddressCoords(null);
    setNewNotes('');
    setPropertyFormFor(null);
  };

  const deleteProperty = async (id) => {
    if (!confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', id);
    setProperties((prev) => prev.filter((p) => p.id !== id));
  };

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

      {clients.length === 0 && <p className="empty-state">No clients yet.</p>}

      <div className="job-list">
        {clients.map((client) => {
          const clientProperties = properties.filter((p) => p.client_id === client.id);
          const isAddingProperty = propertyFormFor === client.id;
          const isEditing = editingClientId === client.id;

          return (
            <div key={client.id} className="card">
              <div className="page-header-row" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{client.name}</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => (isEditing ? setEditingClientId(null) : startEdit(client))}
                  >
                    {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setPropertyFormFor(isAddingProperty ? null : client.id);
                      setNewAddress('');
                      setNewAddressCoords(null);
                      setNewNotes('');
                    }}
                  >
                    {isAddingProperty ? 'Cancel' : '+ Property'}
                  </button>
                  <button className="btn-secondary" onClick={() => deleteClient(client.id)}>Delete</button>
                </div>
              </div>

              {isEditing ? (
                <form onSubmit={(e) => saveEdit(e, client.id)} style={{ marginBottom: 12 }}>
                  <div className="job-form-body">
                    <div className="field">
                      <label className="field-label">Client / Business name</label>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label className="field-label">Contact name</label>
                        <input
                          value={editForm.contact_name}
                          onChange={(e) => setEditForm((f) => ({ ...f, contact_name: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label">Phone</label>
                        <input
                          value={editForm.phone}
                          onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label className="field-label">Email</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">Billing address</label>
                      <input
                        value={editForm.billing_address}
                        onChange={(e) => setEditForm((f) => ({ ...f, billing_address: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">Notes</label>
                      <input
                        value={editForm.notes}
                        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="job-form-actions">
                    <button type="button" className="btn-secondary" onClick={() => setEditingClientId(null)}>Cancel</button>
                    <button type="submit" className="btn-primary">Save</button>
                  </div>
                </form>
              ) : (
                (client.contact_name || client.email || client.phone || client.billing_address || client.notes) && (
                  <div style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
                    {client.contact_name && <div>{client.contact_name}</div>}
                    {(client.email || client.phone) && (
                      <div>{[client.email, client.phone].filter(Boolean).join(' · ')}</div>
                    )}
                    {client.billing_address && <div>{client.billing_address}</div>}
                    {client.notes && <div style={{ fontStyle: 'italic' }}>{client.notes}</div>}
                  </div>
                )
              )}

              {clientProperties.map((p) => (
                <div key={p.id} className="task-row">
                  <div style={{ flex: 1 }}>
                    <div>{p.address}</div>
                    {p.notes && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.notes}</div>}
                  </div>
                  <button className="btn-secondary" onClick={() => deleteProperty(p.id)}>Remove</button>
                </div>
              ))}

              {isAddingProperty && (
                <form onSubmit={(e) => addProperty(e, client.id)} style={{ marginTop: 10 }}>
                  <label>Address</label>
                  <AddressAutocomplete
                    value={newAddress}
                    onChange={(text) => { setNewAddress(text); setNewAddressCoords(null); }}
                    onSelect={({ address, lat, lng }) => { setNewAddress(address); setNewAddressCoords({ lat, lng }); }}
                    placeholder="Start typing an address..."
                  />
                  <label>Notes (optional)</label>
                  <input
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="e.g. Gate code 1234"
                  />
                  <button type="submit" className="btn-primary">Add Property</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
