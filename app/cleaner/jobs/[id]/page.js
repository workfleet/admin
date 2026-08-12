'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '../../../../lib/supabaseClient';

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

  useEffect(() => {
    loadJob();
  }, [id]);

  const loadJob = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const { data: jobData } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address, notes, lat, lng)')
      .eq('id', id)
      .single();

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

  const handleCheckIn = async () => {
    const { lat, lng } = await getLocation();
    const { data, error } = await supabase
      .from('checkins')
      .insert({ job_id: id, cleaner_id: userId, checked_in_at: new Date().toISOString(), lat, lng })
      .select()
      .single();

    if (!error) {
      setCheckin(data);
      await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', id);
      setJob((j) => ({ ...j, status: 'in_progress' }));
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

    await supabase.from('jobs').update({ status: 'completed' }).eq('id', id);
    setJob((j) => ({ ...j, status: 'completed' }));
    setCheckin((c) => ({ ...c, checked_out_at: new Date().toISOString() }));
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
  const isHistory = job.status === 'completed';

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
        {!checkin && !isHistory && <button onClick={handleCheckIn}>Check In</button>}
        {!checkin && isHistory && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No check-in was recorded.</p>}
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
