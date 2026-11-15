'use client';

import { useState } from 'react';
import { Package, Check, AlertTriangle, HelpCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { companyFromSettings } from '../../lib/companyBranding';
import { readableKind } from '../../lib/projectAi';
import { packageEntries, zipFileName, contentsMarkdown } from '../../lib/projectPackage';
import { localDateString } from '../../lib/localDate';

// "Package" on a project's Files card: every file in one zip, numbered,
// with a contents sheet - and, if AI is on for the project, a check of
// what's missing first. The zip is made in this browser from each file's
// own signed link, so its size isn't limited by the server.

const ICONS = { present: Check, missing: AlertTriangle, unclear: HelpCircle };
const WORDS = { present: 'Uploaded', missing: 'Missing', unclear: 'Check' };

export default function ProjectPackage({ project, files, aiEnabled, nameOf, onUsed, onClose }) {
  const [against, setAgainst] = useState('');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const readable = files.filter((f) => readableKind(f.file_name));

  const runCheck = async () => {
    setChecking(true); setError(''); setCheck(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/projects/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ project_id: project.id, tool: 'check', requirements_file_id: against || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { setError(data?.message || (res.status === 504 ? 'That took too long - try again.' : 'The check didn\'t work. Please try again.')); return; }
      setCheck(data);
      onUsed?.();
    } catch {
      setError('Couldn\'t reach the server - check your connection.');
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    setError('');
    const entries = packageEntries(files);
    try {
      const [{ default: JSZip }, { buildDraftDocx }, { Packer }, { data: settings }] = await Promise.all([
        import('jszip'),
        import('../../lib/draftDocx'),
        import('docx'),
        supabase.from('company_settings').select('*').limit(1).maybeSingle(),
      ]);
      const zip = new JSZip();
      const failed = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        setProgress(`Adding ${i + 1} of ${entries.length}: ${e.file_name}`);
        const { data: signed } = await supabase.storage.from('project-files').createSignedUrl(e.storage_path, 600);
        const res = signed?.signedUrl ? await fetch(signed.signedUrl).catch(() => null) : null;
        if (!res || !res.ok) { failed.push(e.file_name); continue; }
        zip.file(e.path || e.zipName, await res.blob());
      }
      setProgress('Writing the contents sheet...');
      const today = new Date();
      const md = contentsMarkdown({
        project,
        entries: entries.filter((e) => !failed.includes(e.file_name)),
        check,
        nameOf,
        todayLabel: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      });
      zip.file('00 - Contents.docx', await Packer.toBlob(buildDraftDocx(md, companyFromSettings(settings))));
      setProgress('Zipping...');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFileName(project.name, localDateString(today));
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setProgress('');
      if (failed.length) setError(`Downloaded, but ${failed.length} file${failed.length === 1 ? '' : 's'} couldn't be added: ${failed.join(', ')}.`);
    } catch {
      setProgress('');
      setError('The zip couldn\'t be made. Please try again.');
    }
  };

  const missing = check?.items.filter((i) => i.status === 'missing').length || 0;

  return (
    <div className="pj-package">
      <div className="pj-section-head" style={{ marginBottom: 6 }}>
        <h3 className="pj-ai-subhead" style={{ margin: 0 }}><Package size={14} aria-hidden /> Package the files</h3>
        <button type="button" className="pj-text-btn" onClick={onClose}>Close</button>
      </div>
      <p className="pj-muted" style={{ margin: '0 0 8px' }}>
        One zip of all {files.length} file{files.length === 1 ? '' : 's'}, numbered in the order they were added, with a contents sheet.
      </p>

      {aiEnabled ? (
        <div className="pj-package-check">
          <label className="field-label" htmlFor="pkg-against">Check what's missing first (optional)</label>
          <select id="pkg-against" value={against} onChange={(e) => setAgainst(e.target.value)} disabled={checking}>
            <option value="">Against the project's tasks</option>
            {readable.map((f) => <option key={f.id} value={f.id}>Against {f.file_name}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={runCheck} disabled={checking || Boolean(progress)} style={{ marginTop: 6 }}>
            {checking ? 'Checking... (up to a minute)' : check ? 'Check again' : 'Check'}
          </button>
        </div>
      ) : (
        <p className="pj-muted" style={{ margin: '0 0 8px' }}>AI is switched off for this project, so there's no automatic check - the zip still works.</p>
      )}

      {check && (
        <div className="pj-package-result">
          <p className={missing ? 'pj-late' : 'draft-done'} style={{ margin: '8px 0 6px' }}>
            {missing ? `${missing} item${missing === 1 ? '' : 's'} not found in the files` : 'Every item was matched to a file'} - checked against {check.against}.
          </p>
          <ul className="pj-package-items">
            {check.items.map((i, n) => {
              const Icon = ICONS[i.status];
              return (
                <li key={n} className={`is-${i.status}`}>
                  <Icon size={14} aria-hidden />
                  <span>
                    <strong>{WORDS[i.status]}:</strong> {i.item}
                    {i.files.length > 0 && <span className="pj-task-meta"> - {i.files.join(', ')}</span>}
                    {i.note && <span className="pj-task-meta"> ({i.note})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="pj-muted" style={{ margin: '6px 0 0' }}>The AI only sees file names, not what's inside them - check before you submit.</p>
        </div>
      )}

      <button type="button" className="btn-primary" onClick={download} disabled={Boolean(progress) || checking || !files.length} style={{ marginTop: 10 }}>
        {progress || 'Download zip'}
      </button>
      {error && <p className="pj-late" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
