'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Download, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

const CATEGORY_LABELS = { policy: 'Policy', contract: 'Contract', other: 'Other' };
const CATEGORY_ORDER = ['policy', 'contract', 'other'];

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminDocuments() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [recipientsByDoc, setRecipientsByDoc] = useState({});
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('policy');
  const [audience, setAudience] = useState('everyone'); // everyone | specific
  const [selectedCleanerIds, setSelectedCleanerIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [{ data: docs }, { data: recipientRows }, { data: cleanerRows }] = await Promise.all([
      supabase
        .from('company_documents')
        .select('id, title, category, storage_path, file_name, file_size, created_at, profiles(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('company_document_recipients').select('document_id, profiles(full_name)'),
      supabase.from('profiles').select('id, full_name').eq('role', 'cleaner').eq('active', true).order('full_name'),
    ]);

    const byDoc = {};
    (recipientRows || []).forEach((r) => {
      if (!byDoc[r.document_id]) byDoc[r.document_id] = [];
      byDoc[r.document_id].push(r.profiles?.full_name || 'Unknown');
    });

    setDocuments(docs || []);
    setRecipientsByDoc(byDoc);
    setCleaners(cleanerRows || []);
    setLoading(false);
  };

  const toggleCleaner = (id) => {
    setSelectedCleanerIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (audience === 'specific' && selectedCleanerIds.length === 0) {
      toast.error('Select at least one cleaner, or choose "Everyone".');
      e.target.value = '';
      return;
    }
    setUploading(true);

    const newRows = [];
    const newRecipients = {};
    for (const file of files) {
      const storagePath = `${category}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('company-documents')
        .upload(storagePath, file);

      if (uploadError) {
        toast.error(`Could not upload ${file.name}.`);
        continue;
      }

      const { data, error } = await supabase
        .from('company_documents')
        .insert({
          title: file.name.replace(/\.[^.]+$/, ''),
          category,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          uploaded_by: userId,
        })
        .select('id, title, category, storage_path, file_name, file_size, created_at, profiles(full_name)')
        .single();

      if (error) { toast.error(`Uploaded ${file.name} but couldn't save it - try again.`); continue; }
      if (!data) continue;
      newRows.push(data);

      if (audience === 'specific') {
        const { error: recipientError } = await supabase
          .from('company_document_recipients')
          .insert(selectedCleanerIds.map((profileId) => ({ document_id: data.id, profile_id: profileId })));
        if (recipientError) {
          toast.error(`Uploaded ${file.name} but couldn't restrict who sees it - it's currently visible to everyone.`);
        } else {
          newRecipients[data.id] = cleaners.filter((c) => selectedCleanerIds.includes(c.id)).map((c) => c.full_name);
        }
      }
    }

    setDocuments((prev) => [...newRows, ...prev]);
    setRecipientsByDoc((prev) => ({ ...prev, ...newRecipients }));
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (newRows.length > 0) toast.success(`Uploaded ${newRows.length} document${newRows.length === 1 ? '' : 's'}.`);
  };

  const handleDownload = async (doc) => {
    const { data, error } = await supabase.storage.from('company-documents').createSignedUrl(doc.storage_path, 3600);
    if (error || !data) { toast.error('Could not open this document.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (doc) => {
    if (!(await confirm(`Delete "${doc.title}"? Staff will no longer be able to see or download it.`, { title: 'Delete document', danger: true }))) return;

    const { error: storageError } = await supabase.storage.from('company-documents').remove([doc.storage_path]);
    if (storageError) { toast.error('Could not delete the file.'); return; }

    const { error } = await supabase.from('company_documents').delete().eq('id', doc.id);
    if (error) { toast.error('Could not delete the document record.'); return; }

    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    toast.success('Document deleted.');
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Documents</h1>
          <p className="page-subtitle">Policies, contracts, and other files shared with every member of staff</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Upload</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
          Select one or more files - they'll all be uploaded under the category below.
        </p>
        <div className="field">
          <label className="field-label">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: audience === 'specific' ? 10 : 14 }}>
          <label className="field-label">Share with</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={audience === 'everyone' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setAudience('everyone')}
              style={{ flex: 1 }}
              title="Share whatever you upload next with every member of staff"
            >
              Everyone
            </button>
            <button
              type="button"
              className={audience === 'specific' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setAudience('specific')}
              style={{ flex: 1 }}
              title="Pick which cleaners can see whatever you upload next"
            >
              Certain cleaners
            </button>
          </div>
        </div>

        {audience === 'specific' && (
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px',
              marginBottom: 14, maxHeight: 200, overflowY: 'auto',
              border: '1px solid var(--hairline)', borderRadius: 10, padding: '10px 12px', background: 'var(--wf-ash)',
            }}
          >
            {cleaners.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>No active cleaners found.</p>}
            {cleaners.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400, padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={selectedCleanerIds.includes(c.id)}
                  onChange={() => toggleCleaner(c.id)}
                  style={{ width: 'auto' }}
                />
                {c.full_name}
              </label>
            ))}
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Files</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx"
            onChange={handleUpload}
            disabled={uploading}
          />
        </div>
        {uploading && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>Uploading...</p>}
      </div>

      {documents.length === 0 && <p className="empty-state">No documents uploaded yet.</p>}

      {CATEGORY_ORDER.map((cat) => {
        const docsInCategory = documents.filter((d) => d.category === cat);
        if (docsInCategory.length === 0) return null;
        return (
          <div key={cat} className="card" style={{ marginBottom: 16 }}>
            <h2>{CATEGORY_LABELS[cat]} ({docsInCategory.length})</h2>
            {docsInCategory.map((doc) => (
              <div key={doc.id} className="task-row" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileText size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {formatBytes(doc.file_size)} · uploaded by {doc.profiles?.full_name || 'Unknown'} · {new Date(doc.created_at).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      Shared with: {recipientsByDoc[doc.id] ? recipientsByDoc[doc.id].join(', ') : 'Everyone'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn-secondary" onClick={() => handleDownload(doc)} aria-label="Download" title="Download this document" style={{ padding: '8px 10px' }}>
                    <Download size={16} />
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => handleDelete(doc)} aria-label="Delete" title="Delete this document — staff will no longer be able to see it" style={{ padding: '8px 10px' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
