'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Download } from 'lucide-react';
import { POLICY_SECTIONS } from '../../../lib/companyPolicies';
import { supabase } from '../../../lib/supabaseClient';
import BackButton from '../../components/BackButton';

const CATEGORY_LABELS = { policy: 'Policy', contract: 'Contract', other: 'Other' };
const CATEGORY_ORDER = ['policy', 'contract', 'other'];

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HELP_SECTIONS = [
  {
    title: 'Checking In & Out of a Job',
    body: 'Tap a job on your Home tab to open it. Tap Check In when you arrive to start the job, then tick off each task as you complete it. When you\'re finished, tap Check Out. Once a job is checked out it moves to your job history and becomes read-only, so double-check everything (especially photos) before you check out.',
  },
  {
    title: 'Taking Job Photos',
    body: 'Photos can only be added while a job is in progress — you\'ll see a reminder if a job has none yet. Once you check out, the job becomes read-only and no more photos can be added, so it\'s best to add them as you go rather than leaving it until the end.',
  },
  {
    title: 'Viewing Your Rota & Hours',
    body: 'The Rota tab shows your upcoming shifts, plus a history of completed jobs with hours worked. Your holiday balance (based on hours you\'ve actually worked) is shown at the top of the page.',
  },
  {
    title: 'Requesting Time Off',
    body: 'From the Rota tab, use the request form to ask for holiday or mark yourself unavailable. Your available balance is shown before you submit — the app won\'t let you request more time off than you\'ve accrued.',
  },
  {
    title: 'Messaging Admin',
    body: 'Use the Messages tab to send the office a message directly — for questions, schedule changes, or anything else. You\'ll see a reply here as soon as admin responds.',
  },
  {
    title: 'Requesting Kit or Reporting an Issue',
    body: 'On your Home tab, use the "Need something?" section to request a kit top-up or report a problem, like faulty equipment. Admin will resolve it and you\'ll see their note once it\'s sorted.',
  },
  {
    title: 'If You Can’t Make a Shift',
    body: 'Open the job and tap "Ask for cover" as early as you can. The shift is offered to everyone else who’s free, and the office is told straight away. It stays your shift until someone actually takes it, so don’t assume it’s covered until you get the notification saying so.',
  },
  {
    title: 'Picking Up Extra Shifts',
    body: 'Shifts that need cover show on your Home tab. First to tap "I’ll take it" gets it. You won’t be able to take one that clashes with a job you’re already on, or that falls on approved time off.',
  },
  {
    title: 'Keys You’re Holding',
    body: 'Any key, fob or access code signed out to you shows on your Home tab. When one is issued, type your name to confirm you’ve got it — that goes on the record. Hand everything back to the office when you finish with it, or when you leave.',
  },
  {
    title: 'Notifications',
    body: 'Notifications appear on your Home tab for things like new shifts being assigned or a time off request being decided. Dismiss ones you\'ve seen with the X — dismissed notifications aren\'t lost, they move into your Notification History (tap "Notifications" next to My Jobs) where they\'re kept for 30 days.',
  },
];

export default function CleanerHelp() {
  const [section, setSection] = useState('guide');
  const [documents, setDocuments] = useState(null);
  const sections = section === 'guide' ? HELP_SECTIONS : section === 'policies' ? POLICY_SECTIONS : null;

  useEffect(() => {
    if (section === 'documents' && documents === null) loadDocuments();
  }, [section]);

  const loadDocuments = async () => {
    const { data } = await supabase
      .from('company_documents')
      .select('id, title, category, storage_path, file_name, file_size, created_at')
      .order('created_at', { ascending: false });
    setDocuments(data || []);
  };

  const handleDownload = async (doc) => {
    const { data } = await supabase.storage.from('company-documents').createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="container">
      <BackButton />
      <h1>Help</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: -8, marginBottom: 16 }}>
        How to use the app, and how we work at CrewConnect Cleaning.
      </p>

      <div className="action-row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={section === 'guide' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('guide')}
        >
          Using the App
        </button>
        <button
          type="button"
          className={section === 'policies' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('policies')}
        >
          Company Policies
        </button>
        <button
          type="button"
          className={section === 'documents' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('documents')}
        >
          Documents
        </button>
      </div>

      {sections && sections.map((s) => (
        <div key={s.title} className="card" style={{ marginBottom: 12 }}>
          <h2>{s.title}</h2>
          <p style={{ fontSize: 14, margin: '6px 0 0', lineHeight: 1.5 }}>{s.body}</p>
        </div>
      ))}

      {section === 'documents' && (
        <>
          {documents === null && <p className="empty-state">Loading...</p>}
          {documents?.length === 0 && <p className="empty-state">No documents have been shared yet.</p>}
          {CATEGORY_ORDER.map((cat) => {
            const docsInCategory = (documents || []).filter((d) => d.category === cat);
            if (docsInCategory.length === 0) return null;
            return (
              <div key={cat} className="card" style={{ marginBottom: 12 }}>
                <h2>{CATEGORY_LABELS[cat]}</h2>
                {docsInCategory.map((doc) => (
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
                ))}
              </div>
            );
          })}
        </>
      )}

      <p style={{ fontSize: 13.5, marginTop: 16 }}>
        <Link href="/privacy">Privacy Notice</Link>
      </p>
    </div>
  );
}
