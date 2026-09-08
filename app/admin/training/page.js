'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Trash2, ChevronUp, ChevronDown, Play, Eye } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { TRAINING_SECTIONS, TRAINING_SECTION_LABELS, formatDuration } from '../../../lib/trainingSections';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

// Read the real length off the file the browser is about to upload, so the
// duration beside a video is always that video's own length rather than
// something typed in and later wrong. Resolves null rather than rejecting -
// a missing duration is a blank label, not a failed upload.
function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration) : null);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    probe.src = url;
  });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminTraining() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const fileInputs = useRef({});

  const [videos, setVideos] = useState([]);
  const [viewsByVideo, setViewsByVideo] = useState({});
  const [cleanerCount, setCleanerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ title: '', blurb: '', section: 'getting_started' });
  const [isAdding, setIsAdding] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [{ data: videoRows }, { data: viewRows }, { count }] = await Promise.all([
      supabase
        .from('training_videos')
        .select('id, title, blurb, section, position, duration_seconds, storage_path, file_name, file_size')
        .order('position'),
      supabase.from('training_video_views').select('video_id, completed_at'),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'cleaner')
        .eq('active', true),
    ]);

    const tally = {};
    (viewRows || []).forEach((v) => {
      if (!tally[v.video_id]) tally[v.video_id] = { started: 0, completed: 0 };
      tally[v.video_id].started += 1;
      if (v.completed_at) tally[v.video_id].completed += 1;
    });

    setVideos(videoRows || []);
    setViewsByVideo(tally);
    setCleanerCount(count || 0);
    setLoading(false);
  };

  const handleUpload = async (video, e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('That is not a video file.');
      e.target.value = '';
      return;
    }
    setUploadingId(video.id);

    const duration = await readDuration(file);
    const storagePath = `${video.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
      .from('training-videos')
      .upload(storagePath, file);

    if (uploadError) {
      toast.error(`Could not upload ${file.name}.`);
      setUploadingId(null);
      if (e.target) e.target.value = '';
      return;
    }

    const previousPath = video.storage_path;
    const { error } = await supabase
      .from('training_videos')
      .update({
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        duration_seconds: duration,
        uploaded_by: userId,
      })
      .eq('id', video.id);

    if (error) {
      toast.error(`Uploaded ${file.name} but couldn't save it - try again.`);
      setUploadingId(null);
      if (e.target) e.target.value = '';
      return;
    }

    // Only once the row points at the new file, so a failure above leaves
    // the old video still playing rather than leaving the slot empty.
    if (previousPath) await supabase.storage.from('training-videos').remove([previousPath]);

    setVideos((prev) => prev.map((v) => (v.id === video.id
      ? { ...v, storage_path: storagePath, file_name: file.name, file_size: file.size, duration_seconds: duration }
      : v)));
    setUploadingId(null);
    if (e.target) e.target.value = '';
    toast.success(`"${video.title}" is now live for cleaners.`);
  };

  const handleRemoveFile = async (video) => {
    if (!(await confirm(
      `Take "${video.title}" down? Cleaners will stop seeing it until you upload a new file. The slot and its wording stay.`,
      { title: 'Take video down', danger: true }
    ))) return;

    const { error } = await supabase
      .from('training_videos')
      .update({ storage_path: null, file_name: null, file_size: null, duration_seconds: null })
      .eq('id', video.id);
    if (error) { toast.error('Could not take that video down.'); return; }

    await supabase.storage.from('training-videos').remove([video.storage_path]);
    setVideos((prev) => prev.map((v) => (v.id === video.id
      ? { ...v, storage_path: null, file_name: null, file_size: null, duration_seconds: null }
      : v)));
    toast.success('Video taken down.');
  };

  const handlePreview = async (video) => {
    const { data, error } = await supabase.storage
      .from('training-videos')
      .createSignedUrl(video.storage_path, 3600);
    if (error || !data) { toast.error('Could not open this video.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const startEdit = (video) => {
    setIsAdding(false);
    setEditingId(video.id);
    setDraft({ title: video.title, blurb: video.blurb || '', section: video.section });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) { toast.error('Give the video a title.'); return; }

    const patch = { title: draft.title.trim(), blurb: draft.blurb.trim() || null, section: draft.section };
    const { error } = await supabase.from('training_videos').update(patch).eq('id', editingId);
    if (error) { toast.error('Could not save those changes.'); return; }

    setVideos((prev) => prev.map((v) => (v.id === editingId ? { ...v, ...patch } : v)));
    setEditingId(null);
    toast.success('Saved.');
  };

  const addVideo = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) { toast.error('Give the video a title.'); return; }

    const nextPosition = videos.length ? Math.max(...videos.map((v) => v.position)) + 1 : 1;
    const { data, error } = await supabase
      .from('training_videos')
      .insert({
        title: draft.title.trim(),
        blurb: draft.blurb.trim() || null,
        section: draft.section,
        position: nextPosition,
      })
      .select('id, title, blurb, section, position, duration_seconds, storage_path, file_name, file_size')
      .single();

    if (error || !data) { toast.error('Could not add that video.'); return; }

    setVideos((prev) => [...prev, data]);
    setIsAdding(false);
    setDraft({ title: '', blurb: '', section: 'getting_started' });
    toast.success('Slot added - upload a file to make it live.');
  };

  const handleDelete = async (video) => {
    if (!(await confirm(
      `Delete "${video.title}" for good? This removes the slot, the file and the record of who has watched it.`,
      { title: 'Delete video', danger: true }
    ))) return;

    const { error } = await supabase.from('training_videos').delete().eq('id', video.id);
    if (error) { toast.error('Could not delete that video.'); return; }

    if (video.storage_path) await supabase.storage.from('training-videos').remove([video.storage_path]);
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
    toast.success('Video deleted.');
  };

  // Swaps the two rows' position values rather than renumbering the list, so
  // a reorder is two writes whatever the list length and a failed second
  // write cannot leave the order half-applied across every row.
  const move = async (video, direction) => {
    const ordered = [...videos].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((v) => v.id === video.id);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('training_videos').update({ position: swapWith.position }).eq('id', video.id),
      supabase.from('training_videos').update({ position: video.position }).eq('id', swapWith.id),
    ]);
    if (e1 || e2) { toast.error('Could not reorder - reloading.'); load(); return; }

    setVideos((prev) => prev.map((v) => {
      if (v.id === video.id) return { ...v, position: swapWith.position };
      if (v.id === swapWith.id) return { ...v, position: video.position };
      return v;
    }));
  };

  const draftFields = (onSubmit, submitLabel) => (
    <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
      <div className="field">
        <label className="field-label">Title</label>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} />
      </div>
      <div className="field">
        <label className="field-label">What it covers</label>
        <input
          value={draft.blurb}
          onChange={(e) => setDraft({ ...draft, blurb: e.target.value })}
          maxLength={120}
          placeholder="One line, shown under the title"
        />
      </div>
      <div className="field">
        <label className="field-label">Section</label>
        <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })}>
          {TRAINING_SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>
      <div className="action-row" style={{ marginTop: 10 }}>
        <button type="submit" className="btn-primary">{submitLabel}</button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setEditingId(null); setIsAdding(false); }}
        >
          Cancel
        </button>
      </div>
    </form>
  );

  if (loading) return <div className="page-inner">Loading...</div>;

  const ordered = [...videos].sort((a, b) => a.position - b.position);
  const liveCount = ordered.filter((v) => v.storage_path).length;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Training Videos</h1>
          <p className="page-subtitle">
            The how-to videos cleaners see under Help. {liveCount} of {ordered.length} uploaded
            {liveCount < ordered.length && ' - the rest are hidden from cleaners until you add a file'}.
          </p>
        </div>
      </div>

      {ordered.map((video, index) => {
        const views = viewsByVideo[video.id] || { started: 0, completed: 0 };
        const isEditing = editingId === video.id;
        return (
          <div key={video.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                aria-hidden="true"
                style={{
                  flex: 'none',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: video.storage_path ? 'var(--wf-coral)' : 'var(--wf-ash)',
                  color: video.storage_path ? 'var(--wf-on-coral)' : 'var(--wf-steel)',
                  border: video.storage_path ? 'none' : '1px solid var(--border)',
                  fontFamily: 'var(--wf-data)',
                  fontWeight: 700,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {index + 1}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{video.title}</div>
                {video.blurb && (
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{video.blurb}</div>
                )}
                <div style={{ fontFamily: 'var(--wf-data)', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  {TRAINING_SECTION_LABELS[video.section]}
                  {video.storage_path ? (
                    <>
                      {video.duration_seconds != null && ` · ${formatDuration(video.duration_seconds)}`}
                      {video.file_size ? ` · ${formatBytes(video.file_size)}` : ''}
                    </>
                  ) : (
                    <span style={{ color: 'var(--wf-coral-ink)', fontWeight: 600 }}> · Not uploaded</span>
                  )}
                </div>
                {video.storage_path && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: 'var(--wf-data)',
                      fontSize: 12,
                      color: 'var(--muted)',
                      marginTop: 4,
                    }}
                  >
                    <Eye size={13} />
                    {views.started === 0
                      ? 'Not watched yet'
                      : `${views.completed} of ${cleanerCount} watched to the end${
                          views.started > views.completed ? ` (${views.started - views.completed} started it)` : ''
                        }`}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  className="btn-secondary btn-compact"
                  onClick={() => move(video, -1)}
                  disabled={index === 0}
                  title="Move this video earlier in the running order"
                  aria-label={`Move ${video.title} earlier`}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  className="btn-secondary btn-compact"
                  onClick={() => move(video, 1)}
                  disabled={index === ordered.length - 1}
                  title="Move this video later in the running order"
                  aria-label={`Move ${video.title} later`}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>

            {isEditing ? draftFields(saveEdit, 'Save') : (
              <div className="action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <input
                  ref={(el) => { fileInputs.current[video.id] = el; }}
                  type="file"
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleUpload(video, e)}
                />
                <button
                  className="btn-primary"
                  onClick={() => fileInputs.current[video.id]?.click()}
                  disabled={uploadingId === video.id}
                  title={video.storage_path ? 'Replace the file cleaners see' : 'Upload the video file for this slot'}
                >
                  <Upload size={15} />{' '}
                  {uploadingId === video.id ? 'Uploading...' : video.storage_path ? 'Replace file' : 'Upload file'}
                </button>
                {video.storage_path && (
                  <button className="btn-secondary" onClick={() => handlePreview(video)} title="Watch this video yourself">
                    <Play size={15} /> Preview
                  </button>
                )}
                <button className="btn-secondary" onClick={() => startEdit(video)} title="Change the title, wording or section">
                  Edit
                </button>
                {video.storage_path && (
                  <button className="btn-secondary" onClick={() => handleRemoveFile(video)} title="Hide this from cleaners but keep the slot">
                    Take down
                  </button>
                )}
                <button className="btn-secondary" onClick={() => handleDelete(video)} title="Delete this video and its slot for good">
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {isAdding ? (
        <div className="card">
          <h2>New video</h2>
          {draftFields(addVideo, 'Add slot')}
        </div>
      ) : (
        <button
          className="btn-secondary"
          onClick={() => { setEditingId(null); setIsAdding(true); setDraft({ title: '', blurb: '', section: 'getting_started' }); }}
          title="Add another video to the running order"
        >
          + Video
        </button>
      )}
    </div>
  );
}
