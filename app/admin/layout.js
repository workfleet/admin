'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Calendar, Building2, Users, ClipboardList, FileText, MessageSquareWarning } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/rota', label: 'Rota', icon: Calendar },
  { href: '/admin/clients', label: 'Clients', icon: Building2 },
  { href: '/admin/cleaners', label: 'Cleaners', icon: Users },
  { href: '/admin/onboarding', label: 'Onboarding', icon: ClipboardList },
  { href: '/admin/reports', label: 'Reports', icon: FileText },
  { href: '/admin/requests', label: 'Requests', icon: MessageSquareWarning },
];

export default function AdminLayout({ children }) {
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

    if (profile?.role !== 'admin') {
      router.push('/');
      return;
    }
    setAuthorized(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (!authorized) return null;

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">WF</div>
          <div>
            <div className="sidebar-brand-name">Workfleet</div>
            <div className="sidebar-brand-sub">Operations</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
              >
                <Icon className="sidebar-icon" size={18} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button className="sidebar-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
