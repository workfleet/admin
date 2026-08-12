'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

export default function AdminMessages() {
  const router = useRouter();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openClientId, setOpenClientId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('client_messages')
      .select('id, client_id, sender, body, created_at, read_by_admin, clients(name)')
      .order('created_at', { ascending: true });

    const grouped = {};
    (data || []).forEach((m) => {
      if (!grouped[m.client_id]) {
        grouped[m.client_id] = { clientId: m.client_id, clientName: m.clients?.name || 'Unknown client', messages: [] };
      }
      grouped[m.client_id].messages.push(m);
    });

    const threadList = Object.values(grouped)
      .map((t) => ({
        ...t,
        lastMessage: t.messages[t.messages.length - 1],
        unreadCount: t.messages.filter((m) => m.sender === 'client' && !m.read_by_admin).length,
      }))
      .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));

    setThreads(threadList);
    setLoading(false);
  };

  const openThread = async (clientId) => {
    if (openClientId === clientId) {
      setOpenClientId(null);
      return;
    }
    setOpenClientId(clientId);
    setReplyText('');

    const thread = threads.find((t) => t.clientId === clientId);
    const unreadIds = thread?.messages.filter((m) => m.sender === 'client' && !m.read_by_admin).map((m) => m.id) || [];
    if (unreadIds.length > 0) {
      await supabase.from('client_messages').update({ read_by_admin: true }).in('id', unreadIds);
      setThreads((prev) =>
        prev.map((t) =>
          t.clientId === clientId
            ? { ...t, unreadCount: 0, messages: t.messages.map((m) => (unreadIds.includes(m.id) ? { ...m, read_by_admin: true } : m)) }
            : t
        )
      );
    }
  };

  const sendReply = async (e, clientId) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSending(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from('client_messages')
      .insert({
        client_id: clientId,
        sender: 'admin',
        sender_profile_id: session.user.id,
        body: replyText.trim(),
        read_by_admin: true,
      })
      .select('id, client_id, sender, body, created_at, read_by_admin, clients(name)')
      .single();

    setSending(false);
    if (data) {
      setThreads((prev) =>
        prev
          .map((t) => (t.clientId === clientId ? { ...t, messages: [...t.messages, data], lastMessage: data } : t))
          .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at))
      );
      setReplyText('');
      notify({ type: 'admin_reply', clientId, body: data.body });
    }
  };

  const totalUnread = threads.reduce((sum, t) => sum + t.unreadCount, 0);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Messages</h1>
          <p className="page-subtitle">
            {totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}
          </p>
        </div>
      </div>

      {threads.length === 0 && <p className="empty-state">No messages yet.</p>}

      <div className="job-list">
        {threads.map((t) => {
          const isOpen = openClientId === t.clientId;
          return (
            <div key={t.clientId} className="card">
              <div
                onClick={() => openThread(t.clientId)}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <h2>{t.clientName}</h2>
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
                      <div
                        key={m.id}
                        style={{
                          alignSelf: m.sender === 'admin' ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          background: m.sender === 'admin' ? 'var(--brand-primary)' : '#f1f5f9',
                          color: m.sender === 'admin' ? 'white' : 'inherit',
                          borderRadius: 14,
                          padding: '8px 12px',
                        }}
                      >
                        <div style={{ fontSize: 14 }}>{m.body}</div>
                        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                          {m.sender === 'admin' ? 'You' : t.clientName} · {new Date(m.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={(e) => sendReply(e, t.clientId)} style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type a reply..."
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <button type="submit" disabled={sending || !replyText.trim()}>
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
