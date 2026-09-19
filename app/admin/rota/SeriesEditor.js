'use client';

import { useMemo, useState } from 'react';
import { generateOccurrenceDates, MAX_OCCURRENCES, WEEKDAY_OPTIONS } from '../../../lib/recurrence';
import { planSeriesEdit, describeSeriesPlan } from '../../../lib/seriesEdit';
import { localDateString } from '../../../lib/localDate';

// The form for changing a recurring series from one of its jobs onward.
// It only works out what would change; applying it is the rota page's
// job, because that is where the conflict checks, notifications and the
// week's state live. The office sees the plan before pressing Save.

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_OPTIONS = [0, 15, 30, 45];
const QUICK_DURATIONS = [30, 60, 90, 120, 180, 240];
const DURATION_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 15).map((mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h} hr${h > 1 ? 's' : ''} `;
  if (m > 0) label += `${m} min`;
  return { value: mins, label: label.trim() };
});

function formatHour12(h) {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let label = '';
  if (h > 0) label += `${h}h `;
  if (m > 0) label += `${m}m`;
  return label.trim();
}

const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * @param {object} props
 * @param {object} props.series the job_series row
 * @param {object} props.fromJob the occurrence the edit starts from
 * @param {object[]} props.futureJobs the series' jobs from that one onward
 * @param {(plan, form) => Promise<void>} props.onSave
 * @param {() => void} props.onCancel
 */
export default function SeriesEditor({ series, fromJob, futureJobs, onSave, onCancel }) {
  const start = new Date(fromJob.scheduled_at);
  const lastExisting = futureJobs.reduce((max, j) => (new Date(j.scheduled_at) > max ? new Date(j.scheduled_at) : max), start);

  const [recurrenceType, setRecurrenceType] = useState(series.recurrence_type || 'weekly');
  const [interval, setInterval] = useState(series.interval_count || 1);
  const [weekdays, setWeekdays] = useState(
    Array.isArray(series.weekdays) && series.weekdays.length > 0 ? series.weekdays : [start.getDay()]
  );
  const [hour, setHour] = useState(String(start.getHours()).padStart(2, '0'));
  const [minute, setMinute] = useState(String(start.getMinutes() - (start.getMinutes() % 15)).padStart(2, '0'));
  const [duration, setDuration] = useState(fromJob.duration_minutes || series.duration_minutes || 120);
  const [useCustomDuration, setUseCustomDuration] = useState(!QUICK_DURATIONS.includes(fromJob.duration_minutes || series.duration_minutes || 120));
  const [endDate, setEndDate] = useState(localDateString(lastExisting));
  const [saving, setSaving] = useState(false);

  const toggleWeekday = (day) => {
    setWeekdays(weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day]);
  };

  // What the series produced as it stood, over the span it already covers.
  // Anything not on one of these days was put there by hand and is left
  // alone whatever the edit says.
  const oldDates = useMemo(() => generateOccurrenceDates(
    start,
    series.recurrence_type || 'weekly',
    series.interval_count || 1,
    'date',
    new Date(`${localDateString(lastExisting)}T23:59`),
    0,
    series.weekdays
  ), [series, fromJob.scheduled_at, lastExisting.getTime()]);

  const newDates = useMemo(() => {
    if (!endDate) return null;
    if (recurrenceType === 'weekly' && weekdays.length === 0) return null;
    const first = new Date(`${localDateString(start)}T${hour}:${minute}`);
    return generateOccurrenceDates(first, recurrenceType, interval, 'date', new Date(`${endDate}T23:59`), 0, weekdays);
  }, [endDate, recurrenceType, weekdays, hour, minute, interval, fromJob.scheduled_at]);

  const plan = useMemo(
    () => (newDates ? planSeriesEdit(futureJobs, newDates, duration, oldDates) : null),
    [futureJobs, newDates, duration, oldDates]
  );

  const hasChanges = plan && (plan.move.length > 0 || plan.add.length > 0 || plan.remove.length > 0);

  const save = async () => {
    if (!plan || !hasChanges || saving) return;
    setSaving(true);
    try {
      await onSave(plan, {
        recurrenceType,
        interval,
        weekdays: recurrenceType === 'weekly' ? [...weekdays].sort((a, b) => a - b) : null,
        duration,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="series-editor" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>
        Changes apply from {fmtDay(start)} onward. Earlier visits are not touched, and neither is any
        visit that has already happened or that was moved to a different day by hand.
      </p>

      <div className="field-row">
        <div className="field">
          <label className="field-label">Frequency</label>
          <select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">
            Every {interval > 1 ? `${interval} ` : ''}
            {recurrenceType === 'daily' ? `day${interval > 1 ? 's' : ''}` : recurrenceType === 'weekly' ? `week${interval > 1 ? 's' : ''}` : `month${interval > 1 ? 's' : ''}`}
          </label>
          <input type="number" min="1" max="52" value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))} />
        </div>
      </div>

      {recurrenceType === 'weekly' && (
        <div className="field">
          <label className="field-label">On these days</label>
          <div className="weekday-ticks">
            {WEEKDAY_OPTIONS.map((w) => (
              <label key={w.day} className={`weekday-tick ${weekdays.includes(w.day) ? 'active' : ''}`} title={w.label}>
                <input type="checkbox" checked={weekdays.includes(w.day)} onChange={() => toggleWeekday(w.day)} aria-label={w.label} />
                {w.short}
              </label>
            ))}
          </div>
          {weekdays.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--wf-coral)', margin: '6px 0 0' }}>Tick at least one day.</p>
          )}
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label className="field-label">Time</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={hour} onChange={(e) => setHour(e.target.value)} style={{ flex: 1.4, marginBottom: 0 }}>
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={String(h).padStart(2, '0')}>{formatHour12(h)}</option>
              ))}
            </select>
            <select value={minute} onChange={(e) => setMinute(e.target.value)} style={{ flex: 1, marginBottom: 0 }}>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={String(m).padStart(2, '0')}>:{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Until</label>
          <input type="date" value={endDate} min={localDateString(start)} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Duration</label>
        <div className="duration-chips">
          {QUICK_DURATIONS.map((mins) => (
            <button
              type="button"
              key={mins}
              className={`duration-chip ${!useCustomDuration && duration === mins ? 'active' : ''}`}
              onClick={() => { setDuration(mins); setUseCustomDuration(false); }}
            >
              {formatDuration(mins)}
            </button>
          ))}
          <button type="button" className={`duration-chip ${useCustomDuration ? 'active' : ''}`} onClick={() => setUseCustomDuration(true)}>
            Custom
          </button>
        </div>
        {useCustomDuration && (
          <div className="duration-custom-select">
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {plan && (
        <div className="card" style={{ background: 'var(--wf-ash)', padding: '10px 12px', marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{describeSeriesPlan(plan)}</p>
          {plan.add.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
              New visits get the same cleaners and tasks as this one: {plan.add.slice(0, 6).map(fmtDay).join(', ')}{plan.add.length > 6 ? ` and ${plan.add.length - 6} more` : ''}.
            </p>
          )}
          {plan.remove.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--wf-coral)', margin: '4px 0 0' }}>
              Removed for good: {plan.remove.map((j) => fmtDay(new Date(j.scheduled_at))).join(', ')}.
            </p>
          )}
          {plan.locked.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
              Left alone: {plan.locked.map((j) => fmtDay(new Date(j.scheduled_at))).join(', ')}.
            </p>
          )}
          {newDates && newDates.length >= MAX_OCCURRENCES && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>Capped at {MAX_OCCURRENCES} visits.</p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={!hasChanges || saving} title={hasChanges ? undefined : 'Nothing has changed yet'}>
          {saving ? 'Saving...' : 'Save series'}
        </button>
      </div>
    </div>
  );
}
