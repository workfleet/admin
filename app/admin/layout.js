'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '🏠' },
  { href: '/admin/rota', label: 'Rota', icon: '🗓️' },
  { href: '/admin/clients', label: 'Clients', icon: '🏢' },
  { href: '/admin/cleaners', label: 'Cleaners', icon: '🧹' },
  { href: '/admin/onboarding', label: 'Onboarding', icon: '📋' },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

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
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
              >
                <span className="sidebar-icon">{item.icon}</span>
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