'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import AddressAutocomplete from '../../../components/AddressAutocomplete';

export default function ClientDetail() {
  const router = useRouter();
  const { id } = useParams();

  const [client, setClient] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('properties'); // properties | calls

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const [isAddingProperty, setIsAddingProperty] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressCoords, setNewAddressCoords] = useState(null);
  const [newNotes, setNewNotes] = useState('');

  const [callLogs, setCallLogs] = useState(null);
  const [callLogsLoading, setCallLogsLoading] = useState(false);
  const [newCallDirection, setNewCallDirection] = useState('outbound');
  const [newCallSummary, setNewCallSummary] = useState('');

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, contact_name, email, phone, billing_address, notes')
      .eq('id', id)
      .single();

    if (!clientData) { router.push('/admin/clients'); return; }

    const { data: propertiesData } = await supabase
      .from('properties')
      .select('id, client_id, address, notes, lat, lng')
      .eq('client_id', id)
      .order('address');

    setClient(clientData);
    setProperties(propertiesData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (tab === 'calls' && callLogs === null && id) {
      loadCallLogs();
    }
  }, [tab, id]);

  const loadCallLogs = async () => {
    setCallLogsLoading(true);
    const { data } = await supabase
      .from('client_call_logs')
      .select('id, direction, summary, called_at, profiles(full_name)')
      .eq('client_id', id)
      .order('called_at', { ascending: false });
    setCallLogs(data || []);
    setCallLogsLoading(false);
  };

  const startEdit = () => {
    setEditForm({
      name: client.name || '',
      contact_name: client.contact_name || '',
      email: client.email || '',
      phone: client.phone || '',
      billing_address: client.billing_address || '',
      notes: client.notes || '',
    });
    setIsEditing(true);
  };

  const saveEdit = async (e) => {
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
      .from('clients').update(payload).eq('id', id)
      .select('id, name, contact_name, email, phone, billing_address, notes')
      .single();

    if (data) setClient(data);
    setIsEditing(false);
  };

  const deleteClient = async () => {
    if (!confirm('Delete this client and all their properties? This cannot be undone.')) return;
    await supabase.from('clients').delete().eq('id', id);
    router.push('/admin/clients');
  };

  const addProperty = async (e) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    const { data } = await supabase
      .from('properties')
      .insert({
        client_id: id,
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
    setIsAddingProperty(false);
  };

  const deleteProperty = async (propertyId) => {
    if (!confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', propertyId);
    setProperties((prev) => prev.filter((p) => p.id !== propertyId));
  };

  const addCallLog = async (e) => {
    e.preventDefault();
    if (!newCallSummary.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('client_call_logs')
      .insert({
        client_id: id,
        logged_by: session.user.id,
        direction: newCallDirection,
        summary: newCallSummary.trim(),
      })
      .select('id, direction, summary, called_at, profiles(full_name)')
      .single();

    if (data) setCallLogs((prev) => [data, ...(prev || [])]);
    setNewCallSummary('');
    setNewCallDirection('outbound');
  };

  const deleteCallLog = async (logId) => {
    if (!confirm('Delete this call log entry?')) return;
    await supabase.from('client_call_logs').delete().eq('id', logId);
    setCallLogs((prev) => prev.filter((l) => l.id !== logId));
  };

  if (loading || !client) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <Link href="/admin/clients" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
        <ArrowLeft size={15} /> All clients
      </Link>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: isEditing ? 12 : 0 }}>
          <h1 style={{ margin: 0 }}>{client.name}</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={() => (isEditing ? setIsEditing(false) : startEdit())}>
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
            <button className="btn-secondary" onClick={deleteClient}>Delete</button>
          </div>
        </div>

        {isEditing ? (
          <form onSubmit={saveEdit} style={{ marginTop: 12 }}>
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
              <button type="button" className="btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        ) : (
          (client.contact_name || client.email || client.phone || client.billing_address || client.notes) && (
            <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
              {client.contact_name && <div>{client.contact_name}</div>}
              {(client.email || client.phone) && (
                <div>{[client.email, client.phone].filter(Boolean).join(' · ')}</div>
              )}
              {client.billing_address && <div>{client.billing_address}</div>}
              {client.notes && <div style={{ fontStyle: 'italic' }}>{client.notes}</div>}
            </div>
          )
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={tab === 'properties' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('properties')}>
          Properties ({properties.length})
        </button>
        <button className={tab === 'calls' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('calls')}>
          Call Log{callLogs ? ` (${callLogs.length})` : ''}
        </button>
      </div>

      {tab === 'properties' && (
        <div className="card">
          {properties.length === 0 && <p className="empty-state">No properties yet.</p>}
          {properties.map((p) => (
            <div key={p.id} className="task-row">
              <div style={{ flex: 1 }}>
                <div>{p.address}</div>
                {p.notes && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.notes}</div>}
              </div>
              <button className="btn-secondary" onClick={() => deleteProperty(p.id)}>Remove</button>
            </div>
          ))}

          {isAddingProperty ? (
            <form onSubmit={addProperty} style={{ marginTop: 12 }}>
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
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setIsAddingProperty(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Property</button>
              </div>
            </form>
          ) : (
            <button className="btn-secondary" onClick={() => setIsAddingProperty(true)} style={{ marginTop: properties.length ? 12 : 0 }}>
              + Property
            </button>
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className="card">
          <form onSubmit={addCallLog} style={{ marginBottom: 14 }}>
            <div className="field-row">
              <div className="field" style={{ flex: '0 0 150px' }}>
                <label className="field-label">Direction</label>
                <select value={newCallDirection} onChange={(e) => setNewCallDirection(e.target.value)}>
                  <option value="outbound">Called them</option>
                  <option value="inbound">They called us</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">What was discussed</label>
                <input
                  value={newCallSummary}
                  onChange={(e) => setNewCallSummary(e.target.value)}
                  placeholder="e.g. Confirmed Friday's job time, no issues raised"
                />
              </div>
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: 8 }}>Log Call</button>
          </form>

          {callLogsLoading && <p className="empty-state">Loading...</p>}
          {!callLogsLoading && (callLogs?.length || 0) === 0 && <p className="empty-state">No calls logged yet.</p>}

          {(callLogs || []).map((log) => (
            <div key={log.id} className="task-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5 }}>
                  <strong>{log.direction === 'inbound' ? 'They called us' : 'Called them'}</strong>
                  {' — '}{log.summary}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {new Date(log.called_at).toLocaleString()}
                  {log.profiles?.full_name && ` · logged by ${log.profiles.full_name}`}
                </div>
              </div>
              <button className="btn-secondary" onClick={() => deleteCallLog(log.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
