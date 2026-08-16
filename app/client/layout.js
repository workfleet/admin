'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { signOutAndClearPresence } from '../../lib/signOut';

export default function ClientLayout({ children }) {
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
    <div className="client-shell">
      <div className="client-topbar">
        <div className="client-topbar-inner">
          <div className="client-topbar-brand">
            <div className="client-topbar-logo">CC</div>
            <div>
              <div className="client-topbar-name">CrewConnect Cleaning</div>
              <div className="client-topbar-sub">Client Portal</div>
            </div>
          </div>
          <button type="button" className="client-topbar-logout" onClick={logout} aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
