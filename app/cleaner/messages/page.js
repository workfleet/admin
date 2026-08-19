'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';
import BackButton from '../../components/BackButton';

export default function CleanerMessages() {
  const router = useRouter();
  const [myId, setMyId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [directory, setDirectory] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }
    setMyId(session.user.id);

    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at, conversations(id, type, name)')
      .eq('profile_id', session.user.id);

    const convIds = (mine || []).map((m) => m.conversation_id);
    if (convIds.length === 0) { setConversations([]); setLoading(false); return; }

    const [{ data: allParticipants }, { data: allMessages }] = await Promise.all([
      supabase.from('conversation_participants').select('conversation_id, profile_id, profiles(full_name)').in('conversation_id', convIds),
      supabase.from('chat_messages').select('id, conversation_id, sender_id, body, created_at, profiles(full_name)').in('conversation_id', convIds).order('created_at', { ascending: true }),
    ]);

    const list = mine.map((m) => {
      const conv = m.conversations;
      const msgs = (allMessages || []).filter((msg) => msg.conversation_id === m.conversation_id);
      const lastMessage = msgs[msgs.length - 1] || null;
      const unreadCount = msgs.filter((msg) => msg.sender_id !== session.user.id && new Date(msg.created_at) > new Date(m.last_read_at)).length;

      let name = conv.name;
      let otherProfileId = null;
      if (conv.type === 'direct') {
        const other = (allParticipants || []).find((p) => p.conversation_id === m.conversation_id && p.profile_id !== session.user.id);
        name = other?.profiles?.full_name || 'Team member';
        otherProfileId = other?.profile_id || null;
      }

      return { id: m.conversation_id, type: conv.type, name, otherProfileId, messages: msgs, lastMessage, unreadCount, lastReadAt: m.last_read_at };
    });

    list.sort((a, b) => {
      const at = a.lastMessage?.created_at || 0;
      const bt = b.lastMessage?.created_at || 0;
      return new Date(bt) - new Date(at);
    });

    setConversations(list);
    setLoading(false);
  };

  const openConversation = async (id) => {
    setActiveId(id);
    setNewMessage('');

    const conv = conversations.find((c) => c.id === id);
    if (conv?.unreadCount > 0) {
      await supabase.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', id).eq('profile_id', myId);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeId) return;
    setSending(true);

    const { data } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: activeId, sender_id: myId, body: newMessage.trim() })
      .select('id, conversation_id, sender_id, body, created_at, profiles(full_name)')
      .single();

    setSending(false);
    if (data) {
      setConversations((prev) =>
        prev
          .map((c) => (c.id === activeId ? { ...c, messages: [...c.messages, data], lastMessage: data } : c))
          .sort((a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0))
      );
      setNewMessage('');

      const conv = conversations.find((c) => c.id === activeId);
      if (conv?.type === 'direct' && conv.otherProfileId) {
        notify({ type: 'direct_message', toProfileId: conv.otherProfileId, body: data.body });
      }
    }
  };

  const openDirectory = async () => {
    setShowDirectory(true);
    if (directory === null) {
      const { data } = await supabase.from('profiles').select('id, full_name, role').neq('id', myId).in('role', ['admin', 'cleaner']);
      setDirectory(data || []);
    }
  };

  const startChat = async (otherProfileId) => {
    const { data: convId } = await supabase.rpc('create_direct_conversation', { other_profile_id: otherProfileId });
    setShowDirectory(false);
    if (convId) {
      await load();
      setActiveId(convId);
    }
  };

  if (loading) return <div className="container">Loading...</div>;

  const active = conversations.find((c) => c.id === activeId);

  if (active) {
    return (
      <div className="container">
        <button
          onClick={() => setActiveId(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, marginBottom: 10, color: 'var(--muted)', fontSize: 13.5, cursor: 'pointer' }}
        >
          <ArrowLeft size={15} /> All chats
        </button>
        <h1>{active.name}</h1>

        <div className="card">
          {active.messages.length === 0 && <p className="empty-state">No messages yet. Say hello!</p>}
          {active.messages.length > 0 && (
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {active.messages.map((m) => {
                const mine = m.sender_id === myId;
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      background: mine ? 'var(--brand-primary)' : '#f1f5f9',
                      color: mine ? 'white' : 'inherit',
                      borderRadius: 14,
                      padding: '8px 12px',
                    }}
                  >
                    {!mine && active.type === 'group' && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.8 }}>{m.profiles?.full_name || 'Team member'}</div>
                    )}
                    <div style={{ fontSize: 14 }}>{m.body}</div>
                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8 }}>
            <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." style={{ flex: 1 }} autoFocus />
            <button type="submit" disabled={sending || !newMessage.trim()}>{sending ? 'Sending...' : 'Send'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <BackButton />
      <div className="page-header-row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Chats</h1>
        <button className="btn-secondary" onClick={() => (showDirectory ? setShowDirectory(false) : openDirectory())}>
          {showDirectory ? 'Cancel' : '+ New Chat'}
        </button>
      </div>

      {showDirectory && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2>Start a chat with...</h2>
          {directory === null && <p className="empty-state">Loading...</p>}
          {directory?.length === 0 && <p className="empty-state">No one else on the team yet.</p>}
          {directory?.map((p) => (
            <div key={p.id} className="task-row" onClick={() => startChat(p.id)} style={{ cursor: 'pointer' }}>
              <span style={{ flex: 1 }}>{p.full_name || 'Unnamed'}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{p.role}</span>
            </div>
          ))}
        </div>
      )}

      {conversations.length === 0 && <p className="empty-state">No chats yet.</p>}

      {conversations.map((c) => (
        <div key={c.id} className="card" onClick={() => openConversation(c.id)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2>{c.name}</h2>
              <p className="job-time" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.lastMessage ? `${c.lastMessage.sender_id === myId ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'}
              </p>
            </div>
            {c.unreadCount > 0 && <span className="badge scheduled" style={{ height: 'fit-content' }}>{c.unreadCount}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
