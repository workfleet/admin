'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, History, MessageCircle, FileText, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { signOutAndClearPresence } from '../../lib/signOut';

const NAV_ITEMS = [
  { href: '/client', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/client/history', label: 'History', icon: History },
  { href: '/client/documents', label: 'Documents', icon: FileText },
  { href: '/client/messages', label: 'Messages', icon: MessageCircle },
];

export default function ClientLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profile?.role === 'admin' || profile?.role === 'supervisor') { router.push('/admin'); return; }
    if (profile?.role === 'cleaner') { router.push('/cleaner'); return; }

    setAuthorized(true);
  };

  const logout = async () => {
    await signOutAndClearPresence();
    router.push('/');
  };

  if (!authorized) return null;

  return (
    <div className="client-shell-layout">
      <aside className="client-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">CC</div>
          <div>
            <div className="sidebar-brand-name">CrewConnect</div>
            <div className="sidebar-brand-sub">Client Portal</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`sidebar-link ${active ? 'active' : ''}`}>
                <Icon className="sidebar-icon" size={18} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button className="sidebar-logout" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <LogOut size={15} /> Log out
        </button>
      </aside>

      <main className="client-main">{children}</main>
    </div>
  );
}
