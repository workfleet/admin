'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '../../../../lib/supabaseClient';
import { notify } from '../../../../lib/notify';
import { distanceMeters, GEOFENCE_RADIUS_METERS } from '../../../../lib/geo';

// Leaflet touches `window` at load time, so it can't run during SSR.
const PropertyMap = dynamic(() => import('../../../components/PropertyMap'), { ssr: false });

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
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

  useEffect(() => {
    loadJob();
  }, [id]);

  const loadJob = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const { data: jobData } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, duration_minutes, properties(address, notes, lat, lng)')
      .eq('id', id)
      .single();

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

    setJob(jobData);
    setTasks(taskData || []);
    setPhotos(await withSignedUrls(photoData || []));
    setCheckin(checkinData);
    setExtensionRequests(extensionData || []);
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
      const proceed = confirm("You haven't added any photos for this job. Once you check out you won't be able to add any later. Check out anyway?");
      if (!proceed) return;
    }

    await supabase
      .from('checkins')
      .update({ checked_out_at: new Date().toISOString() })
      .eq('id', checkin.id);

    const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
    if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));
    setCheckin((c) => ({ ...c, checked_out_at: new Date().toISOString() }));
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

  const toggleTask = async (task) => {
    const updated = {
      completed: !task.completed,
      completed_at: !task.completed ? new Date().toISOString() : null,
    };
    await supabase.from('tasks').update(updated).eq('id', task.id);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...updated } : t)));
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

    if (!uploadError) {
      const { data: photoRow } = await supabase
        .from('photos')
        .insert({ job_id: id, uploaded_by: userId, url: fileName })
        .select()
        .single();

      const [withUrl] = await withSignedUrls([photoRow]);
      setPhotos((prev) => [withUrl, ...prev]);
    }
    setUploading(false);
  };

  if (!job) return <div className="container">Loading...</div>;

  // A completed job is history, not something to keep editing - no
  // re-checking-in, no toggling tasks, no adding photos weeks later.
  // Also locks down once THIS cleaner has personally checked out, even if
  // the job as a whole is still in_progress because a teammate on the
  // same job hasn't checked out yet - their part is done either way.
  const isHistory = job.status === 'completed' || !!checkin?.checked_out_at;

  return (
    <div className="container">
      <button onClick={() => router.push(isHistory ? '/cleaner/rota' : '/cleaner')} style={{ background: 'transparent', color: 'var(--brand-primary)', padding: 0, marginBottom: 12 }}>
        ← Back
      </button>

      <h1>{job.properties?.address}</h1>
      <p style={{ color: 'var(--muted)' }}>{new Date(job.scheduled_at).toLocaleString()}</p>
      {isHistory && <span className="badge completed">completed</span>}
      {job.properties?.notes && <p className="card">{job.properties.notes}</p>}

      {job.properties?.lat != null && job.properties?.lng != null && (
        <div className="card">
          <PropertyMap lat={job.properties.lat} lng={job.properties.lng} address={job.properties.address} />
        </div>
      )}

      <div className="card">
        <h2>Check In / Out</h2>
        {!checkin && !isHistory && (
          <button onClick={handleCheckIn} disabled={checkingIn}>
            {checkingIn ? 'Checking location...' : 'Check In'}
          </button>
        )}
        {!checkin && isHistory && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No check-in was recorded.</p>}
        {checkInError && <p style={{ color: 'crimson', fontSize: 13, marginTop: 8 }}>{checkInError}</p>}
        {checkin && (
          <p style={{ fontSize: 14 }}>
            Checked in at {new Date(checkin.checked_in_at).toLocaleTimeString()}
            {checkin.checked_out_at && ` – checked out at ${new Date(checkin.checked_out_at).toLocaleTimeString()}`}
          </p>
        )}
        {checkin && !checkin.checked_out_at && !isHistory && (
          <button onClick={handleCheckOut}>Check Out</button>
        )}
      </div>

      {checkin && !checkin.checked_out_at && !isHistory && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Need More Time?</h2>
            <button className="btn-secondary" onClick={() => setShowExtensionForm((s) => !s)}>
              {showExtensionForm ? 'Cancel' : 'Request'}
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
            Currently allocated: {job.duration_minutes ? `${Math.floor(job.duration_minutes / 60)}h ${job.duration_minutes % 60}m`.replace('0h ', '') : '—'}
          </p>

          {showExtensionForm && (
            <form onSubmit={submitExtensionRequest} style={{ marginTop: 12 }}>
              <label>Extra minutes needed</label>
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
              <button type="submit" disabled={submittingExtension} style={{ width: '100%' }}>
                {submittingExtension ? 'Sending...' : 'Send Request'}
              </button>
            </form>
          )}

          {extensionRequests.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {extensionRequests.map((r) => (
                <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13.5 }}>+{r.requested_minutes} min{r.reason ? ` — ${r.reason}` : ''}</span>
                    <span className={`badge ${r.status === 'approved' ? 'completed' : r.status === 'declined' ? 'missed' : 'scheduled'}`}>
                      {r.status === 'alternative_suggested' ? 'alternative suggested' : r.status}
                    </span>
                  </div>
                  {r.status === 'alternative_suggested' && r.suggested_scheduled_at && (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                      Suggested: {new Date(r.suggested_scheduled_at).toLocaleString()}
                      {r.suggested_duration_minutes ? ` · ${r.suggested_duration_minutes} min` : ''}
                    </div>
                  )}
                  {r.admin_note && (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>"{r.admin_note}"</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>To-Do List</h2>
        {tasks.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No tasks added yet.</p>}
        {tasks.map((task) => (
          <div key={task.id} className={`task-row ${task.completed ? 'done' : ''}`}>
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => toggleTask(task)}
              disabled={isHistory}
              style={{ width: 'auto', margin: 0 }}
            />
            <span>{task.description}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Photos</h2>
        {!isHistory && photos.length === 0 && (
          <p style={{ fontSize: 13.5, color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: 10, margin: '0 0 10px' }}>
            📷 Remember to take photos before you check out — you won't be able to add them afterwards.
          </p>
        )}
        {!isHistory && (
          <>
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} disabled={uploading} />
            {uploading && <p style={{ fontSize: 13 }}>Uploading...</p>}
          </>
        )}
        {photos.length === 0 && isHistory && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No photos taken.</p>}
        <div className="photo-grid">
          {photos.map((p) => (
            <img key={p.id} src={p.signedUrl} alt="job" />
          ))}
        </div>
      </div>
    </div>
  );
}
