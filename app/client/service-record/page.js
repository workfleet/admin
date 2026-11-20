'use client';

import { PageSkeleton, SkeletonLines } from '../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Printer } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { currentMonth, recentMonths, monthLabel, monthBounds, formatDuration } from '../../../lib/detailedReport';
import { serviceRecordRows, serviceRecordTotals, serviceRecordCsv, hasRoomRefreshes } from '../../../lib/serviceRecord';
import Link from 'next/link';
import BackButton from '../../components/BackButton';
import ClientSitePicker, { useClientSite, ALL_SITES } from '../../components/ClientSitePicker';

// Proof of service: every visit in a month, for one site or all of them,
// with arrive/leave times, time on site, cleaner and checklist ticks. For
// clients who have to show their own auditors, landlords or councils that
// the cleaning happened. Downloads as CSV, or prints / saves as PDF.
export default function ServiceRecord() {
  const router = useRouter();
  const [clientId, setClientId] = useState(null);
  const [clientName, setClientName] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  // Whether any of their properties has its rooms tracked (0150), for the
  // link to the Rooms page.
  const [hasRooms, setHasRooms] = useState(false);
  const { sites, site, current, setSite } = useClientSite(clientId);

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
      if (profile?.client_id) {
        setClientId(profile.client_id);
        const [{ data: c }, { count: tracked }] = await Promise.all([
          supabase.from('clients').select('name').eq('id', profile.client_id).single(),
          supabase.from('properties').select('id', { count: 'exact', head: true }).eq('client_id', profile.client_id).not('rooms_tracked_since', 'is', null),
        ]);
        setClientName(c?.name || '');
        setHasRooms((tracked || 0) > 0);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!sites || !monthBounds(month)) return;
    let cancelled = false;
    setJobs(null);
    (async () => {
      const ids = site === ALL_SITES ? sites.map((p) => p.id) : [site];
      if (!ids.length) { setJobs([]); return; }
      const bounds = monthBounds(month);
      const { data } = await supabase
        .from('jobs')
        .select('id, scheduled_at, status, room_refreshes, properties(address), job_assignments(profiles(full_name)), checkins(checked_in_at, checked_out_at, profiles(full_name)), tasks(completed)')
        .in('property_id', ids)
        .gte('scheduled_at', bounds.start)
        .lt('scheduled_at', bounds.end)
        .order('scheduled_at');
      if (!cancelled) setJobs(data || []);
    })();
    return () => { cancelled = true; };
  }, [sites, site, month]);

  const rows = useMemo(() => serviceRecordRows(jobs || []), [jobs]);
  const totals = useMemo(() => serviceRecordTotals(rows), [rows]);
  const showRooms = hasRoomRefreshes(rows);
  const where = current ? current.address : 'All sites';

  const downloadCsv = () => {
    const blob = new Blob([serviceRecordCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const label = (current ? current.address.split(',')[0] : 'all-sites').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    a.download = `service-record-${month}-${label}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (loading) return <PageSkeleton className="" rows={3} />;

  return (
    <div className="service-record">
      <div className="no-print"><BackButton /></div>
      <div className="page-header-row">
        <div>
          <h1>Service record</h1>
          <p className="page-subtitle no-print">Proof of every visit - for your own records, auditors or landlord</p>
          {hasRooms && (
            <p className="no-print" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
              <Link href="/client/rooms">See when each room is next due &rarr;</Link>
            </p>
          )}
          <p className="print-only" style={{ margin: '4px 0 0' }}>
            {clientName} · {where} · {monthLabel(month)} · CrewConnect
          </p>
        </div>
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <ClientSitePicker sites={sites} site={site} setSite={setSite} />
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field-label">Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginBottom: 0 }}>
            {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.print()} disabled={!rows.length}>
            <Printer size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} /> Print or save as PDF
          </button>
          <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!rows.length}>
            <Download size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} /> Download spreadsheet
          </button>
        </div>
      </div>

      {jobs === null && <SkeletonLines />}

      {jobs !== null && (
        <>
          <div className="stat-row">
            <div className="stat-card"><div className="stat-number">{totals.visits}</div><div className="stat-label">Visits done</div></div>
            <div className="stat-card"><div className="stat-number" style={{ fontSize: 22 }}>{totals.minutes ? formatDuration(totals.minutes) : '—'}</div><div className="stat-label">Time on site</div></div>
            <div className="stat-card"><div className="stat-number">{totals.missed}</div><div className="stat-label">Missed</div></div>
          </div>

          {rows.length === 0 && <p className="empty-state">No visits {current ? 'at this site ' : ''}in {monthLabel(month)}.</p>}

          {rows.length > 0 && (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="wf-table service-record-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {site === ALL_SITES && <th>Site</th>}
                    <th>Status</th>
                    <th>Arrived</th>
                    <th>Left</th>
                    <th>On site</th>
                    <th>Cleaner</th>
                    <th>Checklist</th>
                    {showRooms && <th>Rooms refreshed</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{r.date}</td>
                      {site === ALL_SITES && <td>{r.address}</td>}
                      <td>{r.status}</td>
                      <td>{r.arrived || '—'}</td>
                      <td>{r.left || '—'}</td>
                      <td className="nowrap">{r.onSite || '—'}</td>
                      <td>{r.cleaners || '—'}</td>
                      <td className="nowrap">{r.checklist || '—'}</td>
                      {showRooms && <td>{r.rooms || '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="print-only" style={{ fontSize: 11, marginTop: 12 }}>
            Times are from the cleaner&rsquo;s check-in and check-out on their phone. Produced {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        </>
      )}
    </div>
  );
}
