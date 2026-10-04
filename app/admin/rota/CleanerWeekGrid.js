'use client';

import { useState } from 'react';
import { coworkersOf, firstName, formatHours, freeGaps, formatGap, shareMinutes, UNASSIGNED_ROW_ID } from '../../../lib/rotaGrid';
import { isTraining, jobHeadline, jobSubtitle } from '../../../lib/training';
import { localDateString } from '../../../lib/localDate';
import { tintFor, tintsByOrder } from '../../../lib/avatarTint';

// The rota with a row per cleaner. Across the week, each cell lists that
// person's jobs for the day in order, so a gap on the sheet is a gap in
// their day. On a single day the row opens out: every job carries its
// times and address, and the free time between jobs is drawn as a slot
// the office can book straight into.
//
// Clicking a job opens it; the "+" in a cell books a new job for that
// person on that day; on a desktop a scheduled job can be dragged to
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

function clockOf(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function clockAt(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function endOf(job) {
  return new Date(new Date(job.scheduled_at).getTime() + (job.duration_minutes || 120) * 60000);
}

// Fri 3 Oct, or 3 – 10 Oct, for the hover text on a time-off block.
function describeSpan(start, end) {
  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

function statusWord(job) {
  if (job.status === 'missed') return 'Missed';
  if (job.status === 'in_progress') return 'On site';
  if (job.status === 'completed') return 'Completed';
  return null;
}

// `dayIndex` null draws the whole week; a number draws that one day only.
export default function CleanerWeekGrid({ rows, weekDays, todayKey, timeOff = [], placeParts, dayIndex = null, onOpenJob, onNewJob, onDropJob }) {
  // The cell under a dragged job, so it can light up as the place the job
  // will land. Only meaningful mid-drag; cleared on drop or leave.
  const [over, setOver] = useState(null);

  const single = dayIndex !== null && dayIndex !== undefined;
  // The team's colours, handed out down the list in order. The row for
  // nobody and anyone who has left are not part of the team list.
  const tints = tintsByOrder(rows.filter((r) => r.current && r.id !== UNASSIGNED_ROW_ID).map((r) => r.id));
  const tintOf = (id) => tints.get(id) || tintFor(id);
  const shownDays = single ? [dayIndex] : weekDays.map((_, i) => i);

  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const dayClass = (i) => {
    const isToday = weekDays[i].toDateString() === todayKey;
    const isPast = weekDays[i] < startOfToday;
    return [isToday ? 'today' : '', isPast ? 'past' : '', i > 4 ? 'weekend' : ''].filter(Boolean).join(' ');
  };

  // Approved time off is a whole-day thing, so a day is "away" when its
  // date falls inside the request. Dates compare as YYYY-MM-DD strings.
  const dayKeys = weekDays.map(localDateString);
  const awayOn = (cleanerId, i) => (cleanerId
    ? timeOff.find((t) => t.cleaner_id === cleanerId && t.start_date <= dayKeys[i] && t.end_date >= dayKeys[i])
    : null);

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
    // Training has no client, so the chip names the training and its venue
    // where a clean names the client and the address.
    const training = isTraining(job);
    // A client with several sites leads with the street and names itself
    // underneath; anyone else is just their name.
    const { place: client, client: owner } = training
      ? { place: jobHeadline(job), client: null }
      : placeParts
        ? placeParts(job)
        : { place: job.properties?.clients?.name || job.properties?.address || 'Unknown client', client: null };
    const where = training ? jobSubtitle(job) : job.properties?.address;
    const others = coworkersOf(job, cleanerId).map(firstName);
    // On a shared job the note says who else is on it and what this
    // person's share comes to, so an 8-hour job for two reads as 4 hours
    // on each row.
    const withNote = others.length > 0 ? `+ ${others.join(', ')} · ${formatHours(shareMinutes(job, cleanerId))}h` : null;
    const draggable = job.status === 'scheduled';
    const everyone = (job.job_assignments || []).map((a) => a.profiles?.full_name || 'Unknown');
    const timeRange = `${clockOf(job.scheduled_at)} – ${clockOf(endOf(job))}`;
    const word = statusWord(job);
    const title = [
      timeRange,
      client,
      owner,
      where,
      unassigned ? (training ? 'Nobody booked on' : 'Needs a cleaner') : everyone.join(', '),
      withNote ? `${formatHours(shareMinutes(job, cleanerId))}h for ${firstName(row.name)}` : null,
      word,
      draggable ? 'Drag to another day or cleaner, or click to open' : 'Click to open',
    ].filter(Boolean).join(' · ');

    const className = [
      'rota-chip',
      job.status,
      unassigned ? 'unassigned' : '',
      training ? 'is-training' : '',
      draggable ? 'draggable' : '',
      single ? 'is-day' : '',
    ].filter(Boolean).join(' ');

    const dragProps = {
      draggable,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ jobId: job.id, fromRowId: row.id }));
        // Some browsers need a plain-text payload before they will start
        // a drag at all.
        e.dataTransfer.setData('text/plain', job.id);
      },
      onDragEnd: () => setOver(null),
    };

    // Two lines: when and where on top, everything else underneath, so the
    // place is never squeezed out by a note about who else is on the job.
    const problem = unassigned ? (training ? 'Nobody booked on' : 'No cleaner yet') : null;
    const sub = (single
      ? [owner, where && where !== client ? where : null, withNote, problem, word]
      : [owner, withNote, problem, job.status === 'missed' ? 'missed' : job.status === 'in_progress' ? 'on site' : null]
    ).filter(Boolean).join(' · ');

    return (
      <button key={`${row.id}-${job.id}`} type="button" className={className} {...dragProps} onClick={() => onOpenJob(job)} title={title}>
        {/* On a day the row is wide enough for time and place side by side.
            Across a week a column is not, and sharing a line left the place
            as "Swa…" - so there the place gets a line of its own. */}
        {single ? (
          <span className="rota-chip-line">
            <span className="rota-chip-dot" aria-hidden="true" />
            <b>{timeRange}</b>
            <span className="rota-chip-client">{client}</span>
          </span>
        ) : (
          <>
            <span className="rota-chip-line">
              <span className="rota-chip-dot" aria-hidden="true" />
              <b>{clockOf(job.scheduled_at)}</b>
            </span>
            <span className="rota-chip-client is-own-line">{client}</span>
          </>
        )}
        {sub && <span className="rota-chip-sub">{sub}</span>}
      </button>
    );
  };

  // On a single day a cleaner's cell is their jobs and the free time
  // between them, in clock order. A gap is a button: booking into it
  // starts the new job form with the day, the person and the time filled.
  const renderDayItems = (list, row, i) => {
    const cleanerId = row.id === UNASSIGNED_ROW_ID ? null : row.id;
    // Someone who is away has no free time to offer, however empty the day.
    if (!cleanerId || awayOn(cleanerId, i)) return list.map((job) => renderChip(job, row));

    const gaps = freeGaps(list).map((g) => ({ kind: 'gap', start: g.start, gap: g }));
    const jobs = list.map((job) => {
      const d = new Date(job.scheduled_at);
      return { kind: 'job', start: d.getHours() * 60 + d.getMinutes(), job };
    });
    const items = [...jobs, ...gaps].sort((a, b) => a.start - b.start);
    const who = firstName(row.name);

    return items.map((item) => {
      if (item.kind === 'job') return renderChip(item.job, row);
      const { start, end } = item.gap;
      const length = formatGap(end - start);
      return (
        <button
          key={`gap-${row.id}-${start}`}
          type="button"
          className="rota-gap"
          onClick={() => onNewJob(i, cleanerId, start)}
          title={`${who} is free ${clockAt(start)} – ${clockAt(end)}. Book a job here.`}
        >
          <span>Free {clockAt(start)} – {clockAt(end)}</span>
          <small>{length} · book</small>
        </button>
      );
    });
  };

  return (
    <div className="calendar rota-grid-wrap">
      <div className="rota-grid-scroll">
        <div className={`rota-grid ${single ? 'is-day' : ''}`} role="table" aria-label={single ? 'Rota by cleaner for the day' : 'Rota by cleaner'}>
          <div className="rota-grid-head" role="row">
            <div className="rota-grid-who rota-grid-corner" role="columnheader">Team</div>
            {shownDays.map((i) => {
              const day = weekDays[i];
              const isToday = day.toDateString() === todayKey;
              return (
                <div key={i} className={`rota-grid-dayhead ${dayClass(i)}`} role="columnheader">
                  <span className="rota-grid-dayname">{DAY_NAMES[i]}</span>
                  <span className="rota-grid-daynum">{day.getDate()}</span>
                  {isToday && <span className="rota-grid-todaypill">Today</span>}
                  {single && <span className="rota-grid-daynote">Free time counted 07:00 – 18:00</span>}
                </div>
              );
            })}
            <div className="rota-grid-hourshead" role="columnheader">Hours</div>
          </div>

          {rows.map((row) => {
            const isUnassigned = row.id === UNASSIGNED_ROW_ID;
            const cleanerId = isUnassigned ? null : row.id;
            const shownLists = shownDays.map((i) => row.days[i]);
            const shownJobs = shownLists.reduce((n, list) => n + list.length, 0);
            const shownMinutes = shownLists.reduce((sum, list) => sum + list.reduce((s, j) => s + shareMinutes(j, cleanerId), 0), 0);
            // A row for nobody with nothing on it is a good sign, not a
            // sheet row - it only appears when there is something to fix.
            if (isUnassigned && shownJobs === 0) return null;
            // Someone who has left only earns a row on a day they still
            // hold a job.
            if (!row.current && shownJobs === 0) return null;

            return (
              <div key={row.id} className={`rota-grid-row ${isUnassigned ? 'is-unassigned' : ''} ${row.current ? '' : 'is-former'}`} role="row">
                <div className="rota-grid-who" role="rowheader">
                  <span
                    className={`rota-grid-avatar ${isUnassigned ? 'unassigned' : ''}`}
                    style={isUnassigned ? undefined : { background: tintOf(row.id)[0], color: tintOf(row.id)[1] }}
                    aria-hidden="true"
                  >
                    {isUnassigned ? '?' : initials(row.name)}
                  </span>
                  <span className="rota-grid-whotext">
                    <span className="rota-grid-name">{row.name}</span>
                    <span className={`rota-grid-meta ${isUnassigned ? 'is-alert' : ''}`}>
                      {shownJobs} job{shownJobs === 1 ? '' : 's'}
                      {isUnassigned ? (shownJobs === 1 ? ' needs someone' : ' need someone') : row.current ? '' : ' · no longer on staff'}
                    </span>
                  </span>
                </div>

                {shownDays.map((i) => {
                  const list = row.days[i];
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
                      {(() => {
                        const away = awayOn(cleanerId, i);
                        if (!away) return null;
                        const word = away.type === 'holiday' ? 'Holiday' : 'Unavailable';
                        // Booked while away is a mistake worth saying out
                        // loud, not just two things drawn in one cell.
                        const clash = list.length > 0;
                        return (
                          <div
                            className={`rota-timeoff ${away.type}${clash ? ' is-clash' : ''}`}
                            title={`${firstName(row.name)}: ${word.toLowerCase()} ${describeSpan(away.start_date, away.end_date)}${clash ? ' - but still booked on a job this day' : ''}`}
                          >
                            {word}{clash ? ' · still booked' : ''}
                          </div>
                        );
                      })()}
                      {single ? renderDayItems(list, row, i) : list.map((job) => renderChip(job, row))}
                      {(!isUnassigned || list.length === 0) && (
                        <button
                          type="button"
                          className={`rota-grid-add${list.length === 0 && !isUnassigned && !awayOn(cleanerId, i) && weekDays[i] >= startOfToday ? ' is-open' : ''}`}
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

                <div className="rota-grid-hours" role="cell" title={`${formatHours(shownMinutes)} hours scheduled ${single ? 'today' : 'this week'}`}>
                  {formatHours(shownMinutes)}
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
