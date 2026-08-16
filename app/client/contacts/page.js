'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Phone, MapPin, Globe } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { COMPANY } from '../../../lib/companyBranding';

export default function ClientContacts() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setChecked(true);
    })();
  }, []);

  if (!checked) return <div>Loading...</div>;

  const rows = [
    { icon: Phone, label: 'Phone', value: COMPANY.phone, href: `tel:${COMPANY.phone.replace(/\s+/g, '')}` },
    { icon: Mail, label: 'Email', value: COMPANY.email, href: `mailto:${COMPANY.email}` },
    { icon: MapPin, label: 'Office', value: COMPANY.address, href: null },
    { icon: Globe, label: 'Website', value: COMPANY.website, href: `https://${COMPANY.website}` },
  ];

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1>Contacts</h1>
          <p className="page-subtitle">How to reach {COMPANY.name}</p>
        </div>
      </div>

      <div className="card">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="task-row" style={{ border: 'none' }}>
              <Icon size={18} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{row.label}</div>
                {row.href ? (
                  <a href={row.href} target={row.label === 'Website' ? '_blank' : undefined} rel="noopener noreferrer">{row.value}</a>
                ) : (
                  <span style={{ fontSize: 14.5 }}>{row.value}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
