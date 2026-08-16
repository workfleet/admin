'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

export default function ClientMessages() {
  const router = useRouter();
  const [clientId, setClientId] = useState(null);
  const [clientName, setClientName] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    if (!profile?.client_id) { setLoading(false); return; }
    setClientId(profile.client_id);

    const { data: clientRow } = await supabase.from('clients').select('name').eq('id', profile.client_id).single();
    setClientName(clientRow?.name || 'A client');

    const { data } = await supabase
      .from('client_messages')
      .select('id, sender, body, created_at, read_by_client')
      .eq('client_id', profile.client_id)
      .order('created_at', { ascending: true });

    setMessages(data || []);
    setLoading(false);

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

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1>Messages</h1>
          <p className="page-subtitle">Questions, changes to a booking, or want to schedule a new clean? Send us a message.</p>
        </div>
      </div>

      <div className="card">
        {messages.length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'client' ? 'flex-end' : 'flex-start',
                  maxWidth: '70%',
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
        {messages.length === 0 && <p className="empty-state">No messages yet - say hello!</p>}

        <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8 }}>
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, marginBottom: 0 }}
          />
          <button type="submit" disabled={sendingMessage || !newMessage.trim()}>
            {sendingMessage ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
