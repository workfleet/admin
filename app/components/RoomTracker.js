'use client';

import EmptyState from './EmptyState';
import { DoorOpen as EmptyIconDoor } from 'lucide-react';
import { SkeletonLines } from './Skeleton';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { localDateString } from '../../lib/localDate';
import { shortAddress } from '../../lib/shortAddress';
import { trackerRows, roomMinutesFor, REFRESH_EVERY_DAYS, DUE_SOON_DAYS, plannedRooms } from '../../lib/roomRefresh';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';

// The office's view of fortnightly room refreshes (0150, 0151), shown as the
// Rooms tab on a client's page (Jess wanted it under TKR, not a menu page of
// its own). Keeping every room and the communal areas in date is the
// office's job, not the cleaner's. Each tracked property shows when every room was
// last done and the visit it's next booked on; rooms are booked onto a
// visit here, and a room that wasn't done is marked here after the visit.

const STATUS = {
  booked: { label: 'Booked', className: 'wf-pill wf-pill-verified' },
  ok: { label: 'In date', className: 'wf-pill wf-pill-verified' },
  due: { label: 'Due soon', className: 'wf-pill wf-pill-progress' },
  overdue: { label: 'Overdue', className: 'wf-pill wf-pill-overdue' },
};

const dayLabel = (day) => (day
  ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  : null);

