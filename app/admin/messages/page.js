'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { notify } from '../../../lib/notify';
import BackButton from '../../components/BackButton';

const CLIENT_CFG = {
  table: 'client_messages',
  idField: 'client_id',
  theirSender: 'client',
  select: 'id, client_id, sender, body, created_at, read_by_admin, clients(name)',
  nameOf: (m) => m.clients?.name || 'Unknown client',
  insertPayload: (id, userId, body) => ({ client_id: id, sender: 'admin', sender_profile_id: userId, body, read_by_admin: true }),
  notifyType: 'admin_reply',
};

export default function AdminMessages() {
  const router = useRouter();
  const [mode, setMode] = useState('clients');
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);

  // clients mode
  const [clientThreads, setClientThreads] = useState([]);
  const [openThreadId, setOpenThreadId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // staff mode (conversations)
  const [conversations, setConversations] = useState([]);
  const [openConvId, setOpenConvId] = useState(null);
  const [convReplyText, setConvReplyText] = useState('');
  const [convSending, setConvSending] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [directory, setDirectory] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setMyId(session.user.id);

    const [clients] = await Promise.all([loadClientThreads(), loadConversations(session.user.id)]);
    setClientThreads(clients);
    setLoading(false);
  };

  const loadClientThreads = async () => {
    const { data } = await supabase.from(CLIENT_CFG.table).select(CLIENT_CFG.select).order('created_at', { ascending: true });
    const grouped = {};
    (data || []).forEach((msg) => {
      const id = msg[CLIENT_CFG.idField];
      if (!grouped[id]) grouped[id] = { id, name: CLIENT_CFG.nameOf(msg), messages: [] };
      grouped[id].messages.push(msg);
    });
    return Object.values(grouped)
      .map((t) => ({ ...t, lastMessage: t.messages[t.messages.length - 1], unreadCount: t.messages.filter((m) => m.sender === CLIENT_CFG.theirSender && !m.read_by_admin).length }))
      .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  };

  const loadConversations = async (userId) => {
    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at, conversations(id, type, name)')
      .eq('profile_id', userId);

    const convIds = (mine || []).map((m) => m.conversation_id);
    if (convIds.length === 0) { setConversations([]); return; }

    const [{ data: allParticipants }, { data: allMessages }] = await Promise.all([
      supabase.from('conversation_participants').select('conversation_id, profile_id, profiles(full_name)').in('conversation_id', convIds),
      supabase.from('chat_messages').select('id, conversation_id, sender_id, body, created_at, profiles(full_name)').in('conversation_id', convIds).order('created_at', { ascending: true }),
    ]);

    const list = mine.map((m) => {
      const conv = m.conversations;
      const msgs = (allMessages || []).filter((msg) => msg.conversation_id === m.conversation_id);
      const lastMessage = msgs[msgs.length - 1] || null;
      const unreadCount = msgs.filter((msg) => msg.sender_id !== userId && new Date(msg.created_at) > new Date(m.last_read_at)).length;

      let name = conv.name;
      let otherProfileId = null;
      if (conv.type === 'direct') {
        const other = (allParticipants || []).find((p) => p.conversation_id === m.conversation_id && p.profile_id !== userId);
        name = other?.profiles?.full_name || 'Team member';
        otherProfileId = other?.profile_id || null;
      }

      return { id: m.conversation_id, type: conv.type, name, otherProfileId, messages: msgs, lastMessage, unreadCount };
    });

    list.sort((a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0));
    setConversations(list);
  };

  const openClientThread = async (id) => {
    if (openThreadId === id) { setOpenThreadId(null); return; }
    setOpenThreadId(id);
    setReplyText('');

    const thread = clientThreads.find((t) => t.id === id);
    const unreadIds = thread?.messages.filter((m) => m.sender === CLIENT_CFG.theirSender && !m.read_by_admin).map((m) => m.id) || [];
    if (unreadIds.length > 0) {
      await supabase.from(CLIENT_CFG.table).update({ read_by_admin: true }).in('id', unreadIds);
      setClientThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unreadCount: 0, messages: t.messages.map((m) => (unreadIds.includes(m.id) ? { ...m, read_by_admin: true } : m)) } : t)));
    }
  };

  const sendClientReply = async (e, id) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSending(true);

    const { data } = await supabase
      .from(CLIENT_CFG.table)
      .insert(CLIENT_CFG.insertPayload(id, myId, replyText.trim()))
      .select(CLIENT_CFG.select)
      .single();

    setSending(false);
    if (data) {
      setClientThreads((prev) => prev.map((t) => (t.id === id ? { ...t, messages: [...t.messages, data], lastMessage: data } : t)).sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at)));
      setReplyText('');
      notify({ type: CLIENT_CFG.notifyType, clientId: id, body: data.body });
    }
  };

  const openConversation = async (id) => {
    if (openConvId === id) { setOpenConvId(null); return; }
    setOpenConvId(id);
    setConvReplyText('');

    const conv = conversations.find((c) => c.id === id);
    if (conv?.unreadCount > 0) {
      await supabase.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', id).eq('profile_id', myId);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    }
  };

  const sendConvReply = async (e, id) => {
    e.preventDefault();
    if (!convReplyText.trim()) return;
    setConvSending(true);

    const { data } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: id, sender_id: myId, body: convReplyText.trim() })
      .select('id, conversation_id, sender_id, body, created_at, profiles(full_name)')
      .single();

    setConvSending(false);
    if (data) {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, messages: [...c.messages, data], lastMessage: data } : c)).sort((a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0)));
      setConvReplyText('');

      const conv = conversations.find((c) => c.id === id);
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
      await loadConversations(myId);
      setOpenConvId(convId);
    }
  };

  const totalUnread = clientThreads.reduce((s, t) => s + t.unreadCount, 0) + conversations.reduce((s, t) => s + t.unreadCount, 0);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Messages</h1>
          <p className="page-subtitle">{totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={mode === 'clients' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('clients')}>Clients</button>
          <button className={mode === 'staff' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('staff')}>Staff</button>
        </div>
      </div>

      {mode === 'clients' && (
        <>
          {clientThreads.length === 0 && <p className="empty-state">No messages yet.</p>}
          <div className="job-list">
            {clientThreads.map((t) => {
              const isOpen = openThreadId === t.id;
              return (
                <div key={t.id} className="card">
                  <div onClick={() => openClientThread(t.id)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <h2>{t.name}</h2>
                      <p className="job-time" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.lastMessage.sender === 'admin' ? 'You: ' : ''}{t.lastMessage.body}
                      </p>
                      <p className="job-time">{new Date(t.lastMessage.created_at).toLocaleString()}</p>
                    </div>
                    {t.unreadCount > 0 && <span className="badge scheduled" style={{ height: 'fit-content' }}>{t.unreadCount} new</span>}
                  </div>

                  {isOpen && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 320, overflowY: 'auto' }}>
                        {t.messages.map((m) => (
                          <div key={m.id} style={{ alignSelf: m.sender === 'admin' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.sender === 'admin' ? 'var(--brand-primary)' : '#f1f5f9', color: m.sender === 'admin' ? 'white' : 'inherit', borderRadius: 14, padding: '8px 12px' }}>
                            <div style={{ fontSize: 14 }}>{m.body}</div>
                            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{m.sender === 'admin' ? 'You' : t.name} · {new Date(m.created_at).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                      <form onSubmit={(e) => sendClientReply(e, t.id)} style={{ display: 'flex', gap: 8 }}>
                        <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type a reply..." style={{ flex: 1 }} autoFocus />
                        <button type="submit" disabled={sending || !replyText.trim()}>{sending ? 'Sending...' : 'Send'}</button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {mode === 'staff' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <button className="btn-secondary" onClick={() => (showDirectory ? setShowDirectory(false) : openDirectory())} title="Start a new conversation with a member of staff">
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

          <div className="job-list">
            {conversations.map((c) => {
              const isOpen = openConvId === c.id;
              return (
                <div key={c.id} className="card">
                  <div onClick={() => openConversation(c.id)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <h2>{c.name}</h2>
                      <p className="job-time" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.lastMessage ? `${c.lastMessage.sender_id === myId ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'}
                      </p>
                    </div>
                    {c.unreadCount > 0 && <span className="badge scheduled" style={{ height: 'fit-content' }}>{c.unreadCount} new</span>}
                  </div>

                  {isOpen && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 320, overflowY: 'auto' }}>
                        {c.messages.length === 0 && <p className="empty-state">No messages yet.</p>}
                        {c.messages.map((m) => {
                          const mine = m.sender_id === myId;
                          return (
                            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', background: mine ? 'var(--brand-primary)' : '#f1f5f9', color: mine ? 'white' : 'inherit', borderRadius: 14, padding: '8px 12px' }}>
                              {!mine && c.type === 'group' && <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.8 }}>{m.profiles?.full_name || 'Team member'}</div>}
                              <div style={{ fontSize: 14 }}>{m.body}</div>
                              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{mine ? 'You' : (c.type === 'group' ? '' : c.name) } {new Date(m.created_at).toLocaleString()}</div>
                            </div>
                          );
                        })}
                      </div>
                      <form onSubmit={(e) => sendConvReply(e, c.id)} style={{ display: 'flex', gap: 8 }}>
                        <input value={convReplyText} onChange={(e) => setConvReplyText(e.target.value)} placeholder="Type a message..." style={{ flex: 1 }} autoFocus />
                        <button type="submit" disabled={convSending || !convReplyText.trim()}>{convSending ? 'Sending...' : 'Send'}</button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
