'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import AddressAutocomplete from '../../../components/AddressAutocomplete';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';

export default function ClientDetail() {
  const router = useRouter();
  const { id } = useParams();
  const confirm = useConfirm();
  const toast = useToast();

  const [client, setClient] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('properties'); // properties | calls | hours | reviews

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

  const [monthlyHours, setMonthlyHours] = useState(null);
  const [monthlyHoursLoading, setMonthlyHoursLoading] = useState(false);

  const [reminders, setReminders] = useState(null);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [isAddingReminder, setIsAddingReminder] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState('');
  const [newReminderRecurs, setNewReminderRecurs] = useState(false);
  const [newReminderNotes, setNewReminderNotes] = useState('');

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

  useEffect(() => {
    if (tab === 'hours' && monthlyHours === null && properties.length > 0) {
      loadMonthlyHours();
    }
  }, [tab, properties]);

  const loadMonthlyHours = async () => {
    setMonthlyHoursLoading(true);
    const propertyIds = properties.map((p) => p.id);
    const { data } = await supabase
      .from('jobs')
      .select('scheduled_at, duration_minutes')
      .in('property_id', propertyIds)
      .eq('status', 'completed');

    // Hours delivered to the client, not payroll hours - a job worked by
    // two cleaners at once is still one job's worth of service, so this
    // doesn't split duration by assignee count the way payroll does.
    const totals = {};
    (data || []).forEach((job) => {
      const d = new Date(job.scheduled_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!totals[key]) totals[key] = { minutes: 0, jobs: 0 };
      totals[key].minutes += job.duration_minutes || 0;
      totals[key].jobs += 1;
    });

    const rows = Object.entries(totals)
      .map(([month, t]) => ({ month, ...t }))
      .sort((a, b) => b.month.localeCompare(a.month));

    setMonthlyHours(rows);
    setMonthlyHoursLoading(false);
  };

  useEffect(() => {
    if (tab === 'reviews' && reminders === null && id) {
      loadReminders();
    }
  }, [tab, id]);

  const loadReminders = async () => {
    setRemindersLoading(true);
    const { data } = await supabase
      .from('reminders')
      .select('id, due_date, recurs_yearly, notes')
      .eq('client_id', id)
      .order('due_date', { ascending: true });
    setReminders(data || []);
    setRemindersLoading(false);
  };

  const addReminder = async (e) => {
    e.preventDefault();
    if (!newReminderDate) return;

    const { data: { session } } = await supabase.auth.getSession();
    const { data } = await supabase
      .from('reminders')
      .insert({
        client_id: id,
        due_date: newReminderDate,
        recurs_yearly: newReminderRecurs,
        notes: newReminderNotes.trim() || null,
        created_by: session.user.id,
      })
      .select('id, due_date, recurs_yearly, notes')
      .single();

    if (data) setReminders((prev) => [...(prev || []), data].sort((a, b) => a.due_date.localeCompare(b.due_date)));
    setNewReminderDate('');
    setNewReminderRecurs(false);
    setNewReminderNotes('');
    setIsAddingReminder(false);
  };

  const completeReminder = async (reminder) => {
    if (reminder.recurs_yearly) {
      const next = new Date(reminder.due_date);
      next.setFullYear(next.getFullYear() + 1);
      const nextDate = next.toISOString().slice(0, 10);
      const { data } = await supabase
        .from('reminders').update({ due_date: nextDate }).eq('id', reminder.id)
        .select('id, due_date, recurs_yearly, notes').single();
      if (data) setReminders((prev) => prev.map((r) => (r.id === reminder.id ? data : r)));
    } else {
      await supabase.from('reminders').delete().eq('id', reminder.id);
      setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
    }
  };

  const deleteReminder = async (reminderId) => {
    if (!(await confirm('Delete this reminder?', { danger: true }))) return;
    const { error } = await supabase.from('reminders').delete().eq('id', reminderId);
    if (error) { toast.error('Could not delete the reminder.'); return; }
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    toast.success('Reminder deleted.');
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
    if (!(await confirm('Delete this client and all their properties? This cannot be undone.', { title: 'Delete client', danger: true }))) return;
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) { toast.error('Could not delete the client.'); return; }
    toast.success('Client deleted.');
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
    if (!(await confirm('Delete this property?', { danger: true }))) return;
    const { error } = await supabase.from('properties').delete().eq('id', propertyId);
    if (error) { toast.error('Could not delete the property.'); return; }
    setProperties((prev) => prev.filter((p) => p.id !== propertyId));
    toast.success('Property deleted.');
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
    if (!(await confirm('Delete this call log entry?', { danger: true }))) return;
    const { error } = await supabase.from('client_call_logs').delete().eq('id', logId);
    if (error) { toast.error('Could not delete the call log entry.'); return; }
    setCallLogs((prev) => prev.filter((l) => l.id !== logId));
    toast.success('Call log entry deleted.');
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
        <button className={tab === 'hours' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('hours')}>
          Monthly Hours
        </button>
        <button className={tab === 'reviews' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('reviews')}>
          Reviews{reminders ? ` (${reminders.length})` : ''}
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

      {tab === 'hours' && (
        <div className="card">
          {monthlyHoursLoading && <p className="empty-state">Loading...</p>}
          {!monthlyHoursLoading && (monthlyHours?.length || 0) === 0 && (
            <p className="empty-state">No completed jobs yet.</p>
          )}
          {(monthlyHours || []).map((row) => (
            <div key={row.month} className="task-row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14 }}>
                {new Date(`${row.month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                {' '}
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                  · {row.jobs} job{row.jobs !== 1 ? 's' : ''}
                </span>
              </span>
              <strong style={{ fontSize: 14 }}>{(row.minutes / 60).toFixed(1)}h</strong>
            </div>
          ))}
        </div>
      )}

      {tab === 'reviews' && (
        <div className="card">
          {remindersLoading && <p className="empty-state">Loading...</p>}
          {!remindersLoading && (reminders?.length || 0) === 0 && !isAddingReminder && (
            <p className="empty-state">No review reminders set.</p>
          )}

          {(reminders || []).map((r) => {
            const overdue = new Date(r.due_date) < new Date(new Date().toDateString());
            return (
              <div key={r.id} className="task-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14 }}>
                    <span style={overdue ? { color: 'crimson', fontWeight: 600 } : { fontWeight: 600 }}>
                      {new Date(r.due_date).toLocaleDateString()}
                    </span>
                    {r.recurs_yearly && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}> · yearly</span>}
                  </div>
                  {r.notes && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.notes}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" onClick={() => completeReminder(r)}>
                    {r.recurs_yearly ? 'Done (reset to next year)' : 'Done'}
                  </button>
                  <button className="btn-secondary" onClick={() => deleteReminder(r.id)}>Delete</button>
                </div>
              </div>
            );
          })}

          {isAddingReminder ? (
            <form onSubmit={addReminder} style={{ marginTop: 12 }}>
              <label>Due date</label>
              <input type="date" value={newReminderDate} onChange={(e) => setNewReminderDate(e.target.value)} required />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={newReminderRecurs}
                  onChange={(e) => setNewReminderRecurs(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Repeats yearly
              </label>
              <label>Notes (optional)</label>
              <input
                value={newReminderNotes}
                onChange={(e) => setNewReminderNotes(e.target.value)}
                placeholder="e.g. Check in on satisfaction, discuss contract renewal"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setIsAddingReminder(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Add Reminder</button>
              </div>
            </form>
          ) : (
            <button className="btn-secondary" onClick={() => setIsAddingReminder(true)} style={{ marginTop: (reminders?.length || 0) ? 12 : 0 }}>
              + Reminder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
