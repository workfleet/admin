'use client';

import { useState } from 'react';
import { coworkersOf, firstName, formatHours, UNASSIGNED_ROW_ID } from '../../../lib/rotaGrid';

// The week with a row per cleaner and the days across. Each cell lists that
// person's jobs for the day in order, so a gap on the sheet is a gap in
// their day. Clicking a job opens it; the "+" in a cell books a new job for
// that person on that day; on a desktop a scheduled job can be dragged to
// another day or onto someone else's row.
//
// The page owns the data and every save. This only draws it and says what
// was clicked or dropped where.

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DRAG_MIME = 'application/x-rota-job';

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function clock(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function endOf(job) {
  return new Date(new Date(job.scheduled_at).getTime() + (job.duration_minutes || 120) * 60000);
}

export default function CleanerWeekGrid({ rows, weekDays, todayKey, onOpenJob, onNewJob, onDropJob }) {
  // The cell under a dragged job, so it can light up as the place the job
  // will land. Only meaningful mid-drag; cleared on drop or leave.
  const [over, setOver] = useState(null);

  const dayClass = (i) => {
    const isToday = weekDays[i].toDateString() === todayKey;
    return [isToday ? 'today' : '', i > 4 ? 'weekend' : ''].filter(Boolean).join(' ');
  };

  const readDrag = (e) => {
    try {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const renderChip = (job, row) => {
    const cleanerId = row.id === UNASSIGNED_ROW_ID ? null : row.id;
    const unassigned = (job.job_assignments || []).length === 0;
    const client = job.properties?.clients?.name || job.properties?.address || 'Unknown client';
    const others = coworkersOf(job, cleanerId).map(firstName);
    const draggable = job.status === 'scheduled';
    const everyone = (job.job_assignments || []).map((a) => a.profiles?.full_name || 'Unknown');
    const title = [
      `${clock(job.scheduled_at)} – ${clock(endOf(job))}`,
      client,
      job.properties?.address,
      unassigned ? 'Needs a cleaner' : everyone.join(', '),
      job.status === 'missed' ? 'Missed' : job.status === 'in_progress' ? 'On site' : job.status === 'completed' ? 'Completed' : null,
      draggable ? 'Drag to another day or cleaner, or click to open' : 'Click to open',
    ].filter(Boolean).join(' · ');

    return (
      <button
        key={`${row.id}-${job.id}`}
        type="button"
        className={[
          'rota-chip',
          job.status,
          unassigned ? 'unassigned' : '',
          draggable ? 'draggable' : '',
        ].filter(Boolean).join(' ')}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ jobId: job.id, fromRowId: row.id }));
          // Some browsers need a plain-text payload before they will start
          // a drag at all.
          e.dataTransfer.setData('text/plain', job.id);
        }}
        onDragEnd={() => setOver(null)}
        onClick={() => onOpenJob(job)}
        title={title}
      >
        <b>{clock(job.scheduled_at)}</b>
        <span className="rota-chip-client">{client}</span>
        {others.length > 0 && <span className="rota-chip-with">w/ {others.join(', ')}</span>}
        {job.status === 'missed' && <span className="rota-chip-with">missed</span>}
      </button>
    );
  };

  return (
    <div className="calendar rota-grid-wrap">
      <div className="rota-grid-scroll">
        <div className="rota-grid" role="table" aria-label="Rota by cleaner">
          <div className="rota-grid-head" role="row">
            <div className="rota-grid-who rota-grid-corner" role="columnheader">Cleaner</div>
            {weekDays.map((day, i) => {
              const isToday = day.toDateString() === todayKey;
              return (
                <div key={i} className={`rota-grid-dayhead ${dayClass(i)}`} role="columnheader">
                  <span className="rota-grid-daynum">{day.getDate()}</span>
                  <span className="rota-grid-dayname">{DAY_NAMES[i]}{isToday ? ' · today' : ''}</span>
                </div>
              );
            })}
            <div className="rota-grid-hourshead" role="columnheader">Hours</div>
          </div>

          {rows.map((row) => {
            const isUnassigned = row.id === UNASSIGNED_ROW_ID;
            // A row for nobody with nothing on it is a good sign, not a
            // sheet row - it only appears when there is something to fix.
            if (isUnassigned && row.jobCount === 0) return null;
            const cleanerId = isUnassigned ? null : row.id;

            return (
              <div key={row.id} className={`rota-grid-row ${isUnassigned ? 'is-unassigned' : ''} ${row.current ? '' : 'is-former'}`} role="row">
                <div className="rota-grid-who" role="rowheader">
                  <span className={`rota-grid-avatar ${isUnassigned ? 'unassigned' : ''}`} aria-hidden="true">
                    {isUnassigned ? '?' : initials(row.name)}
                  </span>
                  <span className="rota-grid-whotext">
                    <span className="rota-grid-name">{row.name}</span>
                    <span className={`rota-grid-meta ${isUnassigned ? 'is-alert' : ''}`}>
                      {row.jobCount} job{row.jobCount === 1 ? '' : 's'}
                      {isUnassigned ? ' need someone' : row.current ? '' : ' · no longer on staff'}
                    </span>
                  </span>
                </div>

                {row.days.map((list, i) => {
                  const key = `${row.id}:${i}`;
                  const dayLabel = weekDays[i].toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
                  return (
                    <div
                      key={i}
                      role="cell"
                      className={`rota-grid-cell ${dayClass(i)} ${over === key ? 'drag-over' : ''}`}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (over !== key) setOver(key);
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget)) return;
                        setOver((o) => (o === key ? null : o));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOver(null);
                        const payload = readDrag(e);
                        if (payload) onDropJob({ ...payload, toRowId: row.id, dayIndex: i });
                      }}
                    >
                      {list.map((job) => renderChip(job, row))}
                      {(!isUnassigned || list.length === 0) && (
                        <button
                          type="button"
                          className="rota-grid-add"
                          onClick={() => onNewJob(i, cleanerId)}
                          aria-label={cleanerId ? `New job for ${row.name} on ${dayLabel}` : `New job on ${dayLabel}`}
                          title={cleanerId ? `Book ${firstName(row.name)} a job on ${dayLabel}` : `Book a job on ${dayLabel}`}
                        >
                          +
                        </button>
                      )}
                    </div>
                  );
                })}

                <div className="rota-grid-hours" role="cell" title={`${formatHours(row.minutes)} hours scheduled this week`}>
                  {formatHours(row.minutes)}
                  <small>hrs</small>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
