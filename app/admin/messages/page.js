'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { notify } from '../../../lib/notify';

const CONFIG = {
  clients: {
    table: 'client_messages',
    idField: 'client_id',
    theirSender: 'client',
    select: 'id, client_id, sender, body, created_at, read_by_admin, clients(name)',
    nameOf: (m) => m.clients?.name || 'Unknown client',
    insertPayload: (id, userId, body) => ({ client_id: id, sender: 'admin', sender_profile_id: userId, body, read_by_admin: true }),
    notifyType: 'admin_reply',
  },
  staff: {
    table: 'staff_messages',
    idField: 'cleaner_id',
    theirSender: 'cleaner',
    select: 'id, cleaner_id, sender, body, created_at, read_by_admin, profiles!cleaner_id(full_name)',
    nameOf: (m) => m.profiles?.full_name || 'Unknown cleaner',
    insertPayload: (id, userId, body) => ({ cleaner_id: id, sender: 'admin', sender_profile_id: userId, body, read_by_admin: true }),
    notifyType: 'admin_staff_reply',
  },
};

export default function AdminMessages() {
  const router = useRouter();
  const [mode, setMode] = useState('clients');
  const [threadsByMode, setThreadsByMode] = useState({ clients: null, staff: null });
  const [loading, setLoading] = useState(true);
  const [openThreadId, setOpenThreadId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const [clients, staff] = await Promise.all([loadThreads('clients'), loadThreads('staff')]);
    setThreadsByMode({ clients, staff });
    setLoading(false);
  };

  const loadThreads = async (m) => {
    const cfg = CONFIG[m];
    const { data } = await supabase.from(cfg.table).select(cfg.select).order('created_at', { ascending: true });

    const grouped = {};
    (data || []).forEach((msg) => {
      const id = msg[cfg.idField];
      if (!grouped[id]) grouped[id] = { id, name: cfg.nameOf(msg), messages: [] };
      grouped[id].messages.push(msg);
    });

    return Object.values(grouped)
      .map((t) => ({
        ...t,
        lastMessage: t.messages[t.messages.length - 1],
        unreadCount: t.messages.filter((msg) => msg.sender === cfg.theirSender && !msg.read_by_admin).length,
      }))
      .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  };

  const threads = threadsByMode[mode] || [];
  const cfg = CONFIG[mode];

  const openThread = async (id) => {
    if (openThreadId === id) {
      setOpenThreadId(null);
      return;
    }
    setOpenThreadId(id);
    setReplyText('');

    const thread = threads.find((t) => t.id === id);
    const unreadIds = thread?.messages.filter((m) => m.sender === cfg.theirSender && !m.read_by_admin).map((m) => m.id) || [];
    if (unreadIds.length > 0) {
      await supabase.from(cfg.table).update({ read_by_admin: true }).in('id', unreadIds);
      setThreadsByMode((prev) => ({
        ...prev,
        [mode]: prev[mode].map((t) =>
          t.id === id
            ? { ...t, unreadCount: 0, messages: t.messages.map((m) => (unreadIds.includes(m.id) ? { ...m, read_by_admin: true } : m)) }
            : t
        ),
      }));
    }
  };

  const sendReply = async (e, id) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSending(true);

    const { data: { session } } = await supabase.auth.getSession();

    const { data } = await supabase
      .from(cfg.table)
      .insert(cfg.insertPayload(id, session.user.id, replyText.trim()))
      .select(cfg.select)
      .single();

    setSending(false);
    if (data) {
      setThreadsByMode((prev) => ({
        ...prev,
        [mode]: prev[mode]
          .map((t) => (t.id === id ? { ...t, messages: [...t.messages, data], lastMessage: data } : t))
          .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at)),
      }));
      setReplyText('');
      notify(mode === 'clients' ? { type: cfg.notifyType, clientId: id, body: data.body } : { type: cfg.notifyType, cleanerId: id, body: data.body });
    }
  };

  const totalUnread = (threadsByMode.clients || []).reduce((s, t) => s + t.unreadCount, 0)
    + (threadsByMode.staff || []).reduce((s, t) => s + t.unreadCount, 0);

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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={mode === 'clients' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setMode('clients'); setOpenThreadId(null); }}>
            Clients
          </button>
          <button className={mode === 'staff' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setMode('staff'); setOpenThreadId(null); }}>
            Staff
          </button>
        </div>
      </div>

      {threads.length === 0 && <p className="empty-state">No messages yet.</p>}

      <div className="job-list">
        {threads.map((t) => {
          const isOpen = openThreadId === t.id;
          return (
            <div key={t.id} className="card">
              <div
                onClick={() => openThread(t.id)}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12 }}
              >
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
                          {m.sender === 'admin' ? 'You' : t.name} · {new Date(m.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={(e) => sendReply(e, t.id)} style={{ display: 'flex', gap: 8 }}>
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
