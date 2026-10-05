'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { monthBounds, minutesOnSite, formatDuration } from '../../lib/detailedReport';
import { downloadReportPdf } from '../../lib/downloadReportPdf';

// Every property a client has, for one month: how many visits, time on
// site, how many have a report, and a PDF of the month. Used by the office
// (admin/reports/monthly) and by the client (client/reports); row-level
// security decides what each sees - a client's read of job_reports only
// returns the reports shared with them.
export default function MonthlyReportTable({ clientId, month, staffView = false }) {
  const [rows, setRows] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId || !monthBounds(month)) return;
    let cancelled = false;
    setRows(null);
    setError('');

    (async () => {
      const bounds = monthBounds(month);
      const { data: properties } = await supabase
        .from('properties').select('id, address').eq('client_id', clientId).order('address');
      const ids = (properties || []).map((p) => p.id);

      const { data: jobs } = ids.length
        ? await supabase
          .from('jobs')
          .select('id, property_id, status, job_reports(visible_to_client), checkins(checked_in_at, checked_out_at)')
          .in('property_id', ids)
          .in('status', ['completed', 'in_progress', 'missed'])
          .gte('scheduled_at', bounds.start)
          .lt('scheduled_at', bounds.end)
        : { data: [] };

      if (cancelled) return;
      setRows((properties || []).map((p) => {
        const mine = (jobs || []).filter((j) => j.property_id === p.id);
        const done = mine.filter((j) => j.status !== 'missed');
        const reportOf = (j) => (Array.isArray(j.job_reports) ? j.job_reports[0] : j.job_reports);
        return {
          ...p,
          visits: done.length,
          missed: mine.length - done.length,
          minutes: done.reduce((t, j) => t + minutesOnSite(j.checkins), 0),
          shared: done.filter((j) => reportOf(j)?.visible_to_client).length,
          unshared: done.filter((j) => reportOf(j) && !reportOf(j).visible_to_client).length,
        };
      }));
    })();

    return () => { cancelled = true; };
  }, [clientId, month]);

  const download = async (propertyId) => {
    setDownloadingId(propertyId);
    setError('');
    const failure = await downloadReportPdf({ property: propertyId, month });
    setDownloadingId(null);
    if (failure) setError(failure);
  };

  if (!rows) return <p className="empty-state">Loading...</p>;
  if (rows.length === 0) return <p className="empty-state">No properties.</p>;

  const withVisits = rows.filter((r) => r.visits > 0 || r.missed > 0);
  const quiet = rows.length - withVisits.length;
  const unsharedTotal = rows.reduce((t, r) => t + r.unshared, 0);

  return (
    <div>
      {staffView && unsharedTotal > 0 && (
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          {unsharedTotal} report{unsharedTotal === 1 ? ' is' : 's are'} written but not shared. Only reports ticked
          {' '}&ldquo;Add to client portal&rdquo; go into the monthly PDF, so it matches what the client sees.
        </p>
      )}
      {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}

      {withVisits.length === 0 && <p className="empty-state">No visits this month.</p>}

      <div className="job-list">
        {withVisits.map((r) => (
          <div key={r.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 240px' }}>
              <h2 style={{ margin: 0, fontSize: 15.5 }}>{r.address}</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>
                {r.visits} visit{r.visits === 1 ? '' : 's'}
                {r.missed > 0 ? ` · ${r.missed} missed` : ''}
                {' · '}{formatDuration(r.minutes)} on site
                {' · '}{r.shared} report{r.shared === 1 ? '' : 's'}
                {staffView && r.unshared > 0 ? ` (${r.unshared} not shared)` : ''}
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => download(r.id)}
              disabled={downloadingId !== null}
              title="Save the month at this property, with each visit's report and photos, as a PDF"
            >
              {downloadingId === r.id ? 'Making PDF...' : 'Download PDF'}
            </button>
          </div>
        ))}
      </div>

      {quiet > 0 && withVisits.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
          {quiet} other propert{quiet === 1 ? 'y' : 'ies'} had no visits this month.
        </p>
      )}
    </div>
  );
}
