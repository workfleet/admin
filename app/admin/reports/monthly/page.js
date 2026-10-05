'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { currentMonth, recentMonths, monthLabel } from '../../../../lib/detailedReport';
import BackButton from '../../../components/BackButton';
import MonthlyReportTable from '../../../components/MonthlyReportTable';

export default function MonthlyReports() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }

      const { data } = await supabase.from('clients').select('id, name, detailed_reports').order('name');
      // Clients with detailed reports on (TKR) first - they're who this is for.
      const sorted = [...(data || [])].sort((a, b) => Number(b.detailed_reports) - Number(a.detailed_reports));
      setClients(sorted);
      setClientId(sorted[0]?.id || '');
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="page-inner">Loading...</div>;

  const selected = clients.find((c) => c.id === clientId);
  const flagged = clients.filter((c) => c.detailed_reports);
  const others = clients.filter((c) => !c.detailed_reports);

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Monthly reports</h1>
          <p className="page-subtitle">A month of visits at each property, with every shared report and its photos</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <div className="field">
            <label className="field-label">Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ marginBottom: 0 }}>
              {flagged.length > 0 && (
                <optgroup label="Detailed reports on">
                  {flagged.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
              <optgroup label={flagged.length > 0 ? 'Other clients' : 'Clients'}>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginBottom: 0 }}>
              {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
        {selected && (
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>
            {selected.detailed_reports
              ? `${selected.name} can also read and download these in their portal, under Reports.`
              : `${selected.name} doesn't have detailed reports switched on, so these aren't in their portal - you can still download and send them.`}
          </p>
        )}
      </div>

      {clientId && <MonthlyReportTable clientId={clientId} month={month} staffView />}
    </div>
  );
}
