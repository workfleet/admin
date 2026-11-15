'use client';

import EmptyState from '../../components/EmptyState';
import { Folder as EmptyIconFolder, FileText, Download, Trash2, Search, FolderPlus, ChevronDown, ChevronRight, ChevronUp, Sparkles, Settings2 } from 'lucide-react';
import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { withoutTestAccounts } from '../../../lib/testAccounts';
import { getSessionWithRetry } from '../../../lib/authGate';
import { FOLDER_KINDS, UNSORTED, groupByFolder, matchesSearch, reorder } from '../../../lib/documentFolders';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

// Before 0141 is run there are no folders: the old three groups.
const CATEGORY_LABELS = { policy: 'Policy', contract: 'Contract', other: 'Other' };
const CATEGORY_ORDER = ['policy', 'contract', 'other'];

const DOC_COLUMNS = 'id, title, category, storage_path, file_name, file_size, created_at, profiles!company_documents_uploaded_by_fkey(full_name)';

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
  const [folders, setFolders] = useState(null); // null = folders not switched on (0141)
  const [recipientsByDoc, setRecipientsByDoc] = useState({});
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('policy');
  const [uploadFolder, setUploadFolder] = useState('');
  const [audience, setAudience] = useState('everyone'); // everyone | specific
  const [selectedCleanerIds, setSelectedCleanerIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState(null);

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [selected, setSelected] = useState([]);
  const [moveTo, setMoveTo] = useState('');
  const [moving, setMoving] = useState(false);

  const [managing, setManaging] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [newKind, setNewKind] = useState('other');
  const [names, setNames] = useState({});

  const [sorting, setSorting] = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [docsRes, foldersRes, { data: recipientRows }, { data: cleanerRows }] = await Promise.all([
      supabase.from('company_documents').select(`${DOC_COLUMNS}, folder_id`).is('client_id', null).order('created_at', { ascending: false }),
      supabase.from('document_folders').select('id, name, category, position').order('position'),
      supabase.from('company_document_recipients').select('document_id, profiles(full_name)'),
      supabase.from('profiles').select('id, full_name').eq('role', 'cleaner').eq('active', true).order('full_name'),
    ]);

    let docs = docsRes.data;
    // Folders not switched on yet: the same list without folder_id.
    if (docsRes.error) {
      const { data } = await supabase.from('company_documents').select(DOC_COLUMNS).is('client_id', null).order('created_at', { ascending: false });
      docs = data;
    }
    const folderList = docsRes.error || foldersRes.error ? null : foldersRes.data || [];

    const byDoc = {};
    (recipientRows || []).forEach((r) => {
      if (!byDoc[r.document_id]) byDoc[r.document_id] = [];
      byDoc[r.document_id].push(r.profiles?.full_name || 'Unknown');
    });

    setDocuments(docs || []);
    setFolders(folderList);
    if (folderList?.length && !uploadFolder) setUploadFolder(folderList[0].id);
    setRecipientsByDoc(byDoc);
    setCleaners(withoutTestAccounts(cleanerRows));
    setLoading(false);
  };

  const folderById = useMemo(() => new Map((folders || []).map((f) => [f.id, f])), [folders]);

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

    const folder = folders ? folderById.get(uploadFolder) : null;
    const docCategory = folder ? folder.category : category;
    const newRows = [];
    const newRecipients = {};
    for (const file of files) {
      const storagePath = `${docCategory}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
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
          category: docCategory,
          ...(folder ? { folder_id: folder.id } : {}),
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          uploaded_by: userId,
        })
        .select(folders ? `${DOC_COLUMNS}, folder_id` : DOC_COLUMNS)
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
    if (newRows.length > 0) toast.success(`Uploaded ${newRows.length} document${newRows.length === 1 ? '' : 's'}${folder ? ` to ${folder.name}` : ''}.`);
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
    setSelected((prev) => prev.filter((id) => id !== doc.id));
    toast.success('Document deleted.');
  };

  // --- Moving -------------------------------------------------------------

  // The database sets each moved document's category from its new folder.
  const moveDocs = async (ids, folderId) => {
    const target = folderById.get(folderId);
    if (!ids.length || !target) return false;
    const leavingContracts = ids.some((id) => {
      const d = documents.find((x) => x.id === id);
      return folderById.get(d?.folder_id)?.category === 'contract' && target.category !== 'contract';
    });
    if (leavingContracts && !(await confirm(`Move out of the contracts folder? Anything moved to "${target.name}" can be read by supervisors in the AI chat, not just admins.`, { title: 'Moving contracts', confirmLabel: 'Move anyway' }))) return false;
    setMoving(true);
    const { data, error } = await supabase.from('company_documents').update({ folder_id: folderId }).in('id', ids).select('id, folder_id, category');
    setMoving(false);
    if (error || !data?.length) { toast.error('Could not move them.'); return false; }
    const byId = new Map(data.map((d) => [d.id, d]));
    setDocuments((prev) => prev.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id) } : d)));
    toast.success(`Moved ${data.length} document${data.length === 1 ? '' : 's'} to ${target.name}.`);
    return true;
  };

  const moveSelected = async () => {
    if (await moveDocs(selected, moveTo)) { setSelected([]); setMoveTo(''); }
  };

  const toggleSelected = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // --- Managing folders ---------------------------------------------------

  const addFolder = async (e) => {
    e.preventDefault();
    const name = newFolder.trim();
    if (!name) return;
    const position = Math.max(0, ...(folders || []).map((f) => f.position)) + 10;
    const { data, error } = await supabase.from('document_folders').insert({ name, category: newKind, position, created_by: userId }).select('id, name, category, position').single();
    if (error || !data) { toast.error(error?.code === '23505' ? 'There is already a folder with that name.' : 'Could not add the folder.'); return; }
    setFolders((prev) => [...prev, data]);
    setNewFolder('');
    setNewKind('other');
    toast.success(`Folder "${name}" added.`);
  };

  const renameFolder = async (folder) => {
    const name = (names[folder.id] ?? folder.name).trim();
    if (!name || name === folder.name) { setNames((n) => { const x = { ...n }; delete x[folder.id]; return x; }); return; }
    const { error } = await supabase.from('document_folders').update({ name }).eq('id', folder.id);
    if (error) { toast.error(error.code === '23505' ? 'There is already a folder with that name.' : 'Could not rename it.'); return; }
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name } : f)));
    setNames((n) => { const x = { ...n }; delete x[folder.id]; return x; });
  };

  const moveFolder = async (folder, dir) => {
    const changes = reorder(folders, folder.id, dir);
    if (!changes.length) return;
    const results = await Promise.all(changes.map((c) => supabase.from('document_folders').update({ position: c.position }).eq('id', c.id)));
    if (results.some((r) => r.error)) { toast.error('Could not reorder the folders.'); return; }
    setFolders((prev) => prev.map((f) => ({ ...f, position: changes.find((c) => c.id === f.id)?.position ?? f.position })).sort((a, b) => a.position - b.position));
  };

  const deleteFolder = async (folder) => {
    const inside = documents.filter((d) => d.folder_id === folder.id).length;
    const msg = inside
      ? `Delete the folder "${folder.name}"? Its ${inside} document${inside === 1 ? '' : 's'} won't be deleted - they move to the first folder of the same kind.`
      : `Delete the empty folder "${folder.name}"?`;
    if (!(await confirm(msg, { title: 'Delete folder', danger: true, confirmLabel: 'Delete folder' }))) return;
    const { error } = await supabase.from('document_folders').delete().eq('id', folder.id);
    if (error) { toast.error('Could not delete the folder.'); return; }
    await load();
    toast.success('Folder deleted.');
  };

  // --- AI tidy-up -----------------------------------------------------------

  const suggestFolders = async () => {
    setSorting(true);
    setSuggestions(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai/sort-documents', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { toast.error(data?.message || 'The suggestions didn\'t work. Please try again.'); return; }
      setSuggestions(data.suggestions.map((s) => ({ ...s, include: true })));
    } catch {
      toast.error('Couldn\'t reach the server - check your connection.');
    } finally {
      setSorting(false);
    }
  };

  const applySuggestions = async () => {
    const chosen = suggestions.filter((s) => s.include);
    if (!chosen.length) return;
    // One update per destination folder.
    const byFolder = {};
    chosen.forEach((s) => { (byFolder[s.folder_id] = byFolder[s.folder_id] || []).push(s.id); });
    setMoving(true);
    const results = await Promise.all(Object.entries(byFolder).map(([fid, ids]) => supabase.from('company_documents').update({ folder_id: fid }).in('id', ids).select('id, folder_id, category')));
    setMoving(false);
    const moved = results.flatMap((r) => r.data || []);
    const byId = new Map(moved.map((d) => [d.id, d]));
    setDocuments((prev) => prev.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id) } : d)));
    setSuggestions(null);
    if (results.some((r) => r.error)) toast.error(`Moved ${moved.length}; some couldn't be moved.`);
    else toast.success(`Moved ${moved.length} document${moved.length === 1 ? '' : 's'}.`);
  };

  if (loading) return <PageSkeleton />;

  const folderName = (d) => folderById.get(d.folder_id)?.name || '';
  const visibleDocs = documents.filter((d) => matchesSearch(d, folders ? folderName(d) : CATEGORY_LABELS[d.category], search));
  const groups = folders
    ? groupByFolder(folders, visibleDocs, { keepEmpty: !search })
    : CATEGORY_ORDER.map((cat) => ({ folder: { id: cat, name: CATEGORY_LABELS[cat] }, docs: visibleDocs.filter((d) => d.category === cat) })).filter((g) => g.docs.length);

  const docRow = (doc) => (
    <div key={doc.id} className="task-row" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {folders && (
          <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggleSelected(doc.id)} style={{ width: 'auto', margin: 0 }} aria-label={`Select ${doc.title}`} />
        )}
        <FileText size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{doc.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {formatBytes(doc.file_size)} · uploaded by {doc.profiles?.full_name || 'Unknown'} · {new Date(doc.created_at).toLocaleDateString()}
            {search && folders && folderName(doc) ? ` · in ${folderName(doc)}` : ''}
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
  );

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Documents</h1>
          <p className="page-subtitle">Policies, RAMS, insurance and other files shared with staff, in folders</p>
        </div>
        {folders && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary docs-btn" onClick={suggestFolders} disabled={sorting || !documents.length} title="Let AI suggest a folder for each document, from its name - you approve every move">
              <Sparkles size={15} aria-hidden /> {sorting ? 'Thinking...' : 'Sort with AI'}
            </button>
            <button type="button" className="btn-secondary docs-btn" onClick={() => setManaging((m) => !m)} aria-expanded={managing}>
              <Settings2 size={15} aria-hidden /> {managing ? 'Done' : 'Manage folders'}
            </button>
          </div>
        )}
      </div>

      {!folders && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13.5 }}>Folders aren't switched on yet. Run <code>0141_document_folders.sql</code> in Supabase, then reload.</p>
        </div>
      )}

      {suggestions && (
        <div className="card docs-suggest" style={{ marginBottom: 16 }}>
          <div className="pj-section-head">
            <h2 style={{ margin: 0 }}>Suggested folders</h2>
            <button type="button" className="pj-text-btn" onClick={() => setSuggestions(null)}>Close</button>
          </div>
          {suggestions.length === 0 ? (
            <p className="pj-muted" style={{ margin: 0 }}>Everything already looks to be in the right place.</p>
          ) : (
            <>
              <p className="pj-muted" style={{ margin: '0 0 8px' }}>From the document names only. Untick anything you don't want moved, or pick a different folder. Nothing in Contracts is suggested out of it.</p>
              <ul className="docs-suggest-list">
                {suggestions.map((s, i) => (
                  <li key={s.id}>
                    <input type="checkbox" checked={s.include} onChange={() => setSuggestions((list) => list.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))} style={{ width: 'auto', margin: 0 }} aria-label={`Move ${s.title}`} />
                    <span className="docs-suggest-title">{s.title}<span className="pj-task-meta"> {s.reason}</span></span>
                    <span className="pj-task-meta">{folderById.get(s.from_folder_id)?.name || 'Unsorted'} →</span>
                    <select value={s.folder_id} onChange={(e) => setSuggestions((list) => list.map((x, j) => (j === i ? { ...x, folder_id: e.target.value } : x)))} aria-label="Move to">
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-primary" onClick={applySuggestions} disabled={moving || !suggestions.some((s) => s.include)} style={{ marginTop: 10, width: 'auto' }}>
                {moving ? 'Moving...' : `Move ${suggestions.filter((s) => s.include).length} document${suggestions.filter((s) => s.include).length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      )}

      {managing && folders && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Folders</h2>
          <ul className="docs-folder-list">
            {folders.map((f, i) => (
              <li key={f.id}>
                <input
                  value={names[f.id] ?? f.name}
                  onChange={(e) => setNames((n) => ({ ...n, [f.id]: e.target.value }))}
                  onBlur={() => renameFolder(f)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  aria-label={`Rename ${f.name}`}
                />
                {f.category === 'contract' && <span className="pj-task-meta" title="Documents here are admin-only in the AI chat">Admins only in AI chat</span>}
                <span className="pj-task-meta">{documents.filter((d) => d.folder_id === f.id).length}</span>
                <button type="button" className="pj-icon-btn" onClick={() => moveFolder(f, -1)} disabled={i === 0} aria-label={`Move ${f.name} up`}><ChevronUp size={15} /></button>
                <button type="button" className="pj-icon-btn" onClick={() => moveFolder(f, 1)} disabled={i === folders.length - 1} aria-label={`Move ${f.name} down`}><ChevronDown size={15} /></button>
                <button type="button" className="pj-icon-btn" onClick={() => deleteFolder(f)} aria-label={`Delete ${f.name}`}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
          <form className="docs-add-folder" onSubmit={addFolder}>
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder name" aria-label="New folder name" />
            <select value={newKind} onChange={(e) => setNewKind(e.target.value)} aria-label="Kind of folder">
              {FOLDER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <button type="submit" className="btn-secondary docs-btn" disabled={!newFolder.trim()}><FolderPlus size={15} aria-hidden /> Add</button>
          </form>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Upload</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
          Select one or more files - they'll all go into the {folders ? 'folder' : 'category'} below.
        </p>
        <div className="field">
          <label className="field-label">{folders ? 'Folder' : 'Category'}</label>
          {folders ? (
            <select value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)}>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : (
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          )}
        </div>

        <div className="field" style={{ marginBottom: audience === 'specific' ? 10 : 14 }}>
          <label className="field-label">Share with</label>
          <div className="seg" style={{ width: '100%' }}>
            <button
              type="button"
              className={`seg-btn${audience === 'everyone' ? ' is-active' : ''}`} aria-pressed={audience === 'everyone'}
              onClick={() => setAudience('everyone')}
              style={{ flex: 1 }}
              title="Share whatever you upload next with every member of staff"
            >
              Everyone
            </button>
            <button
              type="button"
              className={`seg-btn${audience === 'specific' ? ' is-active' : ''}`} aria-pressed={audience === 'specific'}
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
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
            onChange={handleUpload}
            disabled={uploading}
          />
        </div>
        {uploading && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>Uploading...</p>}
      </div>

      {documents.length > 0 && (
        <div className="docs-toolbar">
          <div className="docs-search">
            <Search size={15} aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents" aria-label="Search documents" />
          </div>
          {folders && selected.length > 0 && (
            <div className="docs-move-bar">
              <span>{selected.length} selected</span>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move selected to">
                <option value="">Move to...</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button type="button" className="btn-primary docs-btn" onClick={moveSelected} disabled={!moveTo || moving}>{moving ? 'Moving...' : 'Move'}</button>
              <button type="button" className="pj-text-btn" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}
        </div>
      )}

      {documents.length === 0 && <EmptyState icon={EmptyIconFolder} title="No documents uploaded yet" body="Policies, handbooks and forms you upload here can be shared with staff." />}
      {documents.length > 0 && search && visibleDocs.length === 0 && <p className="pj-muted">No documents match "{search}".</p>}

      {groups.map(({ folder, docs }) => {
        const isCollapsed = !search && collapsed[folder.id];
        return (
          <div key={folder.id} className="card" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className="docs-folder-head"
              onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
              <h2 style={{ margin: 0 }}>{folder.name} <span className="pj-muted">({docs.length})</span></h2>
              {folder.id === UNSORTED && <span className="pj-task-meta">Not in a folder</span>}
            </button>
            {!isCollapsed && docs.length === 0 && <p className="pj-muted" style={{ margin: '8px 0 0' }}>Empty.</p>}
            {!isCollapsed && docs.map(docRow)}
          </div>
        );
      })}
    </div>
  );
}
