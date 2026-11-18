'use client';

import EmptyState from '../../components/EmptyState';
import { Folder as EmptyIconFolder } from 'lucide-react';
import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';

const CATEGORY_LABELS = { health_safety: 'Health & Safety', policy: 'Policy', contract: 'Contract', other: 'Other' };
const CATEGORY_ORDER = ['health_safety', 'contract', 'policy', 'other'];

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientDocuments() {
  const router = useRouter();
  const [documents, setDocuments] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('company_documents')
      .select('id, title, category, storage_path, file_name, file_size, created_at, client_id')
      .order('created_at', { ascending: false });

    setDocuments(data || []);
    setLoading(false);
  };

  const handleDownload = async (doc) => {
    const { data } = await supabase.storage.from('company-documents').createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  if (loading) return <PageSkeleton className="" rows={3} />;

  // Our compliance pack (0148): office documents shared with every client
  // have no client_id. Everything else was shared with this client only.
  const pack = documents.filter((d) => !d.client_id);
  const own = documents.filter((d) => d.client_id);

  const row = (doc) => (
    <div
      key={doc.id}
      className="task-row"
      style={{ justifyContent: 'space-between', cursor: 'pointer' }}
      onClick={() => handleDownload(doc)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <FileText size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{formatBytes(doc.file_size)}</div>
        </div>
      </div>
      <Download size={18} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
    </div>
  );

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Documents</h1>
          <p className="page-subtitle">Health &amp; safety documents and anything else we've shared with you</p>
        </div>
      </div>

      {documents.length === 0 && <EmptyState icon={EmptyIconFolder} title="Nothing shared with you yet" body="Reports and documents we send you will appear here." />}

      {pack.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Our insurance, policies and safety documents</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 8px' }}>
            Kept up to date by us - download them any time you need them for your own records or an audit.
          </p>
          {pack.map(row)}
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const docsInCategory = own.filter((d) => d.category === cat);
        if (docsInCategory.length === 0) return null;
        return (
          <div key={cat} className="card" style={{ marginBottom: 16 }}>
            <h2>{CATEGORY_LABELS[cat]}{pack.length > 0 ? ' - for you' : ''}</h2>
            {docsInCategory.map(row)}
          </div>
        );
      })}
    </div>
  );
}
