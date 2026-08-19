'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

export default function AdminTemplates() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newItems, setNewItems] = useState(['']);

  const [newItemText, setNewItemText] = useState({}); // templateId -> draft text

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('job_templates')
      .select('id, name, created_at, job_template_items(id, description, sort_order)')
      .order('created_at', { ascending: true });

    setTemplates((data || []).map((t) => ({
      ...t,
      job_template_items: (t.job_template_items || []).sort((a, b) => a.sort_order - b.sort_order),
    })));
    setLoading(false);
  };

  const resetForm = () => {
    setNewName('');
    setNewItems(['']);
    setShowForm(false);
  };

  const toggleForm = () => {
    if (showForm) resetForm();
    else setShowForm(true);
  };

  const createTemplate = async (e) => {
    e.preventDefault();
    const items = newItems.map((i) => i.trim()).filter(Boolean);
    if (!newName.trim() || items.length === 0) return;

    const { data: template } = await supabase
      .from('job_templates')
      .insert({ name: newName.trim() })
      .select('id, name, created_at')
      .single();

    if (!template) return;

    const { data: itemRows } = await supabase
      .from('job_template_items')
      .insert(items.map((description, i) => ({ template_id: template.id, description, sort_order: i })))
      .select('id, description, sort_order');

    setTemplates((prev) => [...prev, { ...template, job_template_items: itemRows || [] }]);
    resetForm();
  };

  const deleteTemplate = async (id) => {
    if (!(await confirm('Delete this template? Jobs it was already applied to keep their tasks.', { danger: true }))) return;
    const { error } = await supabase.from('job_templates').delete().eq('id', id);
    if (error) { toast.error('Could not delete the template.'); return; }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast.success('Template deleted.');
  };

  const addItem = async (templateId) => {
    const text = (newItemText[templateId] || '').trim();
    if (!text) return;

    const template = templates.find((t) => t.id === templateId);
    const nextOrder = (template?.job_template_items?.length || 0);

    const { data } = await supabase
      .from('job_template_items')
      .insert({ template_id: templateId, description: text, sort_order: nextOrder })
      .select('id, description, sort_order')
      .single();

    if (data) {
      setTemplates((prev) => prev.map((t) =>
        t.id === templateId ? { ...t, job_template_items: [...t.job_template_items, data] } : t
      ));
      setNewItemText((prev) => ({ ...prev, [templateId]: '' }));
    }
  };

  const removeItem = async (templateId, itemId) => {
    await supabase.from('job_template_items').delete().eq('id', itemId);
    setTemplates((prev) => prev.map((t) =>
      t.id === templateId ? { ...t, job_template_items: t.job_template_items.filter((i) => i.id !== itemId) } : t
    ));
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Job Templates</h1>
          <p className="page-subtitle">Reusable checklists you can apply to any job instead of retyping tasks each time</p>
        </div>
        <button className="btn-primary" onClick={toggleForm}>
          {showForm ? 'Cancel' : '+ New Template'}
        </button>
      </div>

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Template</h2>
            <button className="job-form-close" type="button" onClick={resetForm}>×</button>
          </div>
          <form onSubmit={createTemplate}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Pub, Office, End of Tenancy" required autoFocus />
              </div>
              <div className="field">
                <label className="field-label">Checklist items</label>
                {newItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      value={item}
                      onChange={(e) => setNewItems((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                      placeholder="e.g. Wipe down bar surfaces"
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setNewItems((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={newItems.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-secondary" onClick={() => setNewItems((prev) => [...prev, ''])}>
                  + Add item
                </button>
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn-primary">Save Template</button>
            </div>
          </form>
        </div>
      )}

      {templates.length === 0 && <p className="empty-state">No templates yet.</p>}

      <div className="job-list">
        {templates.map((t) => {
          const isExpanded = expandedId === t.id;
          return (
            <div key={t.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2>{t.name}</h2>
                  <p className="job-time">{t.job_template_items.length} item{t.job_template_items.length === 1 ? '' : 's'}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, height: 'fit-content' }}>
                  <button className="btn-secondary" onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                    {isExpanded ? 'Hide' : 'Edit'}
                  </button>
                  <button className="btn-secondary" onClick={() => deleteTemplate(t.id)}>Delete</button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                  {t.job_template_items.map((item) => (
                    <div key={item.id} className="task-row">
                      <span style={{ flex: 1 }}>{item.description}</span>
                      <button className="btn-secondary" onClick={() => removeItem(t.id, item.id)}>Remove</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input
                      value={newItemText[t.id] || ''}
                      onChange={(e) => setNewItemText((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      placeholder="e.g. Empty bins"
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    <button className="btn-primary" onClick={() => addItem(t.id)}>Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
