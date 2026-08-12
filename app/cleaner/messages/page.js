'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

export default function CleanerMessages() {
  const router = useRouter();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleanerName, setCleanerName] = useState('A cleaner');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase
      .from('profiles').select('full_name').eq('id', session.user.id).single();
    if (profile?.full_name) setCleanerName(profile.full_name);

    const { data } = await supabase
      .from('staff_messages')
      .select('id, sender, body, created_at, read_by_cleaner')
      .order('created_at', { ascending: true });

    setMessages(data || []);
    setLoading(false);

    const unreadIds = (data || []).filter((m) => m.sender === 'admin' && !m.read_by_cleaner).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('staff_messages').update({ read_by_cleaner: true }).in('id', unreadIds);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setSending(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('staff_messages')
      .insert({
        cleaner_id: session.user.id,
        sender: 'cleaner',
        sender_profile_id: session.user.id,
        body: newMessage.trim(),
        read_by_cleaner: true,
      })
      .select('id, sender, body, created_at, read_by_cleaner')
      .single();

    setSending(false);
    if (data) {
      setMessages((prev) => [...prev, data]);
      setNewMessage('');
      notify({ type: 'staff_message', cleanerName, body: data.body });
    }
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>Messages</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Reach admin directly — schedule questions, quick check-ins, anything not job-specific.
      </p>

      <div className="card">
        {messages.length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'cleaner' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.sender === 'cleaner' ? 'var(--brand-primary)' : '#f1f5f9',
                  color: m.sender === 'cleaner' ? 'white' : 'inherit',
                  borderRadius: 14,
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: 14 }}>{m.body}</div>
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                  {m.sender === 'cleaner' ? 'You' : 'Admin'} · {new Date(m.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 && <p className="empty-state">No messages yet. Say hello!</p>}

        <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={sending || !newMessage.trim()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
