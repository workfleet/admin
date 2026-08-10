'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';

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
      .select('id, scheduled_at, status, properties(address, notes)')
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
    setPhotos(photoData || []);
    setCheckin(checkinData);
  };

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
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);

    const fileName = `${id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(fileName, file);

    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(fileName);

      const { data: photoRow } = await supabase
        .from('photos')
        .insert({ job_id: id, uploaded_by: userId, url: urlData.publicUrl })
        .select()
        .single();

      setPhotos((prev) => [photoRow, ...prev]);
    }
    setUploading(false);
  };

  if (!job) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <button onClick={() => router.push('/cleaner')} style={{ background: 'transparent', color: '#2563eb', padding: 0, marginBottom: 12 }}>
        ← Back
      </button>

      <h1>{job.properties?.address}</h1>
      <p style={{ color: '#6b7280' }}>{new Date(job.scheduled_at).toLocaleString()}</p>
      {job.properties?.notes && <p className="card">{job.properties.notes}</p>}

      <div className="card">
        <h2>Check In / Out</h2>
        {!checkin && <button onClick={handleCheckIn}>Check In</button>}
        {checkin && !checkin.checked_out_at && (
          <>
            <p style={{ fontSize: 14 }}>Checked in at {new Date(checkin.checked_in_at).toLocaleTimeString()}</p>
            <button onClick={handleCheckOut}>Check Out</button>
          </>
        )}
        {checkin?.checked_out_at && (
          <p style={{ fontSize: 14 }}>
            Checked out at {new Date(checkin.checked_out_at).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="card">
        <h2>To-Do List</h2>
        {tasks.length === 0 && <p style={{ fontSize: 14, color: '#6b7280' }}>No tasks added yet.</p>}
        {tasks.map((task) => (
          <div key={task.id} className={`task-row ${task.completed ? 'done' : ''}`}>
            <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task)} style={{ width: 'auto', margin: 0 }} />
            <span>{task.description}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Photos</h2>
        <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} disabled={uploading} />
        {uploading && <p style={{ fontSize: 13 }}>Uploading...</p>}
        <div className="photo-grid">
          {photos.map((p) => (
            <img key={p.id} src={p.url} alt="job" />
          ))}
        </div>
      </div>
    </div>
  );
}
