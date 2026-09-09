'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, Lock, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, CalendarClock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../lib/authGate';
import { formatHours } from '../../../lib/hoursWorked';
import { toCSV, downloadCSV } from '../../../lib/csv';
import { notify } from '../../../lib/notify';
import { MISSED_SHIFT_OUTCOMES, isJobWideOutcome } from '../../../lib/missedShiftOutcomes';
import {
  DEFAULT_PAYROLL_SETTINGS,
  WEEKDAY_NAMES,
  nextPeriodToClose,
  recentEndedPeriods,
  periodHasEnded,
  periodLabel,
  monthLabelIfWhole,
  parseLocalDate,
} from '../../../lib/payroll';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

// What each kind of hold-up is called, and where the admin goes to clear it.
// The kinds themselves come from payroll_close_review() in migration 0082 -
// this is only the wording.
const REVIEW_KINDS = {
  pending_claim: { title: 'Missed clock-in claims to decide', href: '/admin/requests', linkLabel: 'Open Requests' },
  short_shift: { title: 'Short shifts to confirm or correct', href: '/admin/requests', linkLabel: 'Open Requests' },
  unfinished: { title: 'Jobs not finished', href: '/admin/rota', linkLabel: 'Open Rota' },
  // Since 0093 these hold the close until each person on the shift has an
  // outcome. Decided right here rather than on Requests: the admin is
  // looking at the hours, and the answer is one click per person.
  missed_shift: { title: 'Shifts nobody clocked into - what happened?', href: '/admin/requests', linkLabel: 'Open Requests' },
};

// Missed shifts that have been accounted for (0093). Not a hold-up - listed
// so what was recorded is in view at the moment of closing, with a way back
// if it was the wrong call.
const RECORDED_KIND = 'missed_recorded';

const CLOSE_ERRORS = {
  blocked: 'Something in this period still needs a decision - see the list above.',
  period_not_ended: 'This period has not finished yet.',
  not_next: 'Periods close in order - refresh the page to see the next one.',
  overlaps: 'That period overlaps one already closed.',
  not_allowed: 'Only an admin can close payroll.',
  bad_range: 'That is not a valid period.',
};

function displayLabel(period) {
  return monthLabelIfWhole(period) || periodLabel(period);
}

