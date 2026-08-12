'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Home, Calendar, User, FileText, Settings, MessageCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/cleaner', label: 'Home', icon: Home },
  { href: '/cleaner/rota', label: 'Rota', icon: Calendar },
  { href: '/cleaner/messages', label: 'Messages', icon: MessageCircle },
  { href: '/cleaner/profile', label: 'Profile', icon: User },
  { href: '/cleaner/policies', label: 'Policies', icon: FileText },
  { href: '/cleaner/settings', label: 'Settings', icon: Settings },
];

export default function CleanerLayout({ children }) {
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

    if (profile?.role === 'admin') { router.push('/admin'); return; }
    if (profile?.role === 'client') { router.push('/client'); return; }

    setAuthorized(true);
  };

  if (!authorized) return null;

  return (
    <div className="cleaner-shell">
      {children}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`bottom-nav-link ${active ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
