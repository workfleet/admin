'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { currentMonth, recentMonths, monthLabel } from '../../../lib/detailedReport';
import MonthlyReportTable from '../../components/MonthlyReportTable';

// Monthly property reports, for clients with detailed reports switched on
// (0122). The nav only links here for them; anyone else landing here is
// told so rather than shown an empty table.
export default function ClientReports() {
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
      if (profile?.client_id) {
        const { data } = await supabase.from('clients').select('id, detailed_reports').eq('id', profile.client_id).single();
        setClient(data || null);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div>Loading...</div>;

  if (!client?.detailed_reports) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Reports</h1>
        <p className="empty-state">Monthly property reports aren&rsquo;t set up for your account. Message us if you&rsquo;d like them.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h1 style={{ marginTop: 0 }}>Reports</h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 12px' }}>
          Each property&rsquo;s month: every visit, who cleaned, time on site, and the room-by-room reports with photos.
        </p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field-label">Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginBottom: 0 }}>
            {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>

      <MonthlyReportTable clientId={client.id} month={month} />
    </div>
  );
}
