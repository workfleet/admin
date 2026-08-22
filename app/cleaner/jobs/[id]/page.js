'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ChevronLeft, Camera, Lock, Check, ChevronDown } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { notify } from '../../../../lib/notify';
import { distanceMeters, GEOFENCE_RADIUS_METERS } from '../../../../lib/geo';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';

// Leaflet touches `window` at load time, so it can't run during SSR.
const PropertyMap = dynamic(() => import('../../../components/PropertyMap'), { ssr: false });

function clock(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatSpan(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const EXTENSION_PILL = {
  approved: 'wf-pill-verified',
  declined: 'wf-pill-overdue',
};

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [checkin, setCheckin] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [showExtensionForm, setShowExtensionForm] = useState(false);
  const [requestMinutes, setRequestMinutes] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [submittingExtension, setSubmittingExtension] = useState(false);
  const [checkInError, setCheckInError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checklistItems, setChecklistItems] = useState([]);
  const [showChecklist, setShowChecklist] = useState(false);
  const [coverOffer, setCoverOffer] = useState(null);
  const [showCoverForm, setShowCoverForm] = useState(false);
  const [coverReason, setCoverReason] = useState('');
  const [submittingCover, setSubmittingCover] = useState(false);
  const [nextJob, setNextJob] = useState(null);
  // Starts null so the server and the first client render agree - the
  // on-site timer only starts once we're on the client.
  const [now, setNow] = useState(null);

  useEffect(() => {
    loadJob();
  }, [id]);

  // The status strip counts up while someone is on site, so it needs its own
  // clock. Every 30s is enough for a figure shown to the minute.
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);

  const loadJob = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const { data: jobData } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, duration_minutes, property_id, properties(address, notes, client_access_notes, lat, lng, clients(name))')
      .eq('id', id)
      .single();

    const { data: checklistData } = jobData?.property_id
      ? await supabase
          .from('property_checklist_items')
          .select('id, room, task')
          .eq('property_id', jobData.property_id)
          .order('sort_order', { ascending: true })
      : { data: [] };

    const { data: extensionData } = await supabase
      .from('time_extension_requests')
      .select('*')
      .eq('job_id', id)
      .eq('cleaner_id', session.user.id)
      .order('created_at', { ascending: false });

    const { data: taskData } = await supabase
      .from('tasks')
      .select('*')
      .eq('job_id', id);

    const { data: photoData } = await supabase
      .from('photos')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false });

    const { data: checkinData } = await supabase
      .from('checkins')
      .select('*')
      .eq('job_id', id)
      .eq('cleaner_id', session.user.id)
      .maybeSingle();

    const { data: offerData } = await supabase
      .from('shift_offers')
      .select('id, status, released_by, created_at')
      .eq('job_id', id)
      .eq('status', 'open')
      .maybeSingle();

    // What to send them to once this one is finished. Without it the end of
    // a job is a dead end and they go hunting through the rota for the next.
    const { data: nextData } = await supabase
      .from('job_assignments')
      .select('jobs!inner(id, scheduled_at, properties(address, clients(name)))')
      .eq('cleaner_id', session.user.id)
      .gt('jobs.scheduled_at', new Date().toISOString())
      .neq('jobs.id', id)
      .order('scheduled_at', { referencedTable: 'jobs', ascending: true })
      .limit(1);

    setJob(jobData);
    setTasks(taskData || []);
    setPhotos(await withSignedUrls(photoData || []));
    setCheckin(checkinData);
    setExtensionRequests(extensionData || []);
    setChecklistItems(checklistData || []);
    setCoverOffer(offerData || null);
    setNextJob(nextData?.[0]?.jobs || null);
  };

  // photos.url stores the job-photos storage path (not a public URL) since
  // the bucket is private — every photo needs a freshly signed URL to view.
  const withSignedUrls = async (rows) =>
    Promise.all(
      rows.map(async (p) => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      })
    );

  // Downscales + re-encodes as JPEG in the browser before upload, so
  // cleaners on mobile data aren't sending full-resolution photos.
  const compressImage = (file, maxDimension = 1600, quality = 0.75) =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(file);
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });

  const getLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: null, lng: null })
      );
    });

  // jobs.status is no longer set from here - with multiple cleaners
  // possibly assigned to the same job, a database trigger derives it from
  // everyone's check-in state (in_progress once anyone's checked in,
  // completed only once everyone has checked out), so it's re-read after
  // each check-in/out rather than guessed at client-side.
  const handleCheckIn = async () => {
    setCheckInError('');
    setCheckingIn(true);
    const { lat, lng } = await getLocation();

    // Only enforce the geofence when both the property and this check-in
    // have real coordinates - properties added before geolocation existed
    // (or a check-in with GPS unavailable) fall back to the old
    // no-verification behaviour rather than blocking someone from working.
    const propertyLat = job.properties?.lat;
    const propertyLng = job.properties?.lng;
    if (propertyLat != null && propertyLng != null && lat != null && lng != null) {
      const distance = distanceMeters(lat, lng, propertyLat, propertyLng);
      if (distance > GEOFENCE_RADIUS_METERS) {
        setCheckInError(`You're too far from this property to check in (about ${Math.round(distance)}m away). Move closer and try again.`);
        setCheckingIn(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from('checkins')
      .insert({ job_id: id, cleaner_id: userId, checked_in_at: new Date().toISOString(), lat, lng })
      .select()
      .single();

    setCheckingIn(false);
    if (!error) {
      setCheckin(data);
      const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
      if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));
    }
  };

  const handleCheckOut = async () => {
    if (photos.length === 0) {
      const proceed = await confirm(
        "You haven't added any photos for this job. Once you check out you won't be able to add any later. Check out anyway?",
        { title: 'No photos added', danger: true, confirmLabel: 'Check out anyway' }
      );
      if (!proceed) return;
    }

    setCheckingOut(true);
    const { error } = await supabase
      .from('checkins')
      .update({ checked_out_at: new Date().toISOString() })
      .eq('id', checkin.id);

    setCheckingOut(false);
    if (error) { toast.error('Could not check out. Please try again.'); return; }

    const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
    if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));
    setCheckin((c) => ({ ...c, checked_out_at: new Date().toISOString() }));
    toast.success('Checked out.');
  };

  const submitExtensionRequest = async (e) => {
    e.preventDefault();
    const minutes = Number(requestMinutes);
    if (!minutes || minutes <= 0) return;
    setSubmittingExtension(true);

    const { data, error } = await supabase
      .from('time_extension_requests')
      .insert({
        job_id: id,
        cleaner_id: userId,
        requested_minutes: minutes,
        reason: requestReason.trim() || null,
      })
      .select('*')
      .single();

    setSubmittingExtension(false);
    if (error || !data) return;

    setExtensionRequests((prev) => [data, ...prev]);
    setShowExtensionForm(false);
    setRequestMinutes('');
    setRequestReason('');

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
    notify({
      type: 'time_extension_requested',
      cleanerName: profile?.full_name || 'A cleaner',
      address: job.properties?.address,
      requestedMinutes: minutes,
      reason: requestReason.trim() || null,
    });
  };

  // Releasing a shift for cover does NOT unassign this cleaner - they
  // stay on it until someone actually claims it, so an unfilled request
  // can never leave the client with nobody booked in. See 0070.
  const requestCover = async (e) => {
    e.preventDefault();
    const confirmed = await confirm(
      "Ask for cover on this shift? It stays yours until someone else picks it up, and the office will be told straight away.",
      { title: "Can't make this shift" }
    );
    if (!confirmed) return;

    setSubmittingCover(true);
    const { data, error } = await supabase
      .from('shift_offers')
      .insert({
        job_id: id,
        released_by: userId,
        opened_by: userId,
        reason: coverReason.trim() || null,
      })
      .select('id, status, released_by, created_at')
      .single();

    setSubmittingCover(false);
    if (error || !data) {
      toast.error("Couldn't send that - cover may already have been requested for this shift.");
      return;
    }

    setCoverOffer(data);
    setShowCoverForm(false);
    setCoverReason('');
    toast.success('Sent. Other cleaners can now pick this shift up.');

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
    notify({
      type: 'shift_cover_needed',
      cleanerName: profile?.full_name || 'A cleaner',
      releasedByCleanerId: userId,
      address: job.properties?.address,
      scheduledAt: job.scheduled_at,
      reason: coverReason.trim() || null,
    });
  };

  // Ticks straight away and puts the tick back if the save didn't land.
  // Waiting on the round trip on a doorstep with one bar of signal makes
  // the row feel broken; failing silently, as this used to, is worse -
  // the list says done and the office never hears about it.
  const toggleTask = async (task) => {
    const updated = {
      completed: !task.completed,
      completed_at: !task.completed ? new Date().toISOString() : null,
    };
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...updated } : t)));

    const { error } = await supabase.from('tasks').update(updated).eq('id', task.id);
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
      toast.error("Couldn't save that - check your signal and tap it again.");
    }
  };

  const handlePhotoUpload = async (e) => {
    const rawFile = e.target.files[0];
    if (!rawFile) return;
    setUploading(true);

    const file = await compressImage(rawFile);
    const fileName = `${id}/${Date.now()}-${rawFile.name.replace(/\.[^.]+$/, '.jpg')}`;
    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(fileName, file, { contentType: 'image/jpeg' });

    if (uploadError) {
      setUploading(false);
      toast.error("Couldn't send that photo - check your signal and try again.");
      return;
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .insert({ job_id: id, uploaded_by: userId, url: fileName })
      .select()
      .single();

    const [withUrl] = await withSignedUrls([photoRow]);
    setPhotos((prev) => [withUrl, ...prev]);
    setUploading(false);
  };

  if (!job) return <div className="container">Loading...</div>;

  // A completed job is history, not something to keep editing - no
  // re-checking-in, no toggling tasks, no adding photos weeks later.
  // Also locks down once THIS cleaner has personally checked out, even if
  // the job as a whole is still in_progress because a teammate on the
  // same job hasn't checked out yet - their part is done either way.
  const isHistory = job.status === 'completed' || !!checkin?.checked_out_at;
  const onSite = !!checkin && !checkin.checked_out_at && !isHistory;
  const beforeCheckIn = !checkin && !isHistory;

  const placeName = job.properties?.clients?.name || job.properties?.address || 'This job';
  const scheduled = new Date(job.scheduled_at);
  const duration = job.duration_minutes || 120;
  const approvedExtra = extensionRequests
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + (r.requested_minutes || 0), 0);

  const doneTasks = tasks.filter((t) => t.completed).length;
  const mapsHref = job.properties?.lat != null && job.properties?.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.properties.lat},${job.properties.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.properties?.address || '')}`;

  // Minutes on site, and how much of the allowance is left. Both null until
  // the client clock has started.
  const onSiteMinutes = now && checkin ? (now - new Date(checkin.checked_in_at)) / 60000 : null;
  const remainingMinutes = onSiteMinutes === null ? null : duration + approvedExtra - onSiteMinutes;

  return (
    <div className="job-screen">
      <div className="job-appbar">
        <div className="job-appbar-row">
          <button type="button" className="job-appbar-back" onClick={() => router.back()} aria-label="Back">
            <ChevronLeft size={24} strokeWidth={2.5} />
          </button>
          <span className="job-appbar-title">{placeName}</span>
        </div>

        {onSite && (
          <div className="job-status-strip">
            <span className="job-status-dot" />
            <span className="job-status-time">
              On site {onSiteMinutes === null ? '—' : formatSpan(onSiteMinutes)}
            </span>
            {remainingMinutes !== null && (
              <span className={`job-status-left${remainingMinutes < 0 ? ' is-over' : ''}`}>
                {remainingMinutes < 0
                  ? `${formatSpan(-remainingMinutes)} over`
                  : `${formatSpan(remainingMinutes)} left`}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="job-body">
        {/* ---- State 1: not checked in yet ---- */}
        {beforeCheckIn && (
          <>
            <div className="job-title-block">
              <div className="job-when">
                {clock(scheduled)} – {clock(new Date(scheduled.getTime() + duration * 60000))} · {formatSpan(duration)}
              </div>
              <h1 className="job-place">{placeName}</h1>
              <p className="job-address">{job.properties?.address}</p>
            </div>

            {job.properties?.lat != null && job.properties?.lng != null && (
              <div className="job-map">
                <PropertyMap lat={job.properties.lat} lng={job.properties.lng} address={job.properties.address} />
                <a className="job-map-chip" href={mapsHref} target="_blank" rel="noreferrer">Directions</a>
              </div>
            )}

            {/* On a doorstep this is the most-needed thing on the screen, so
                it sits above the task list rather than below the map. */}
            {job.properties?.client_access_notes && (
              <div className="job-card job-access">
                <div className="job-card-label">How to get in</div>
                <p className="job-access-body">{job.properties.client_access_notes}</p>
              </div>
            )}

            {job.properties?.notes && (
              <div className="job-card">
                <div className="job-card-label">Notes for this property</div>
                <p className="job-access-body">{job.properties.notes}</p>
              </div>
            )}

            {/* The full list is deliberately held back until check-in - it's
                a job to do on site, not a thing to read on the bus. */}
            <div className="job-card">
              <div className="job-card-label">
                {tasks.length} task{tasks.length === 1 ? '' : 's'} on this job
              </div>
              <p className="job-task-preview">
                {tasks.length === 0
                  ? 'No tasks have been added to this job yet.'
                  : `${tasks.slice(0, 2).map((t) => t.description).join(', ')}${tasks.length > 2 ? ` and ${tasks.length - 2} more` : ''}. The full list opens when you check in.`}
              </p>
            </div>

            {coverOffer && (
              <div className="job-card">
                <div className="job-card-label">Cover requested</div>
                <p className="job-task-preview">
                  This shift has been offered to the rest of the team. It's still yours until
                  someone picks it up - you'll be told as soon as they do.
                </p>
              </div>
            )}

            {showCoverForm && !coverOffer && (
              <form className="job-card" onSubmit={requestCover}>
                <div className="job-card-label">Why can't you make it? (optional)</div>
                <input
                  value={coverReason}
                  onChange={(e) => setCoverReason(e.target.value)}
                  placeholder="e.g. Off sick, childcare fell through"
                />
                <button type="submit" className="job-btn-secondary" disabled={submittingCover}>
                  {submittingCover ? 'Sending...' : 'Request cover'}
                </button>
              </form>
            )}
          </>
        )}

        {/* ---- State 2: on site ---- */}
        {onSite && (
          <>
            <div className="job-progress">
              <div className="job-progress-head">
                <span className="job-progress-count">{doneTasks} of {tasks.length} done</span>
                <span className="job-progress-hint">Tap to tick off</span>
              </div>
              <div className="job-progress-track">
                <div
                  className="job-progress-fill"
                  style={{ width: tasks.length ? `${(doneTasks / tasks.length) * 100}%` : '0%' }}
                />
              </div>
            </div>

            <div className="job-card job-card-flush">
              {tasks.length === 0 && <p className="job-empty">No tasks added yet.</p>}
              {tasks.map((task) => (
                // The whole row is the hit target, not the circle - a 24px
                // circle is not something to aim at with cold hands.
                <button
                  type="button"
                  key={task.id}
                  className={`job-task${task.completed ? ' is-done' : ''}`}
                  onClick={() => toggleTask(task)}
                >
                  <span className="job-task-check">{task.completed && <Check size={14} strokeWidth={3} />}</span>
                  <span className="job-task-text">{task.description}</span>
                </button>
              ))}
            </div>

            {extensionRequests.length > 0 && (
              <div className="job-card">
                <div className="job-card-label">Extra time</div>
                {extensionRequests.map((r) => (
                  <div key={r.id} className="job-extension">
                    <div className="job-extension-row">
                      <span className="job-extension-text">
                        +{r.requested_minutes} min{r.reason ? ` — ${r.reason}` : ''}
                      </span>
                      <span className={`wf-pill ${EXTENSION_PILL[r.status] || 'wf-pill-progress'}`}>
                        {r.status === 'alternative_suggested' ? 'alternative suggested' : r.status}
                      </span>
                    </div>
                    {r.status === 'alternative_suggested' && r.suggested_scheduled_at && (
                      <div className="job-extension-note">
                        Suggested: {new Date(r.suggested_scheduled_at).toLocaleString()}
                        {r.suggested_duration_minutes ? ` · ${r.suggested_duration_minutes} min` : ''}
                      </div>
                    )}
                    {r.admin_note && <div className="job-extension-note">&ldquo;{r.admin_note}&rdquo;</div>}
                  </div>
                ))}
              </div>
            )}

            {showExtensionForm && (
              <form className="job-card" onSubmit={submitExtensionRequest}>
                <div className="job-card-label">How much longer do you need?</div>
                <label>Extra minutes</label>
                <input
                  type="number"
                  min="1"
                  value={requestMinutes}
                  onChange={(e) => setRequestMinutes(e.target.value)}
                  placeholder="e.g. 30"
                  required
                />
                <label>Reason (optional)</label>
                <input
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="e.g. Extra mess in the kitchen"
                />
                <button type="submit" className="job-btn-secondary" disabled={submittingExtension}>
                  {submittingExtension ? 'Sending...' : 'Send request'}
                </button>
              </form>
            )}

            <div className="job-card">
              <div className="job-card-label">Photos</div>
              <div className="job-photo-row">
                <label className="job-photo-add">
                  <Camera size={20} />
                  <span>{uploading ? 'Sending' : 'Photo'}</span>
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} disabled={uploading} />
                </label>
                {photos.map((p) => (
                  <img key={p.id} className="job-photo-thumb" src={p.signedUrl} alt="job" />
                ))}
              </div>
              {photos.length === 0 ? (
                <p className="job-photo-warning">
                  Take photos before you check out — you won't be able to add them afterwards.
                </p>
              ) : (
                <p className="job-photo-count">{photos.length} photo{photos.length === 1 ? '' : 's'} added</p>
              )}
            </div>

            {/* Collapsed, so a long room-by-room reference can't push the
                actual task list off the screen. */}
            {checklistItems.length > 0 && (
              <div className="job-card job-card-flush">
                <button
                  type="button"
                  className={`job-disclosure${showChecklist ? ' is-open' : ''}`}
                  onClick={() => setShowChecklist((v) => !v)}
                  aria-expanded={showChecklist}
                >
                  <span>Property checklist</span>
                  <ChevronDown size={18} />
                </button>
                {showChecklist && (
                  <div className="job-checklist">
                    {Object.entries(
                      checklistItems.reduce((acc, item) => {
                        (acc[item.room] = acc[item.room] || []).push(item);
                        return acc;
                      }, {})
                    ).map(([room, items]) => (
                      <div key={room} className="job-checklist-room">
                        <div className="job-card-label">{room}</div>
                        {items.map((item) => (
                          <div key={item.id} className="job-checklist-item">{item.task}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ---- State 3: checked out ---- */}
        {isHistory && (
          <>
            <div className="job-done-banner">
              <span className="job-done-mark"><Check size={22} strokeWidth={3} /></span>
              <div>
                <div className="job-done-title">Job done</div>
                <div className="job-done-sub">
                  {checkin?.checked_in_at ? (
                    <>
                      {clock(checkin.checked_in_at)} – {clock(checkin.checked_out_at)}
                      {' · '}{formatSpan((new Date(checkin.checked_out_at) - new Date(checkin.checked_in_at)) / 60000)} on site
                    </>
                  ) : 'No check-in was recorded.'}
                </div>
              </div>
            </div>

            <div className="job-card job-card-flush">
              <div className="job-receipt">
                <span>Tasks completed</span>
                <strong>{doneTasks} of {tasks.length}</strong>
              </div>
              <div className="job-receipt">
                <span>Photos sent to client</span>
                <strong>{photos.length}</strong>
              </div>
              {approvedExtra > 0 && (
                <div className="job-receipt">
                  <span>Extra time approved</span>
                  <strong>+{approvedExtra} min</strong>
                </div>
              )}
            </div>

            {photos.length > 0 && (
              <div>
                <div className="job-card-label job-photos-label">Your photos</div>
                <div className="job-photo-grid">
                  {photos.map((p) => (
                    <img key={p.id} src={p.signedUrl} alt="job" />
                  ))}
                </div>
              </div>
            )}

            {/* Says out loud the read-only rule the code already enforces -
                it used to be a bare "completed" badge and a list that
                silently stopped responding. */}
            <div className="job-card job-locked">
              <Lock size={18} />
              <p>
                This job is locked now — tasks and photos can't be changed.
                Something wrong? Message the office.
              </p>
            </div>
          </>
        )}
      </div>

      {/* One primary action, always in the same place, always reachable
          without scrolling to the end of the page. */}
      <div className="job-actions">
        {beforeCheckIn && (
          <>
            {checkInError && <p className="job-action-error">{checkInError}</p>}
            <button type="button" className="job-btn-primary" onClick={handleCheckIn} disabled={checkingIn}>
              {checkingIn ? 'Checking location...' : 'Check in'}
            </button>
            <p className="job-action-help">Your location is checked — you need to be at the property.</p>
            {!coverOffer && (
              <button type="button" className="job-btn-secondary" onClick={() => setShowCoverForm((v) => !v)}>
                {showCoverForm ? 'Cancel' : "Can't make this shift"}
              </button>
            )}
          </>
        )}

        {onSite && (
          <div className="job-action-row">
            <button
              type="button"
              className="job-btn-secondary job-btn-narrow"
              onClick={() => setShowExtensionForm((v) => !v)}
            >
              {showExtensionForm ? 'Cancel' : 'More time'}
            </button>
            <button type="button" className="job-btn-primary" onClick={handleCheckOut} disabled={checkingOut}>
              {checkingOut ? 'Checking out...' : 'Check out'}
            </button>
          </div>
        )}

        {isHistory && (
          <>
            {nextJob ? (
              <button
                type="button"
                className="job-btn-primary"
                onClick={() => router.push(`/cleaner/jobs/${nextJob.id}`)}
              >
                Next job · {clock(nextJob.scheduled_at)} {nextJob.properties?.clients?.name || nextJob.properties?.address}
              </button>
            ) : (
              <button type="button" className="job-btn-primary" onClick={() => router.push('/cleaner')}>
                Back to today's jobs
              </button>
            )}
            <button type="button" className="job-btn-secondary" onClick={() => router.push('/cleaner/messages')}>
              Message the office
            </button>
          </>
        )}
      </div>
    </div>
  );
}
