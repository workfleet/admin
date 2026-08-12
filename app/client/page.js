'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { notify } from '../../lib/notify';

export default function ClientPortal() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [expandedJob, setExpandedJob] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [checkin, setCheckin] = useState(null);

  const [clientId, setClientId] = useState(null);
  const [clientName, setClientName] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    loadJobs();
    loadMessages();
  }, []);

  const loadJobs = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, properties(address), profiles(full_name)')
      .order('scheduled_at', { ascending: false });

    setJobs(data || []);
  };

  const loadMessages = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from('profiles').select('client_id').eq('id', session.user.id).single();
    if (!profile?.client_id) return;
    setClientId(profile.client_id);

    const { data: clientRow } = await supabase
      .from('clients').select('name').eq('id', profile.client_id).single();
    setClientName(clientRow?.name || 'A client');

    const { data } = await supabase
      .from('client_messages')
      .select('id, sender, body, created_at, read_by_client')
      .eq('client_id', profile.client_id)
      .order('created_at', { ascending: true });

    setMessages(data || []);

    const unreadIds = (data || []).filter((m) => m.sender === 'admin' && !m.read_by_client).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('client_messages').update({ read_by_client: true }).in('id', unreadIds);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !clientId) return;
    setSendingMessage(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('client_messages')
      .insert({
        client_id: clientId,
        sender: 'client',
        sender_profile_id: session.user.id,
        body: newMessage.trim(),
        read_by_client: true,
      })
      .select('id, sender, body, created_at, read_by_client')
      .single();

    setSendingMessage(false);
    if (data) {
      setMessages((prev) => [...prev, data]);
      setNewMessage('');
      notify({ type: 'client_message', clientName, body: data.body });
    }
  };

  const openJob = async (jobId) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobId);

    const [{ data: taskData }, { data: photoData }, { data: checkinData }] = await Promise.all([
      supabase.from('tasks').select('*').eq('job_id', jobId),
      supabase.from('photos').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
      supabase.from('checkins').select('*').eq('job_id', jobId).maybeSingle(),
    ]);

    // photos.url stores the job-photos storage path, not a public URL —
    // the bucket is private, so each photo needs a freshly signed URL.
    const photosWithUrls = await Promise.all(
      (photoData || []).map(async (p) => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      })
    );

    setTasks(taskData || []);
    setPhotos(photosWithUrls);
    setCheckin(checkinData);
  };

  return (
    <div className="container">
      <h1>Cleaning Log</h1>

      <div className="card">
        <h2>Message Us</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 10px' }}>
          Questions, changes to a booking, or want to schedule a new clean? Send us a message.
        </p>

        {messages.length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'client' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.sender === 'client' ? 'var(--brand-primary)' : '#f1f5f9',
                  color: m.sender === 'client' ? 'white' : 'inherit',
                  borderRadius: 14,
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: 14 }}>{m.body}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                  {m.sender === 'client' ? 'You' : 'CrewConnect'} · {new Date(m.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={sendingMessage || !newMessage.trim()}>
            {sendingMessage ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>

      {jobs.length === 0 && <p>No jobs recorded yet.</p>}

      {jobs.map((job) => (
        <div key={job.id} className="card">
          <div onClick={() => openJob(job.id)} style={{ cursor: 'pointer' }}>
            <h2>{job.properties?.address}</h2>
            <p style={{ margin: '4px 0', fontSize: 14 }}>
              {new Date(job.scheduled_at).toLocaleString()} — {job.profiles?.full_name || 'Unassigned'}
            </p>
            <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
          </div>

          {expandedJob === job.id && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              {checkin && (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Checked in: {checkin.checked_in_at ? new Date(checkin.checked_in_at).toLocaleTimeString() : '—'}{' '}
                  · Checked out: {checkin.checked_out_at ? new Date(checkin.checked_out_at).toLocaleTimeString() : '—'}
                </p>
              )}

              <h2 style={{ marginTop: 10 }}>Tasks</h2>
              {tasks.map((t) => (
                <div key={t.id} className={`task-row ${t.completed ? 'done' : ''}`}>
                  {t.completed ? (
                    <CheckCircle2 size={16} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Circle size={16} color="var(--muted)" style={{ flexShrink: 0 }} />
                  )}
                  <span>{t.description}</span>
                </div>
              ))}

              <h2 style={{ marginTop: 10 }}>Photos</h2>
              <div className="photo-grid">
                {photos.map((p) => (
                  <img key={p.id} src={p.signedUrl} alt="job" />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