function shortDay(value) {
  return new Date(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function signedHours(minutes) {
  const label = formatHours(Math.abs(minutes) / 60);
  return minutes < 0 ? `-${label}` : `+${label}`;
}

// Per-cleaner totals from a set of lines and adjustments.
function summarise(lines, adjustments) {
  const byCleaner = {};
  const row = (id, name) => {
    const key = id || name || 'unknown';
    if (!byCleaner[key]) byCleaner[key] = { id: key, cleanerId: id || null, name: name || 'Unknown', jobs: 0, minutes: 0, adjustmentMinutes: 0 };
    return byCleaner[key];
  };
  lines.forEach((l) => {
    const r = row(l.cleaner_id, l.cleaner_name);
    r.jobs += 1;
    r.minutes += Number(l.minutes);
  });
  adjustments.forEach((a) => {
    row(a.cleaner_id, a.cleaner_name).adjustmentMinutes += Number(a.minutes);
  });
  return Object.values(byCleaner)
    .map((r) => ({ ...r, totalMinutes: r.minutes + r.adjustmentMinutes }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function csvFor(period, rows) {
  const columns = [
    { key: 'name', label: 'Cleaner' },
    { key: 'jobs', label: 'Jobs' },
    { key: 'hours', label: 'Hours Worked' },
    { key: 'adjustments', label: 'Adjustments (h)' },
    { key: 'total', label: 'Total Hours' },
  ];
  const data = rows.map((r) => ({
    name: r.name,
    jobs: r.jobs,
    hours: (r.minutes / 60).toFixed(2),
    adjustments: (r.adjustmentMinutes / 60).toFixed(2),
    total: (r.totalMinutes / 60).toFixed(2),
  }));
  const lastDay = new Date(parseLocalDate(period.end).getTime() - 86400000);
  const stamp = `${period.start}-to-${lastDay.toISOString().slice(0, 10)}`;
  downloadCSV(`payroll-${stamp}.csv`, toCSV(columns, data));
}

function SummaryTable({ rows, showAdjustments }) {
  const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid var(--hairline)', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td = { padding: '9px 12px', whiteSpace: 'nowrap' };
  const num = { ...td, textAlign: 'right', fontFamily: 'var(--wf-data)', fontWeight: 600 };
  const totals = rows.reduce((t, r) => ({
    jobs: t.jobs + r.jobs, minutes: t.minutes + r.minutes, adj: t.adj + r.adjustmentMinutes, total: t.total + r.totalMinutes,
  }), { jobs: 0, minutes: 0, adj: 0, total: 0 });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr>
            <th style={th}>Cleaner</th>
            <th style={{ ...th, textAlign: 'right' }}>Jobs</th>
            <th style={{ ...th, textAlign: 'right' }}>Hours</th>
            {showAdjustments && <th style={{ ...th, textAlign: 'right' }}>Adjustments</th>}
            {showAdjustments && <th style={{ ...th, textAlign: 'right' }}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
              <td style={td}>{r.name}</td>
              <td style={num}>{r.jobs}</td>
              <td style={num}>{formatHours(r.minutes / 60)}</td>
              {showAdjustments && (
                <td style={{ ...num, color: r.adjustmentMinutes === 0 ? 'var(--muted)' : 'inherit' }}>
                  {r.adjustmentMinutes === 0 ? '–' : signedHours(r.adjustmentMinutes)}
                </td>
              )}
              {showAdjustments && <td style={num}>{formatHours(r.totalMinutes / 60)}</td>}
            </tr>
          ))}
          <tr>
            <td style={{ ...td, fontWeight: 600 }}>Total</td>
            <td style={num}>{totals.jobs}</td>
            <td style={num}>{formatHours(totals.minutes / 60)}</td>
            {showAdjustments && <td style={num}>{totals.adj === 0 ? '–' : signedHours(totals.adj)}</td>}
            {showAdjustments && <td style={num}>{formatHours(totals.total / 60)}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AdjustmentList({ adjustments }) {
  return (
    <div>
      {adjustments.map((a) => (
        <div key={a.id} className="task-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
              {a.cleaner_name || 'Unknown'}
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                {' · '}{a.job_address || 'Job'}{a.job_date ? `, ${shortDay(parseLocalDate(a.job_date))}` : ''}
              </span>
            </span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>{a.reason}</span>
          </span>
          <span style={{ fontFamily: 'var(--wf-data)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: Number(a.minutes) < 0 ? 'var(--wf-overdue)' : 'inherit' }}>
            {signedHours(Number(a.minutes))}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminPayroll() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_PAYROLL_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_PAYROLL_SETTINGS);
  const [settingsId, setSettingsId] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [periods, setPeriods] = useState([]);
  const [lines, setLines] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  // Before anything has been closed there is nothing to continue from, so
  // the admin picks where the app's record starts. Everything earlier was
  // paid outside the app and is never touched.
  const [firstStart, setFirstStart] = useState(null);
  const [next, setNext] = useState(null);
  const [review, setReview] = useState([]);
  const [preview, setPreview] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  // What the admin has picked for each undecided missed shift, keyed by
  // job and person, until they press Record.
  const [outcomeDraft, setOutcomeDraft] = useState({});
  const [decidingKey, setDecidingKey] = useState(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!loading) loadReview();
  }, [next?.start, next?.end]);

  const load = async () => {
    const { session, profile } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }
    // Payroll is admin-only, as on the dashboard. The layout hides the link
    // from supervisors; this is the check that matters.
    if (profile?.role !== 'admin') { router.push('/admin'); return; }

    const [{ data: cs }, { data: periodRows }, { data: lineRows }, { data: adjRows }] = await Promise.all([
      supabase.from('company_settings').select('id, payroll_frequency, payroll_week_starts_on').limit(1).maybeSingle(),
      supabase
        .from('payroll_periods')
        .select('id, period_start, period_end, closed_at, note, closer:profiles!payroll_periods_closed_by_fkey(full_name)')
        .order('period_start', { ascending: false }),
      supabase.from('payroll_period_lines').select('period_id, cleaner_id, cleaner_name, job_id, job_address, job_date, minutes'),
      supabase
        .from('payroll_adjustments')
        .select('id, cleaner_id, cleaner_name, job_id, job_address, job_date, minutes, reason, created_at, included_in_period_id')
        .order('created_at', { ascending: false }),
    ]);

    const loaded = {
      frequency: cs?.payroll_frequency || DEFAULT_PAYROLL_SETTINGS.frequency,
      weekStartsOn: cs?.payroll_week_starts_on ?? DEFAULT_PAYROLL_SETTINGS.weekStartsOn,
    };
    setSettings(loaded);
    setSettingsDraft(loaded);
    setSettingsId(cs?.id || null);
    setPeriods(periodRows || []);
    setLines(lineRows || []);
    setAdjustments(adjRows || []);

    const lastEnd = periodRows?.[0]?.period_end || null;
    if (lastEnd) {
      setNext(nextPeriodToClose(lastEnd, loaded));
    } else {
      const candidates = recentEndedPeriods(8, loaded);
      const chosen = candidates.find((p) => p.start === firstStart) || candidates[0];
      setFirstStart(chosen.start);
      setNext(chosen);
    }
    setLoading(false);
  };

  const loadReview = async () => {
    if (!next) return;
    setReviewLoading(true);
    const [{ data: reviewRows }, { data: previewRows }] = await Promise.all([
      supabase.rpc('payroll_close_review', { p_start: next.start, p_end: next.end }),
      supabase.rpc('payroll_period_lines_for', { p_start: next.start, p_end: next.end }),
    ]);
    setReview(reviewRows || []);
    setPreview(previewRows || []);
    setReviewLoading(false);
  };

  const chooseFirstPeriod = (start) => {
    const candidates = recentEndedPeriods(8, settings);
    const chosen = candidates.find((p) => p.start === start);
    if (!chosen) return;
    setFirstStart(start);
    setNext(chosen);
  };

  const saveSettings = async () => {
    if (!settingsId) { toast.error('Company settings have not been set up yet.'); return; }
    setSavingSettings(true);
    const { error } = await supabase
      .from('company_settings')
      .update({ payroll_frequency: settingsDraft.frequency, payroll_week_starts_on: settingsDraft.weekStartsOn })
      .eq('id', settingsId);
    setSavingSettings(false);
    if (error) { toast.error('Could not save the payroll schedule.'); return; }
    toast.success('Payroll schedule saved.');
    setFirstStart(null);
    await load();
  };

  const itemKey = (item) => `${item.job_id}:${item.cleaner_id || ''}`;

  // Unpaid, with a reason. A cancellation is about the job, so it is written
  // for everyone still undecided on that shift; the rest are about the one
  // person. Goes straight to the table - the period is not closed yet, so
  // there is nothing to adjust, and Undo below removes it again.
  const recordOutcome = async (item) => {
    const outcome = outcomeDraft[itemKey(item)];
    if (!outcome) { toast.error('Pick what happened first.'); return; }
    const { data: { session } } = await supabase.auth.getSession();

    const targets = isJobWideOutcome(outcome)
      ? blockers.filter((r) => r.kind === 'missed_shift' && r.job_id === item.job_id && r.cleaner_id)
      : [item];
    if (targets.length === 0) return;

    setDecidingKey(itemKey(item));
    const { error } = await supabase
      .from('missed_shift_outcomes')
      .upsert(
        targets.map((t) => ({ job_id: t.job_id, cleaner_id: t.cleaner_id, outcome, decided_by: session.user.id, decided_at: new Date().toISOString() })),
        { onConflict: 'job_id,cleaner_id' }
      );
    setDecidingKey(null);

    if (error) { toast.error('Could not record that. Please try again.'); return; }
    toast.success(targets.length > 1 ? `Recorded for ${targets.length} people.` : 'Recorded.');
    await loadReview();
  };

  // The paid route: the same confirmation Requests offers, from here. Pays
  // everyone assigned to the job the booked hours - the confirm says so.
  const confirmWorked = async (item) => {
    const onJob = blockers.filter((r) => r.kind === 'missed_shift' && r.job_id === item.job_id);
    const names = onJob.map((r) => r.cleaner_name).filter(Boolean);
    const proceed = await confirm(
      `Record ${names.length > 0 ? names.join(' and ') : 'everyone assigned'} as having worked `
      + `${item.job_address || 'this shift'} on ${new Date(item.scheduled_at).toLocaleDateString()}? `
      + 'This pays the shift as booked and accrues holiday on it.',
      { title: 'Confirm the shift was worked', confirmLabel: 'Yes, they worked it' }
    );
    if (!proceed) return;

    setDecidingKey(itemKey(item));
    const { data: outcome, error } = await supabase.rpc('admin_confirm_missed_shift', { target_job_id: item.job_id, note: null });
    setDecidingKey(null);

    if (error || outcome !== 'ok') {
      toast.error(outcome === 'not_missed'
        ? 'That shift is no longer missed - someone may have just clocked in.'
        : 'Could not record that. Please try again.');
      await loadReview();
      return;
    }
    toast.success('Recorded as worked - the hours now count towards pay and holiday.');
    await loadReview();
  };

  const undoOutcome = async (item) => {
    setDecidingKey(itemKey(item));
    const { error } = await supabase
      .from('missed_shift_outcomes')
      .delete()
      .eq('job_id', item.job_id)
      .eq('cleaner_id', item.cleaner_id);
    setDecidingKey(null);
    if (error) { toast.error('Could not undo that. Please try again.'); return; }
    await loadReview();
  };

  const pendingAdjustments = adjustments.filter((a) => !a.included_in_period_id);
  const blockers = review.filter((r) => r.blocking);
  const recorded = review.filter((r) => r.kind === RECORDED_KIND);
  // Before 0093 is applied the database still returns missed shifts as
  // non-blocking; they are shown the old way below rather than lost.
  const warnings = review.filter((r) => !r.blocking && r.kind !== RECORDED_KIND);
  const ended = next ? periodHasEnded(next) : false;
  const previewRows = summarise(preview, pendingAdjustments);
  const canClose = ended && blockers.length === 0 && !reviewLoading && !closing;

  const closePeriod = async () => {
    if (!next || !canClose) return;
    const totalMinutes = previewRows.reduce((sum, r) => sum + r.totalMinutes, 0);
    const proceed = await confirm(
      `Lock ${displayLabel(next)} and record ${formatHours(totalMinutes / 60)} across `
      + `${previewRows.length} cleaner${previewRows.length === 1 ? '' : 's'} as sent to payroll? `
      + 'Anything that changes afterwards will show as an adjustment on the next run.',
      { title: 'Close this pay period', confirmLabel: 'Close period' }
    );
    if (!proceed) return;

    setClosing(true);
    const { data: outcome, error } = await supabase.rpc('close_payroll_period', {
      p_start: next.start,
      p_end: next.end,
      p_note: note.trim() || null,
    });
    setClosing(false);

    if (error || outcome !== 'ok') {
      toast.error(CLOSE_ERRORS[outcome] || 'Could not close the period. Please try again.');
      await load();
      return;
    }

    notify({
      type: 'payroll_closed',
      periodLabel: displayLabel(next),
      cleaners: previewRows
        .filter((r) => r.cleanerId)
        .map((r) => ({ id: r.cleanerId, hoursLabel: formatHours(r.totalMinutes / 60) })),
    });

    toast.success(`${displayLabel(next)} closed - download the CSV below for QuickBooks.`);
    setNote('');
    setExpanded(null);
    await load();
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const groupedBlockers = Object.entries(REVIEW_KINDS)
    .map(([kind, def]) => ({ kind, ...def, items: blockers.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);

  const lastDay = next ? new Date(parseLocalDate(next.end).getTime() - 86400000) : null;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Payroll</h1>
          <p className="page-subtitle">Check a pay period, lock it, and hand QuickBooks a figure that will not move</p>
        </div>
      </div>

      {/* ---- Next period ---- */}
      {next && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>
                {periods.length === 0 ? 'First period to close' : 'Next period to close'}
              </div>
              <h2 style={{ margin: '4px 0 0' }}>{displayLabel(next)}</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                {ended
                  ? 'Finished - ready to check.'
                  : `Runs until ${shortDay(lastDay)} - it can be closed from ${shortDay(parseLocalDate(next.end))}.`}
              </p>
            </div>
            {periods.length === 0 && (
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>Start the record from</span>
                <select value={firstStart || ''} onChange={(e) => chooseFirstPeriod(e.target.value)} style={{ width: 'auto' }}>
                  {recentEndedPeriods(8, settings).map((p) => (
                    <option key={p.start} value={p.start}>{displayLabel(p)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {reviewLoading && <p className="empty-state" style={{ marginTop: 12 }}>Checking the period...</p>}

          {!reviewLoading && groupedBlockers.length > 0 && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: 'var(--wf-overdue-bg)', borderLeft: '3px solid var(--wf-overdue)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <AlertTriangle size={16} />
                <strong style={{ fontSize: 14 }}>
                  {blockers.length} thing{blockers.length === 1 ? '' : 's'} to settle before this closes
                </strong>
              </div>
              <p style={{ fontSize: 13, margin: '0 0 8px' }}>
                Each of these would change someone&apos;s hours after payroll went out. Deal with them, then come back.
              </p>
              {groupedBlockers.map((g) => (
                <div key={g.kind} style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{g.title} ({g.items.length})</strong>
                    <Link href={g.href} style={{ fontSize: 12.5, color: 'var(--brand-link)', fontWeight: 600, textDecoration: 'none' }}>
                      {g.linkLabel} &rarr;
                    </Link>
                  </div>
                  {g.kind === 'missed_shift' && (
                    <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 2px' }}>
                      Say what happened to each person. Only &ldquo;they worked it&rdquo; pays; every reason is recorded as unpaid.
                    </p>
                  )}
                  {g.items.map((item, i) => (
                    <div key={`${item.kind}-${item.job_id}-${item.cleaner_id || i}`} style={{ fontSize: 12.5, padding: '4px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {item.cleaner_name ? `${item.cleaner_name} · ` : ''}{item.job_address || 'Job'}
                          <span style={{ color: 'var(--muted)' }}> — {item.detail}</span>
                        </span>
                        <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{shortDay(item.scheduled_at)}</span>
                      </div>
                      {g.kind === 'missed_shift' && item.cleaner_id && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                          <select
                            value={outcomeDraft[itemKey(item)] || ''}
                            onChange={(e) => setOutcomeDraft((prev) => ({ ...prev, [itemKey(item)]: e.target.value }))}
                            style={{ width: 'auto', fontSize: 12.5, padding: '4px 8px', marginBottom: 0 }}
                            title={MISSED_SHIFT_OUTCOMES.find((o) => o.key === outcomeDraft[itemKey(item)])?.hint || 'Why this shift is unpaid'}
                          >
                            <option value="">What happened?</option>
                            {MISSED_SHIFT_OUTCOMES.map((o) => (
                              <option key={o.key} value={o.key}>{o.label}</option>
                            ))}
                          </select>
                          <button
                            className="btn-secondary"
                            onClick={() => recordOutcome(item)}
                            disabled={decidingKey === itemKey(item)}
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            title="Record this reason - the shift stays unpaid"
                          >
                            Record
                          </button>
                          <span style={{ color: 'var(--muted)' }}>or</span>
                          <button
                            className="btn-primary"
                            onClick={() => confirmWorked(item)}
                            disabled={decidingKey === itemKey(item)}
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            title="Record the shift as worked - pays everyone on it the booked hours"
                          >
                            They worked it
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!reviewLoading && recorded.length > 0 && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'var(--wf-ash)' }}>
              <strong style={{ fontSize: 13 }}>Missed shifts accounted for ({recorded.length})</strong>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 8px' }}>
                Unpaid, with the reason recorded. Undo one if it was the wrong call - it goes back to the list above.
              </p>
              {recorded.map((item, i) => (
                <div key={`${item.job_id}-${item.cleaner_id || i}`} style={{ fontSize: 12.5, padding: '3px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {item.cleaner_name ? `${item.cleaner_name} · ` : ''}{item.job_address || 'Job'}
                    <span style={{ color: 'var(--muted)' }}> — {item.detail}</span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{shortDay(item.scheduled_at)}</span>
                  <button
                    className="btn-secondary"
                    onClick={() => undoOutcome(item)}
                    disabled={decidingKey === itemKey(item)}
                    style={{ padding: '2px 8px', fontSize: 11.5 }}
                    title="Remove this reason so the shift is back to needing a decision"
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {!reviewLoading && warnings.length > 0 && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'var(--wf-ash)' }}>
              <strong style={{ fontSize: 13 }}>{REVIEW_KINDS.missed_shift.title} ({warnings.length})</strong>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 8px' }}>
                These pay nothing. If any were actually worked, record them on{' '}
                <Link href="/admin/requests" style={{ color: 'var(--brand-link)', fontWeight: 600, textDecoration: 'none' }}>Requests</Link>
                {' '}before closing - afterwards they would arrive as an adjustment on the next run instead.
              </p>
              {warnings.map((item, i) => (
                <div key={`${item.job_id}-${item.cleaner_id || i}`} style={{ fontSize: 12.5, padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{item.cleaner_name ? `${item.cleaner_name} · ` : ''}{item.job_address || 'Job'}</span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{shortDay(item.scheduled_at)}</span>
                </div>
              ))}
            </div>
          )}

          {!reviewLoading && ended && blockers.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: 'var(--wf-verified)', fontWeight: 600 }}>
              <CheckCircle2 size={16} /> Nothing outstanding - the figures below will not change once closed.
            </div>
          )}

          {!reviewLoading && (
            <div style={{ marginTop: 14 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>What will be sent</h3>
              {previewRows.length === 0 ? (
                <p className="empty-state">No completed jobs in this period.</p>
              ) : (
                <SummaryTable rows={previewRows} showAdjustments={pendingAdjustments.length > 0} />
              )}
              {pendingAdjustments.length > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '8px 0 0' }}>
                  Includes {pendingAdjustments.length} adjustment{pendingAdjustments.length === 1 ? '' : 's'} from earlier periods - listed below.
                </p>
              )}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 220, fontSize: 13 }}>
              <span style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>Note for the record (optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Run in QuickBooks 11 Sep"
                maxLength={200}
              />
            </label>
            <button
              className="btn-primary"
              onClick={closePeriod}
              disabled={!canClose}
              title={!ended ? 'This period has not finished yet' : blockers.length > 0 ? 'Settle the items above first' : 'Lock this period and record what was paid'}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Lock size={15} /> {closing ? 'Closing...' : 'Close period'}
            </button>
          </div>
        </div>
      )}

      {/* ---- Pending adjustments ---- */}
      {pendingAdjustments.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Waiting for the next run</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
            Hours that changed on a period already closed. They go out on the next close rather than rewriting the old one.
          </p>
          <AdjustmentList adjustments={pendingAdjustments} />
        </div>
      )}

      {/* ---- Closed periods ---- */}
      <h2 style={{ marginTop: 24, marginBottom: 4 }}>Closed periods</h2>
      {periods.length === 0 ? (
        <p className="empty-state">Nothing closed yet. Once you close a period, what was sent to payroll is kept here.</p>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
          Each one is a record of exactly what went out. Download the CSV for QuickBooks.
        </p>
      )}

      {periods.map((period) => {
        const open = expanded === period.id;
        const p = { start: period.period_start, end: period.period_end };
        const periodLines = lines.filter((l) => l.period_id === period.id);
        const periodAdjustments = adjustments.filter((a) => a.included_in_period_id === period.id);
        const rows = summarise(periodLines, periodAdjustments);
        const totalMinutes = rows.reduce((sum, r) => sum + r.totalMinutes, 0);
        return (
          <div key={period.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setExpanded(open ? null : period.id)}
              aria-expanded={open}
              style={{ width: '100%', border: 'none', borderRadius: 0, background: 'transparent', color: 'inherit', padding: '14px 16px', textAlign: 'left', display: 'block', cursor: 'pointer' }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {displayLabel(p)}
                </span>
                <span style={{ fontFamily: 'var(--wf-data)', fontSize: 15, fontWeight: 600 }}>{formatHours(totalMinutes / 60)}</span>
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginTop: 6, fontWeight: 400 }}>
                Closed {new Date(period.closed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                {period.closer?.full_name ? ` by ${period.closer.full_name}` : ''}
                {' · '}{rows.length} cleaner{rows.length === 1 ? '' : 's'}
                {periodAdjustments.length > 0 ? ` · ${periodAdjustments.length} adjustment${periodAdjustments.length === 1 ? '' : 's'}` : ''}
              </span>
            </button>

            {open && (
              <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px 16px' }}>
                {period.note && <p style={{ fontSize: 13, margin: '0 0 10px' }}><strong>Note:</strong> {period.note}</p>}
                {rows.length === 0 ? (
                  <p className="empty-state">Nothing was paid in this period.</p>
                ) : (
                  <SummaryTable rows={rows} showAdjustments={periodAdjustments.length > 0} />
                )}
                {periodAdjustments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 13 }}>Adjustments included in this run</strong>
                    <AdjustmentList adjustments={periodAdjustments} />
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => csvFor(p, rows)}
                    disabled={rows.length === 0}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Download what was sent to payroll for this period"
                  >
                    <Download size={15} /> Download CSV
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ---- Schedule ---- */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <CalendarClock size={16} />
          <h2 style={{ margin: 0 }}>Pay period schedule</h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
          Match this to how you run payroll in QuickBooks. Changing it only affects periods not yet closed.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>Frequency</span>
            <select value={settingsDraft.frequency} onChange={(e) => setSettingsDraft({ ...settingsDraft, frequency: e.target.value })} style={{ width: 'auto' }}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly (calendar month)</option>
            </select>
          </label>
          {settingsDraft.frequency === 'weekly' && (
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>Week starts on</span>
              <select value={settingsDraft.weekStartsOn} onChange={(e) => setSettingsDraft({ ...settingsDraft, weekStartsOn: Number(e.target.value) })} style={{ width: 'auto' }}>
                {WEEKDAY_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}
              </select>
            </label>
          )}
          <button
            className="btn-secondary"
            onClick={saveSettings}
            disabled={savingSettings || (settingsDraft.frequency === settings.frequency && settingsDraft.weekStartsOn === settings.weekStartsOn)}
          >
            {savingSettings ? 'Saving...' : 'Save schedule'}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>
        Hours are each job&apos;s booked time, split evenly between everyone on it - the same figure as Data Reports and each
        cleaner&apos;s own hours page. Closing tells every cleaner what went out under their name.
      </p>
    </div>
  );
}