const visitLabel = (job) => (job
  ? new Date(job.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  : null);

const lengthLabel = (m) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h ? `${h}h` : ''}${h && r ? ' ' : ''}${r ? `${r}m` : ''}` || '0m';
};

// refreshKey changes when the room lists are edited on the Properties tab.
// readOnly is the client portal's view (/client/rooms): when each room was
// last done and when it's next booked, with none of the office's buttons.
export default function RoomTracker({ clientId, refreshKey, readOnly = false }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [houses, setHouses] = useState([]);
  const [jobs, setJobs] = useState([]);
  // Each house's communal areas, from its property checklist, shown under
  // the Communal areas row.
  const [areas, setAreas] = useState({});
  const [busy, setBusy] = useState(null);
  const today = localDateString(new Date());

  useEffect(() => { if (clientId) load(); }, [clientId, refreshKey]);

  const load = async () => {
    setLoading(true);
    setError('');
    const { data: houseRows, error: houseError } = await supabase
      .from('properties')
      .select('id, address, client_id, rooms, rooms_tracked_since, clients(name, room_refresh_minutes)')
      .eq('client_id', clientId)
      .not('rooms_tracked_since', 'is', null)
      .order('address');
    if (houseError) { setError("Couldn't load the room lists."); setLoading(false); return; }
    const tracked = (houseRows || []).filter((h) => (h.rooms || []).length > 0);
    let jobRows = [];
    if (tracked.length > 0) {
      // From the earliest start (or 60 days back) to six weeks ahead: enough
      // to know each room's last refresh and its next booking.
      const earliest = tracked.map((h) => h.rooms_tracked_since).sort()[0];
      const back = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const from = earliest < back ? back : earliest;
      const to = new Date(Date.now() + 42 * 86400000).toISOString();
      const { data, error: jobsError } = await supabase
        .from('jobs')
        .select('id, property_id, scheduled_at, status, duration_minutes, room_refreshes')
        .in('property_id', tracked.map((h) => h.id))
        .in('status', ['scheduled', 'in_progress', 'completed'])
        .gte('scheduled_at', `${from}T00:00:00Z`)
        .lt('scheduled_at', to)
        .order('scheduled_at');
      if (jobsError) { setError("Couldn't load the visits."); setLoading(false); return; }
      jobRows = data || [];
      // Not essential: if the checklist can't be read the row just shows
      // without its list of areas.
      const { data: items } = await supabase
        .from('property_checklist_items')
        .select('property_id, room, sort_order')
        .in('property_id', tracked.map((h) => h.id))
        .order('sort_order');
      const byHouse = {};
      for (const item of items || []) {
        const area = String(item.room || '').trim();
        if (!area) continue;
        const list = byHouse[item.property_id] || (byHouse[item.property_id] = []);
        if (!list.includes(area)) list.push(area);
      }
      setAreas(byHouse);
    }
    setHouses(tracked.sort((a, b) => (shortAddress(a.address) || a.address).localeCompare(shortAddress(b.address) || b.address, 'en-GB', { numeric: true })));
    setJobs(jobRows);
    setLoading(false);
  };

  // All changes go through set_room_plan (0151), which also keeps the
  // visit's length in step with the rooms on it.
  const act = async (jobId, room, action, done) => {
    setBusy(`${jobId}:${room}`);
    const { data, error: rpcError } = await supabase.rpc('set_room_plan', { target_job_id: jobId, room_name: room, action });
    setBusy(null);
    if (rpcError || !data) { toast.error(rpcError?.message || "Couldn't save that."); return; }
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, room_refreshes: data.room_refreshes, duration_minutes: data.duration_minutes } : j)));
    toast.success(done);
  };

  const markNotDone = async (row, job) => {
    const ok = await confirm(
      `Mark ${row.label} as not refreshed on ${visitLabel(job)}? It won't be charged to the client, and it will show as still due here so you can book it again. The cleaner's pay for the visit doesn't change.`,
      { title: 'Room not done', confirmLabel: 'Mark not done' }
    );
    if (ok) act(job.id, row.room, 'skip', `${row.label} marked as not done - it won't be invoiced.`);
  };

  if (loading) return <div className="card"><SkeletonLines lines={4} /></div>;

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const overdueCount = houses.reduce((n, h) => n + trackerRows({ property: h, jobs, today }).rows.filter((r) => r.status === 'overdue').length, 0);

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
        {readOnly
          ? <>The communal areas and every room are refreshed at least every {REFRESH_EVERY_DAYS} days. This shows when each was last done and the visit it&apos;s next booked on. <a href="/client/service-record">See every visit in your service record &rarr;</a></>
          : <>Communal areas and every room, kept within {REFRESH_EVERY_DAYS} days. Book rooms onto a visit here; after the visit, mark any that weren&apos;t done.</>}
      </p>

      {error && <div className="card" style={{ color: 'var(--wf-overdue)' }}>{error}</div>}

      {!error && houses.length === 0 && (
        <EmptyState
          icon={EmptyIconDoor}
          title="No rooms set up yet"
          body={readOnly ? 'Room refreshes for your properties will show here once we have set them up.' : 'On the Properties tab, press Rooms on a property and enter its rooms. It will appear here.'}
        />
      )}

      {houses.length > 0 && !readOnly && (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
          {overdueCount === 0 ? 'Nothing is overdue.' : `${overdueCount} overdue across ${houses.length} properties.`}
          {' '}Amber means due within {DUE_SOON_DAYS} days with nothing booked in time.
        </p>
      )}

      {houses.map((house) => {
        const { rows, nextVisit } = trackerRows({ property: house, jobs, today });
        const perRoom = roomMinutesFor(house.clients);
        const nextPlanned = nextVisit ? plannedRooms(nextVisit) : new Set();
        // A new visit on the rota, for the day the first thing falls due (or
        // today if that has passed), with this house already filled in.
        const firstDue = rows.filter((r) => r.status !== 'booked').map((r) => r.dueDay).sort()[0];
        const bookOn = firstDue && firstDue > today ? firstDue : today;
        return (
          <div key={house.id} className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{shortAddress(house.address) || house.address}</h2>
              {!readOnly && <a
                className="btn-secondary"
                href={`/admin/rota?new=1&property=${house.id}&date=${bookOn}`}
                title="Open the rota's New job form with this house filled in"
                style={{ textDecoration: 'none' }}
              >
                Book a visit on the rota
              </a>}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 10px' }}>
              {nextVisit
                ? (readOnly
                  ? <>Next visit {visitLabel(nextVisit)}{nextPlanned.size > 0 ? `: communal areas and ${[...nextPlanned].join(', ')}` : ': communal areas'}</>
                  : <>Next visit {visitLabel(nextVisit)} · booked {lengthLabel(nextVisit.duration_minutes || 0)}{nextPlanned.size > 0 ? ` including ${nextPlanned.size} room${nextPlanned.size === 1 ? '' : 's'} (${[...nextPlanned].join(', ')})` : ', communal only'}</>)
                : readOnly
                  ? <>No visit booked in the next six weeks yet.</>
                  : <span style={{ color: 'var(--wf-overdue)' }}>No visit booked in the next six weeks - add one on the rota.</span>}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="wf-table" style={{ width: '100%', fontSize: 13.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Area</th>
                    <th style={{ textAlign: 'left' }}>Last done</th>
                    <th style={{ textAlign: 'left' }}>Next booked</th>
                    <th style={{ textAlign: 'left' }}>Status</th>
                    {!readOnly && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const lastPlannedJob = row.lastPlannedJobId ? jobById.get(row.lastPlannedJobId) : null;
                    const nextJob = row.nextJobId ? jobById.get(row.nextJobId) : null;
                    const isBusy = (id) => busy === `${id}:${row.room}`;
                    return (
                      <tr key={row.label}>
                        <td style={{ fontWeight: row.communal ? 600 : 400 }}>
                          {row.label}
                          {row.communal && (areas[house.id] || []).length > 0 && (
                            <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)', maxWidth: 260 }}>
                              {areas[house.id].join(', ')}
                            </div>
                          )}
                        </td>
                        <td>
                          {dayLabel(row.last) || <span style={{ color: 'var(--muted)' }}>Not yet</span>}
                          {row.missedOn && <div style={{ fontSize: 12, color: 'var(--wf-overdue)' }}>Not done {dayLabel(row.missedOn)}</div>}
                        </td>
                        <td>{dayLabel(row.next) || <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                        <td>
                          <span className={STATUS[row.status].className}>{STATUS[row.status].label}</span>
                          {row.status !== 'booked' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>due {dayLabel(row.dueDay)}</div>}
                        </td>
                        {!readOnly && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {!row.communal && nextVisit && !nextPlanned.has(row.room) && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={!!busy}
                              onClick={() => act(nextVisit.id, row.room, 'add', `${row.room} booked for ${visitLabel(nextVisit)} - the visit is now ${perRoom} min longer.`)}
                              title={`Add ${row.room} to the next visit and make it ${perRoom} minutes longer`}
                            >
                              {isBusy(nextVisit.id) ? 'Saving...' : `Book ${dayLabel(ukDayOf(nextVisit))}`}
                            </button>
                          )}
                          {!row.communal && nextJob && nextJob.status === 'scheduled' && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={!!busy}
                              onClick={() => act(nextJob.id, row.room, 'remove', `${row.room} taken off ${visitLabel(nextJob)}.`)}
                              title="Take this room off that visit and shorten it"
                            >
                              {isBusy(nextJob.id) ? 'Saving...' : 'Unbook'}
                            </button>
                          )}
                          {!row.communal && lastPlannedJob && row.lastPlannedDone && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={!!busy}
                              onClick={() => markNotDone(row, lastPlannedJob)}
                              title={`The cleaner couldn't do ${row.room} on ${visitLabel(lastPlannedJob)} - don't charge it`}
                            >
                              {isBusy(lastPlannedJob.id) ? 'Saving...' : 'Not done'}
                            </button>
                          )}
                          {!row.communal && lastPlannedJob && row.missedOn && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={!!busy}
                              onClick={() => act(lastPlannedJob.id, row.room, 'unskip', `${row.room} counted as done on ${visitLabel(lastPlannedJob)}.`)}
                              title="It was done after all"
                            >
                              {isBusy(lastPlannedJob.id) ? 'Saving...' : 'It was done'}
                            </button>
                          )}
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ukDayOf = (job) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(job.scheduled_at));
