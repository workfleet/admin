'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FileText, Download, Trash2 } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import AddressAutocomplete from '../../../components/AddressAutocomplete';
import { INDUSTRY_OPTIONS } from '../../../../lib/clientIndustries';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';
import { lateMinutes } from '../../../../lib/clockIn';
import BackButton from '../../../components/BackButton';

export default function ClientDetail() {
  const router = useRouter();
  const { id } = useParams();
  const confirm = useConfirm();
  const toast = useToast();

  const [client, setClient] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('properties'); // properties | calls | hours | reviews | clockins | documents

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const [isAddingProperty, setIsAddingProperty] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressCoords, setNewAddressCoords] = useState(null);
  const [newNotes, setNewNotes] = useState('');

  const [expandedPropertyId, setExpandedPropertyId] = useState(null);
  const [checklistItems, setChecklistItems] = useState({}); // propertyId -> items[]
  const [newChecklistRoom, setNewChecklistRoom] = useState('');
  const [newChecklistTask, setNewChecklistTask] = useState('');

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

  const [clockIns, setClockIns] = useState(null);
  const [clockInsLoading, setClockInsLoading] = useState(false);

  const [clientDocs, setClientDocs] = useState(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docCategory, setDocCategory] = useState('health_safety');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, contact_name, email, phone, billing_address, notes, industry, contract_value, contract_renewal_date, contract_notice_days, relationship_ended_at')
      .eq('id', id)
      .single();

    if (!clientData) { router.push('/admin/clients'); return; }

    const { data: propertiesData } = await supabase
      .from('properties')
      .select('id, client_id, address, notes, client_access_notes, lat, lng')
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

  useEffect(() => {
    if (tab === 'clockins' && clockIns === null && properties.length > 0) {
      loadClockIns();
    }
  }, [tab, properties]);

  const loadClockIns = async () => {
    setClockInsLoading(true);
    const propertyIds = properties.map((p) => p.id);
    const { data: jobRows } = await supabase
      .from('jobs')
      .select('id, scheduled_at, properties(address)')
      .in('property_id', propertyIds);

    const jobMap = Object.fromEntries((jobRows || []).map((j) => [j.id, j]));
    const jobIds = (jobRows || []).map((j) => j.id);

    const { data } = jobIds.length > 0
      ? await supabase
          .from('checkins')
          .select('id, job_id, checked_in_at, checked_out_at, auto_checked_out, profiles(full_name)')
          .in('job_id', jobIds)
          .order('checked_in_at', { ascending: false })
      : { data: [] };

    setClockIns((data || []).map((c) => ({ ...c, job: jobMap[c.job_id] })));
    setClockInsLoading(false);
  };

  useEffect(() => {
    if (tab === 'documents' && clientDocs === null) loadClientDocs();
  }, [tab]);

  const loadClientDocs = async () => {
    setDocsLoading(true);
    const { data } = await supabase
      .from('company_documents')
      .select('id, title, category, storage_path, file_name, file_size, created_at')
      .eq('client_id', id)
      .order('created_at', { ascending: false });
    setClientDocs(data || []);
    setDocsLoading(false);
  };

  const uploadClientDoc = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingDoc(true);

    const { data: { session } } = await supabase.auth.getSession();
    const newRows = [];
    for (const file of files) {
      const storagePath = `${docCategory}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('company-documents').upload(storagePath, file);
      if (uploadError) { toast.error(`Could not upload ${file.name}.`); continue; }

      const { data, error } = await supabase
        .from('company_documents')
        .insert({
          title: file.name.replace(/\.[^.]+$/, ''),
          category: docCategory,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          uploaded_by: session.user.id,
          client_id: id,
        })
        .select('id, title, category, storage_path, file_name, file_size, created_at')
        .single();

      if (error) { toast.error(`Uploaded ${file.name} but couldn't save it - try again.`); continue; }
      if (data) newRows.push(data);
    }

    setClientDocs((prev) => [...newRows, ...(prev || [])]);
    setUploadingDoc(false);
    e.target.value = '';
    if (newRows.length > 0) toast.success(`Uploaded ${newRows.length} document${newRows.length === 1 ? '' : 's'}.`);
  };

  const downloadClientDoc = async (doc) => {
    const { data, error } = await supabase.storage.from('company-documents').createSignedUrl(doc.storage_path, 3600);
    if (error || !data) { toast.error('Could not open this document.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const deleteClientDoc = async (doc) => {
    if (!(await confirm(`Delete "${doc.title}"? This client will no longer be able to see or download it.`, { title: 'Delete document', danger: true }))) return;
    await supabase.storage.from('company-documents').remove([doc.storage_path]);
    const { error } = await supabase.from('company_documents').delete().eq('id', doc.id);
    if (error) { toast.error('Could not delete the document.'); return; }
    setClientDocs((prev) => prev.filter((d) => d.id !== doc.id));
    toast.success('Document deleted.');
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
      industry: client.industry || '',
      contract_value: client.contract_value ?? '',
      contract_renewal_date: client.contract_renewal_date || '',
      contract_notice_days: client.contract_notice_days ?? '',
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
      industry: editForm.industry || null,
      contract_value: editForm.contract_value === '' ? null : Number(editForm.contract_value),
      contract_renewal_date: editForm.contract_renewal_date || null,
      contract_notice_days: editForm.contract_notice_days === '' ? null : Number(editForm.contract_notice_days),
    };

    const { data } = await supabase
      .from('clients').update(payload).eq('id', id)
      .select('id, name, contact_name, email, phone, billing_address, notes, industry, contract_value, contract_renewal_date, contract_notice_days')
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

  const exportClientData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/clients/${id}/export`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { toast.error('Could not export this client\'s data.'); return; }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : `client-${id}-data-export.json`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toggleRelationshipEnded = async () => {
    if (client.relationship_ended_at) {
      if (!(await confirm('Clear the "relationship ended" date? This client will no longer be eligible for automatic data retention cleanup.', { title: 'Clear end date' }))) return;
      const { data, error } = await supabase.from('clients').update({ relationship_ended_at: null }).eq('id', id).select('relationship_ended_at').single();
      if (!error) { setClient((c) => ({ ...c, ...data })); toast.success('Cleared.'); }
      return;
    }

    if (!(await confirm('Mark this client\'s relationship as ended today? Their contact details will be automatically redacted 6 years from now under our data retention policy.', { title: 'Mark relationship ended' }))) return;
    const { data, error } = await supabase.from('clients').update({ relationship_ended_at: new Date().toISOString() }).eq('id', id).select('relationship_ended_at').single();
    if (!error) { setClient((c) => ({ ...c, ...data })); toast.success('Marked as ended.'); }
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

  const toggleChecklist = async (propertyId) => {
    if (expandedPropertyId === propertyId) { setExpandedPropertyId(null); return; }
    setExpandedPropertyId(propertyId);
    setNewChecklistRoom('');
    setNewChecklistTask('');

    if (!checklistItems[propertyId]) {
      const { data } = await supabase
        .from('property_checklist_items')
        .select('id, room, task, sort_order')
        .eq('property_id', propertyId)
        .order('sort_order', { ascending: true });
      setChecklistItems((prev) => ({ ...prev, [propertyId]: data || [] }));
    }
  };

  const addChecklistItem = async (e, propertyId) => {
    e.preventDefault();
    if (!newChecklistRoom.trim() || !newChecklistTask.trim()) return;

    const existing = checklistItems[propertyId] || [];
    const { data, error } = await supabase
      .from('property_checklist_items')
      .insert({
        property_id: propertyId,
        room: newChecklistRoom.trim(),
        task: newChecklistTask.trim(),
        sort_order: existing.length,
      })
      .select('id, room, task, sort_order')
      .single();

    if (error) { toast.error('Could not add checklist item.'); return; }
    setChecklistItems((prev) => ({ ...prev, [propertyId]: [...existing, data] }));
    setNewChecklistTask('');
  };

  const deleteChecklistItem = async (propertyId, itemId) => {
    if (!(await confirm('Delete this checklist item?', { danger: true }))) return;
    const { error } = await supabase.from('property_checklist_items').delete().eq('id', itemId);
    if (error) { toast.error('Could not delete checklist item.'); return; }
    setChecklistItems((prev) => ({ ...prev, [propertyId]: prev[propertyId].filter((i) => i.id !== itemId) }));
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
      <BackButton />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="page-header-row" style={{ marginBottom: isEditing ? 12 : 0 }}>
          <h1 style={{ margin: 0 }}>{client.name}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={exportClientData} title="Download everything held about this client as a file - use this to answer a data request">Export Data</button>
            <button className="btn-secondary" onClick={toggleRelationshipEnded} title="Record that this client has left, which starts the 6 year clock on redacting their contact details - or clear that date again">
              {client.relationship_ended_at ? 'Clear End Date' : 'Mark Relationship Ended'}
            </button>
            <button className="btn-secondary" onClick={() => (isEditing ? setIsEditing(false) : startEdit())} title="Edit this client's details">
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
            <button className="btn-secondary" onClick={deleteClient} title="Delete this client and all their properties - this cannot be undone">Delete</button>
          </div>
        </div>

        {client.relationship_ended_at && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 0' }}>
            Relationship ended {new Date(client.relationship_ended_at).toLocaleDateString()} - contact details will be automatically redacted on {new Date(new Date(client.relationship_ended_at).setFullYear(new Date(client.relationship_ended_at).getFullYear() + 6)).toLocaleDateString()}.
          </p>
        )}

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
                <label className="field-label">Industry</label>
                <select
                  value={editForm.industry}
                  onChange={(e) => setEditForm((f) => ({ ...f, industry: e.target.value }))}
                >
                  <option value="">Not set</option>
                  {INDUSTRY_OPTIONS.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Contract value (£/year)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={editForm.contract_value}
                    onChange={(e) => setEditForm((f) => ({ ...f, contract_value: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Renewal date</label>
                  <input
                    type="date"
                    value={editForm.contract_renewal_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, contract_renewal_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Notice period before renewal (days)</label>
                <input
                  type="number" min="0"
                  value={editForm.contract_notice_days}
                  onChange={(e) => setEditForm((f) => ({ ...f, contract_notice_days: e.target.value }))}
                  placeholder="e.g. 30"
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
          (client.contact_name || client.email || client.phone || client.billing_address || client.notes || client.industry || client.contract_value || client.contract_renewal_date) && (
            <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
              {client.contact_name && <div>{client.contact_name}</div>}
              {(client.email || client.phone) && (
                <div>{[client.email, client.phone].filter(Boolean).join(' · ')}</div>
              )}
              {client.billing_address && <div>{client.billing_address}</div>}
              {client.industry && <span className="badge scheduled">{client.industry}</span>}
              {(client.contract_value || client.contract_renewal_date) && (
                <div style={{ marginTop: 6 }}>
                  {client.contract_value != null && <span>£{Number(client.contract_value).toLocaleString()}/year</span>}
                  {client.contract_value != null && client.contract_renewal_date && ' · '}
                  {client.contract_renewal_date && (() => {
                    const renewal = new Date(client.contract_renewal_date);
                    const noticeStart = new Date(renewal);
                    noticeStart.setDate(noticeStart.getDate() - (client.contract_notice_days || 0));
                    const dueForAttention = new Date() >= noticeStart;
                    return (
                      <span style={dueForAttention ? { color: 'var(--wf-overdue)', fontWeight: 600 } : undefined}>
                        Renews {renewal.toLocaleDateString()}
                      </span>
                    );
                  })()}
                </div>
              )}
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
        <button className={tab === 'clockins' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('clockins')}>
          Clock-ins{clockIns ? ` (${clockIns.length})` : ''}
        </button>
        <button className={tab === 'documents' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('documents')}>
          Documents{clientDocs ? ` (${clientDocs.length})` : ''}
        </button>
      </div>

      {tab === 'properties' && (
        <div className="card">
          {properties.length === 0 && <p className="empty-state">No properties yet.</p>}
          {properties.map((p) => (
            <div key={p.id} style={{ borderBottom: '1px solid var(--hairline)', padding: '10px 0' }}>
              <div className="task-row" style={{ border: 'none', padding: 0 }}>
                <div style={{ flex: 1 }}>
                  <div>{p.address}</div>
                  {p.notes && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.notes}</div>}
                  {p.client_access_notes && (
                    <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>
                      Client-provided access notes: {p.client_access_notes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" onClick={() => toggleChecklist(p.id)} title="Show or hide the room-by-room checklist for this property">
                    {expandedPropertyId === p.id ? 'Close' : 'Checklist'}
                  </button>
                  <button className="btn-secondary" onClick={() => deleteProperty(p.id)} title="Delete this property">Remove</button>
                </div>
              </div>

              {expandedPropertyId === p.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                  <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>
                    Room-by-room reference so any cleaner covering this property knows what "done" looks like here.
                  </p>
                  {(checklistItems[p.id] || []).length === 0 && (
                    <p className="empty-state" style={{ padding: '4px 0' }}>No checklist items yet.</p>
                  )}
                  {Object.entries(
                    (checklistItems[p.id] || []).reduce((acc, item) => {
                      (acc[item.room] = acc[item.room] || []).push(item);
                      return acc;
                    }, {})
                  ).map(([room, items]) => (
                    <div key={room} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{room}</div>
                      {items.map((item) => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                          <span style={{ fontSize: 14 }}>{item.task}</span>
                          <button className="btn-secondary" onClick={() => deleteChecklistItem(p.id, item.id)} style={{ padding: '4px 8px', fontSize: 12 }} title="Remove this item from the checklist">
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                  <form onSubmit={(e) => addChecklistItem(e, p.id)} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      value={newChecklistRoom}
                      onChange={(e) => setNewChecklistRoom(e.target.value)}
                      placeholder="Room (e.g. Kitchen)"
                      style={{ flex: '0 0 140px', marginBottom: 0 }}
                    />
                    <input
                      value={newChecklistTask}
                      onChange={(e) => setNewChecklistTask(e.target.value)}
                      placeholder="Task (e.g. Descale kettle)"
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    <button type="submit" className="btn-primary">Add</button>
                  </form>
                </div>
              )}
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
            <button className="btn-secondary" onClick={() => setIsAddingProperty(true)} style={{ marginTop: properties.length ? 12 : 0 }} title="Add another site for this client">
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
              <button className="btn-secondary" onClick={() => deleteCallLog(log.id)} title="Delete this call log entry">Remove</button>
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
                    <span style={overdue ? { color: 'var(--wf-overdue)', fontWeight: 600 } : { fontWeight: 600 }}>
                      {new Date(r.due_date).toLocaleDateString()}
                    </span>
                    {r.recurs_yearly && <span style={{ color: 'var(--muted)', fontSize: 12.5 }}> · yearly</span>}
                  </div>
                  {r.notes && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.notes}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" onClick={() => completeReminder(r)} title="Mark this reminder done - yearly ones roll forward to next year">
                    {r.recurs_yearly ? 'Done (reset to next year)' : 'Done'}
                  </button>
                  <button className="btn-secondary" onClick={() => deleteReminder(r.id)} title="Delete this reminder">Delete</button>
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
            <button className="btn-secondary" onClick={() => setIsAddingReminder(true)} style={{ marginTop: (reminders?.length || 0) ? 12 : 0 }} title="Set a reminder about this client, such as a contract review or price rise">
              + Reminder
            </button>
          )}
        </div>
      )}

      {tab === 'clockins' && (
        <div className="card">
          {clockInsLoading && <p className="empty-state">Loading...</p>}
          {!clockInsLoading && (clockIns?.length || 0) === 0 && <p className="empty-state">No check-ins yet.</p>}
          {(clockIns || []).map((c) => {
            const late = lateMinutes(c.checked_in_at, c.job?.scheduled_at);
            return (
              <div key={c.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14 }}>{c.job?.properties?.address || 'Unknown property'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {c.profiles?.full_name || 'Unknown cleaner'} · scheduled {c.job?.scheduled_at ? new Date(c.job.scheduled_at).toLocaleString() : '—'}
                    </div>
                  </div>
                  {late > 0 && <span className="badge missed">{late}m late</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Clocked in {new Date(c.checked_in_at).toLocaleTimeString()}
                  {c.checked_out_at ? ` · out ${new Date(c.checked_out_at).toLocaleTimeString()}` : ' · still on site'}
                  {c.checked_out_at && c.auto_checked_out && ' (auto)'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'documents' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Upload</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
              Files uploaded here are only visible to {client.name} in their client portal - not to other clients or to staff.
            </p>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Category</label>
                <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)}>
                  <option value="health_safety">Health &amp; Safety</option>
                  <option value="contract">Contract</option>
                  <option value="policy">Policy</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Files</label>
                <input type="file" multiple accept=".pdf,.doc,.docx" onChange={uploadClientDoc} disabled={uploadingDoc} />
              </div>
            </div>
            {uploadingDoc && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>Uploading...</p>}
          </div>

          {docsLoading && <p className="empty-state">Loading...</p>}
          {!docsLoading && (clientDocs?.length || 0) === 0 && <p className="empty-state">No documents shared with this client yet.</p>}

          {(clientDocs?.length || 0) > 0 && (
            <div className="card">
              {clientDocs.map((doc) => (
                <div key={doc.id} className="task-row" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {doc.category.replace('_', ' & ')} · {new Date(doc.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button type="button" className="btn-secondary" onClick={() => downloadClientDoc(doc)} aria-label="Download" title="Download this document" style={{ padding: '8px 10px' }}>
                      <Download size={16} />
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => deleteClientDoc(doc)} aria-label="Delete" title="Delete this document permanently" style={{ padding: '8px 10px' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
