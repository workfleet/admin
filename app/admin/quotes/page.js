'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import {
  ROOM_TYPES, CONDITION_OPTIONS, CLEAN_TYPE_OPTIONS, FURNISHED_OPTIONS,
  PROPERTY_TYPES, PROPERTY_TYPE_DEFAULTS, ADDON_TYPES, OVEN_OPTIONS,
  SERVICE_TYPES, GARDEN_SIZE_OPTIONS, GARDEN_ADDON_TYPES, COMMERCIAL_FREQUENCY_OPTIONS,
  calculateQuote, defaultQuoteDescription,
} from '../../../lib/quoteCalculator';
import {
  WEEKDAYS, RECURRENCE_OPTIONS, EMPTY_SHIFT_PATTERN, EMPTY_SHIFT_SCHEDULE,
  shiftHours, summariseShiftSchedule, shiftScheduleDescription,
} from '../../../lib/shiftSchedule';
import BackButton from '../../components/BackButton';

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
const STATUS_BADGE_CLASS = { draft: 'scheduled', sent: 'in_progress', accepted: 'completed', declined: 'missed', expired: 'missed' };

const EMPTY_ROOMS = Object.fromEntries(ROOM_TYPES.map((r) => [r.key, 0]));
const EMPTY_ADDONS = Object.fromEntries(
  ADDON_TYPES.flatMap((a) => [[a.key, false], [`${a.key}Qty`, 1]])
);
const EMPTY_GARDEN_ADDONS = Object.fromEntries(
  GARDEN_ADDON_TYPES.flatMap((a) => [[a.key, false], [`${a.key}Qty`, 1]])
);

const EMPTY_CALC_INPUT = {
  serviceType: 'cleaning',
  propertyAddress: '',
  propertyType: PROPERTY_TYPES[0],
  condition: 'Standard',
  cleanType: CLEAN_TYPE_OPTIONS[0].value,
  furnished: 'No',
  travelMiles: 0,
  rooms: EMPTY_ROOMS,
  addons: EMPTY_ADDONS,
  oven: 'none',
  gardenSize: GARDEN_SIZE_OPTIONS[0].value,
  estimatedHours: 2,
  commercialFrequency: COMMERCIAL_FREQUENCY_OPTIONS[0].value,
};

function formatPrice(price) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(price);
}

const PRICING_FIELDS = [
  { key: 'cleaner_hourly_pay', label: 'Cleaner hourly pay (£)', step: '0.01' },
  { key: 'gardener_hourly_pay', label: 'Gardener hourly pay (£)', step: '0.01' },
  { key: 'holiday_allowance_pct', label: 'Holiday allowance (%, e.g. 0.1207)', step: '0.0001' },
  { key: 'employer_ni_pct', label: 'Employer NI allowance (%, e.g. 0.08)', step: '0.0001' },
  { key: 'pension_pct', label: 'Pension allowance (%, e.g. 0.03)', step: '0.0001' },
  { key: 'materials_pct', label: 'Materials allowance (%, e.g. 0.05)', step: '0.0001' },
  { key: 'admin_pct', label: 'Admin allowance (%, e.g. 0.05)', step: '0.0001' },
  { key: 'travel_cost_per_mile', label: 'Travel cost per mile (£)', step: '0.01' },
  { key: 'target_margin_pct', label: 'Target profit margin (%, e.g. 0.275)', step: '0.0001' },
  { key: 'minimum_job_price', label: 'Minimum job price (£)', step: '0.01' },
  { key: 'minimum_callout_hours', label: 'Minimum call-out hours', step: '0.5' },
];

// One row of the shift-pattern editor. Every figure it shows is derived
// live from the fields beside it, so the admin can see 3 hours x 5 days
// become GBP 525 a week before the quote is written.
function ShiftPatternRow({ pattern, index, onChange, onRemove }) {
  const set = (patch) => onChange({ ...pattern, ...patch });
  const occasional = pattern.recurrence === 'occasional';
  const hours = shiftHours(pattern.start, pattern.end);
  const shifts = occasional ? 1 : (pattern.days || []).length;
  const operatives = Number(pattern.operatives) || 0;
  const rate = Number(pattern.rate) || 0;
  const totalHours = hours * shifts * operatives;

  const toggleDay = (key) => {
    const days = pattern.days || [];
    set({ days: days.includes(key) ? days.filter((d) => d !== key) : [...days, key] });
  };

  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Shift name</label>
          <input
            value={pattern.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder={index === 0 ? 'e.g. Early-morning cleaning' : 'e.g. Saturday daytime cleaning'}
          />
        </div>
        <div className="field">
          <label className="field-label">How often</label>
          <select value={pattern.recurrence} onChange={(e) => set({ recurrence: e.target.value })}>
            {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {occasional ? (
        <div className="field">
          <label className="field-label">Charged per...</label>
          <input
            value={pattern.occasionLabel}
            onChange={(e) => set({ occasionLabel: e.target.value })}
            placeholder="e.g. bank holiday"
          />
        </div>
      ) : (
        <>
          <label className="field-label" style={{ display: 'block' }}>Days</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {WEEKDAYS.map((d) => {
              const on = (pattern.days || []).includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  className={on ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => toggleDay(d.key)}
                  style={{ padding: '4px 10px', fontSize: 13 }}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="field-row">
        <div className="field">
          <label className="field-label">Start</label>
          <input type="time" value={pattern.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label">End</label>
          <input type="time" value={pattern.end} onChange={(e) => set({ end: e.target.value })} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Operatives per shift</label>
          <input
            type="number" min="1" step="1"
            value={pattern.operatives}
            onChange={(e) => set({ operatives: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">Charge rate (£/hour)</label>
          <input
            type="number" min="0" step="0.01"
            value={pattern.rate}
            onChange={(e) => set({ rate: e.target.value })}
            placeholder="e.g. 24.27"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label">Note for the client (optional)</label>
        <input
          value={pattern.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="e.g. The premium rate reflects the 2:00am start."
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {hours > 0 && shifts > 0 && operatives > 0
            ? `${hours}h × ${shifts} ${occasional ? 'shift' : 'day' + (shifts === 1 ? '' : 's')}`
              + (operatives > 1 ? ` × ${operatives} operatives` : '')
              + ` = ${totalHours}h ${occasional ? 'per occurrence' : 'per week'}`
              + (rate > 0 ? ` · ${formatPrice(totalHours * rate)}` : '')
            : 'Fill in the days, times and rate to price this shift.'}
        </span>
        <button type="button" className="btn-secondary" onClick={onRemove} style={{ padding: '2px 10px', fontSize: 12 }}>
          Remove
        </button>
      </div>
    </div>
  );
}

export default function AdminQuotes() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [role, setRole] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [pricingSettings, setPricingSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | decided | all

  const [showPricingSettings, setShowPricingSettings] = useState(false);
  const [pricingForm, setPricingForm] = useState(null);
  const [savingPricing, setSavingPricing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [recipientType, setRecipientType] = useState('client'); // client | prospect
  const [clientId, setClientId] = useState('');
  const [prospectName, setProspectName] = useState('');
  const [prospectEmail, setProspectEmail] = useState('');
  const [prospectPhone, setProspectPhone] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const [useCalculator, setUseCalculator] = useState(false);
  const [calcInput, setCalcInput] = useState(EMPTY_CALC_INPUT);

  const [useShiftSchedule, setUseShiftSchedule] = useState(false);
  const [shiftSchedule, setShiftSchedule] = useState(EMPTY_SHIFT_SCHEDULE);

  const [expandedQuoteId, setExpandedQuoteId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const [{ data: ownProfile }, { data: quotesData }, { data: clientsData }, { data: pricingData }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', session.user.id).single(),
      supabase
        .from('quotes')
        .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, status, valid_until, notes, created_at, calculator_breakdown, shift_schedule, clients(name)')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('pricing_settings').select('*').single(),
    ]);

    setRole(ownProfile?.role || null);
    setQuotes(quotesData || []);
    setClients(clientsData || []);
    setPricingSettings(pricingData || null);
    setLoading(false);
  };

  const startEditPricing = () => {
    setPricingForm({ ...pricingSettings });
    setShowPricingSettings(true);
  };

  const savePricingSettings = async (e) => {
    e.preventDefault();
    setSavingPricing(true);

    const payload = Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, parseFloat(pricingForm[f.key])]));

    const { data } = await supabase
      .from('pricing_settings').update(payload).eq('id', pricingSettings.id)
      .select('*').single();

    setSavingPricing(false);
    if (data) setPricingSettings(data);
    setShowPricingSettings(false);
  };

  const resetForm = () => {
    setRecipientType('client');
    setClientId('');
    setProspectName('');
    setProspectEmail('');
    setProspectPhone('');
    setDescription('');
    setPrice('');
    setValidUntil('');
    setNotes('');
    setUseCalculator(false);
    setCalcInput(EMPTY_CALC_INPUT);
    setUseShiftSchedule(false);
    setShiftSchedule(EMPTY_SHIFT_SCHEDULE);
  };

  const breakdown = useMemo(() => {
    if (!useCalculator || !pricingSettings) return null;
    return calculateQuote(calcInput, pricingSettings);
  }, [useCalculator, calcInput, pricingSettings]);

  const scheduleSummary = useMemo(
    () => (useShiftSchedule ? summariseShiftSchedule(shiftSchedule) : null),
    [useShiftSchedule, shiftSchedule]
  );

  const addShiftPattern = () => {
    setShiftSchedule((prev) => ({
      ...prev,
      patterns: [...prev.patterns, { ...EMPTY_SHIFT_PATTERN, id: `p${Date.now()}` }],
    }));
  };

  const updateShiftPattern = (index, pattern) => {
    setShiftSchedule((prev) => ({
      ...prev,
      patterns: prev.patterns.map((p, i) => (i === index ? pattern : p)),
    }));
  };

  const removeShiftPattern = (index) => {
    setShiftSchedule((prev) => ({ ...prev, patterns: prev.patterns.filter((_, i) => i !== index) }));
  };

  const setInitialWeeks = (key, value) => {
    setShiftSchedule((prev) => ({ ...prev, initialWeeks: { ...prev.initialWeeks, [key]: value } }));
  };

  const useWeeklyChargeAsPrice = () => {
    if (scheduleSummary) setPrice(String(scheduleSummary.weeklyCharge));
  };

  const useScheduleDescription = () => {
    const address = shiftSchedule.siteAddress || calcInput.propertyAddress;
    if (scheduleSummary) setDescription(shiftScheduleDescription(scheduleSummary, address));
  };

  const applyPropertyType = (propertyType) => {
    const defaults = PROPERTY_TYPE_DEFAULTS[propertyType] || {};
    setCalcInput((prev) => ({
      ...prev,
      propertyType,
      rooms: { ...prev.rooms, bedroom: defaults.bedroom ?? prev.rooms.bedroom, bathroom: defaults.bathroom ?? prev.rooms.bathroom },
    }));
  };

  // Addons reset on switch since the two catalogs (ADDON_TYPES vs
  // GARDEN_ADDON_TYPES) don't share keys - leaving stale cleaning addons
  // ticked while showing garden addon checkboxes would silently keep
  // charging for minutes that aren't shown anywhere in the form.
  const setServiceType = (serviceType) => {
    setCalcInput((prev) => ({
      ...prev,
      serviceType,
      addons: serviceType === 'gardening' ? EMPTY_GARDEN_ADDONS : EMPTY_ADDONS,
    }));
  };

  const useCalculatedPrice = () => {
    if (breakdown) setPrice(String(breakdown.finalPrice));
  };

  const useGeneratedDescription = () => {
    if (breakdown) setDescription(defaultQuoteDescription(calcInput, breakdown, calcInput.propertyAddress));
  };

  const createQuote = async (e) => {
    e.preventDefault();
    if (!description.trim() || !price) return;
    if (recipientType === 'client' && !clientId) return;
    if (recipientType === 'prospect' && !prospectName.trim()) return;
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();

    const payload = {
      client_id: recipientType === 'client' ? clientId : null,
      prospect_name: recipientType === 'prospect' ? prospectName.trim() : null,
      prospect_email: recipientType === 'prospect' ? (prospectEmail.trim() || null) : null,
      prospect_phone: recipientType === 'prospect' ? (prospectPhone.trim() || null) : null,
      description: description.trim(),
      price: parseFloat(price),
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      created_by: session.user.id,
      calculator_input: useCalculator ? calcInput : null,
      calculator_breakdown: useCalculator ? breakdown : null,
      // Only stored once it prices something - a half-filled pattern
      // would put an empty schedule section into the quote document.
      shift_schedule: scheduleSummary ? shiftSchedule : null,
    };

    const { data } = await supabase
      .from('quotes')
      .insert(payload)
      .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, status, valid_until, notes, created_at, calculator_breakdown, shift_schedule, clients(name)')
      .single();

    setCreating(false);
    if (data) setQuotes((prev) => [data, ...prev]);
    resetForm();
    setShowForm(false);
  };

  const changeStatus = async (quote, status) => {
    const decided_at = status === 'accepted' || status === 'declined' ? new Date().toISOString() : quote.decided_at || null;

    const { data } = await supabase
      .from('quotes').update({ status, decided_at }).eq('id', quote.id)
      .select('id, status, decided_at').single();

    if (data) {
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: data.status, decided_at: data.decided_at } : q)));
    }
  };

  const downloadQuoteFile = async (quote, kind) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/quotes/${quote.id}/${kind}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return;

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : `quote.${kind}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteQuote = async (quoteId) => {
    if (!(await confirm('Delete this quote?', { danger: true }))) return;
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId);
    if (error) { toast.error('Could not delete the quote.'); return; }
    setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
    toast.success('Quote deleted.');
  };

  const filteredQuotes = useMemo(() => {
    if (filter === 'decided') return quotes.filter((q) => q.status !== 'draft' && q.status !== 'sent');
    if (filter === 'all') return quotes;
    return quotes.filter((q) => q.status === 'draft' || q.status === 'sent');
  }, [quotes, filter]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Quotes</h1>
          <p className="page-subtitle">Priced proposals for clients and prospects</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/admin/quotes/history" className="btn-secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            History
          </Link>
          {role === 'admin' && (
            <button className="btn-secondary" onClick={() => (showPricingSettings ? setShowPricingSettings(false) : startEditPricing())} title="Change the rates the quote calculator works from">
              {showPricingSettings ? 'Cancel' : 'Pricing Settings'}
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowForm((s) => !s)} title="Write a new quote for a client">
            {showForm ? 'Cancel' : '+ New Quote'}
          </button>
        </div>
      </div>

      {showPricingSettings && pricingForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>Pricing Settings</h2>
            <button className="job-form-close" type="button" onClick={() => setShowPricingSettings(false)}>×</button>
          </div>
          <form onSubmit={savePricingSettings}>
            <div className="job-form-body">
              {PRICING_FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label className="field-label">{f.label}</label>
                  <input
                    type="number"
                    step={f.step}
                    value={pricingForm[f.key]}
                    onChange={(e) => setPricingForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    required
                  />
                </div>
              ))}
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPricingSettings(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={savingPricing}>{savingPricing ? 'Saving...' : 'Save Settings'}</button>
            </div>
          </form>
        </div>
      )}

      {showForm && (
        <div className="card job-form-card">
          <div className="job-form-header">
            <h2>New Quote</h2>
            <button className="job-form-close" type="button" onClick={() => setShowForm(false)}>×</button>
          </div>
          <form onSubmit={createQuote}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Who's this for?</label>
                <select value={recipientType} onChange={(e) => setRecipientType(e.target.value)}>
                  <option value="client">An existing client</option>
                  <option value="prospect">A new prospect</option>
                </select>
              </div>

              {recipientType === 'client' ? (
                <div className="field">
                  <label className="field-label">Client</label>
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                    <option value="">Select...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label">Prospect name</label>
                    <input value={prospectName} onChange={(e) => setProspectName(e.target.value)} placeholder="e.g. New Build Co" required />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label className="field-label">Email (optional)</label>
                      <input type="email" value={prospectEmail} onChange={(e) => setProspectEmail(e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="field-label">Phone (optional)</label>
                      <input value={prospectPhone} onChange={(e) => setProspectPhone(e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={useCalculator}
                  onChange={(e) => setUseCalculator(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Calculate price automatically
              </label>

              {useCalculator && (
                <div style={{ border: '1px solid var(--hairline)', borderRadius: 12, padding: 14, marginTop: 4 }}>
                  <div className="field">
                    <label className="field-label">Service type</label>
                    <select value={calcInput.serviceType} onChange={(e) => setServiceType(e.target.value)}>
                      {SERVICE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label">Property address</label>
                    <AddressAutocomplete
                      value={calcInput.propertyAddress}
                      onChange={(text) => setCalcInput((c) => ({ ...c, propertyAddress: text }))}
                      onSelect={({ address }) => setCalcInput((c) => ({ ...c, propertyAddress: address }))}
                      placeholder="Start typing an address..."
                    />
                  </div>

                  {calcInput.serviceType === 'gardening' && (
                    <div className="field-row">
                      <div className="field">
                        <label className="field-label">Garden size</label>
                        <select value={calcInput.gardenSize} onChange={(e) => setCalcInput((c) => ({ ...c, gardenSize: e.target.value }))}>
                          {GARDEN_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label className="field-label">Condition</label>
                        <select value={calcInput.condition} onChange={(e) => setCalcInput((c) => ({ ...c, condition: e.target.value }))}>
                          {CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {calcInput.serviceType === 'commercial' && (
                    <>
                      <div className="field-row">
                        <div className="field">
                          <label className="field-label">Estimated hours per visit</label>
                          <input
                            type="number" min="0" step="0.25"
                            value={calcInput.estimatedHours}
                            onChange={(e) => setCalcInput((c) => ({ ...c, estimatedHours: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label className="field-label">Frequency</label>
                          <select value={calcInput.commercialFrequency} onChange={(e) => setCalcInput((c) => ({ ...c, commercialFrequency: e.target.value }))}>
                            {COMMERCIAL_FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="field">
                        <label className="field-label">Condition</label>
                        <select value={calcInput.condition} onChange={(e) => setCalcInput((c) => ({ ...c, condition: e.target.value }))}>
                          {CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {calcInput.serviceType === 'cleaning' && (
                    <>
                      <div className="field-row">
                        <div className="field">
                          <label className="field-label">Property type</label>
                          <select value={calcInput.propertyType} onChange={(e) => applyPropertyType(e.target.value)}>
                            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label className="field-label">Condition</label>
                          <select value={calcInput.condition} onChange={(e) => setCalcInput((c) => ({ ...c, condition: e.target.value }))}>
                            {CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label className="field-label">Clean type</label>
                          <select value={calcInput.cleanType} onChange={(e) => setCalcInput((c) => ({ ...c, cleanType: e.target.value }))}>
                            {CLEAN_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label className="field-label">Furnished?</label>
                          <select value={calcInput.furnished} onChange={(e) => setCalcInput((c) => ({ ...c, furnished: e.target.value }))}>
                            {FURNISHED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="field">
                    <label className="field-label">Travel miles (0 if not charging)</label>
                    <input
                      type="number" min="0" step="0.1"
                      value={calcInput.travelMiles}
                      onChange={(e) => setCalcInput((c) => ({ ...c, travelMiles: e.target.value }))}
                    />
                  </div>

                  {calcInput.serviceType === 'cleaning' && (
                    <>
                      <label className="field-label" style={{ marginTop: 10, display: 'block' }}>Room counts</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
                        {ROOM_TYPES.map((r) => (
                          <div className="field" key={r.key} style={{ marginBottom: 0 }}>
                            <label className="field-label" style={{ fontSize: 12 }}>{r.label}</label>
                            <input
                              type="number" min="0"
                              value={calcInput.rooms[r.key]}
                              onChange={(e) => setCalcInput((c) => ({ ...c, rooms: { ...c.rooms, [r.key]: e.target.value } }))}
                            />
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {calcInput.serviceType !== 'commercial' && (
                  <>
                  <label className="field-label" style={{ display: 'block' }}>Extras</label>
                  {(calcInput.serviceType === 'gardening' ? GARDEN_ADDON_TYPES : ADDON_TYPES).map((a) => (
                    <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        checked={calcInput.addons[a.key]}
                        onChange={(e) => setCalcInput((c) => ({ ...c, addons: { ...c.addons, [a.key]: e.target.checked } }))}
                        style={{ width: 'auto' }}
                      />
                      <span style={{ fontSize: 14, flex: 1 }}>{a.label}</span>
                      {calcInput.addons[a.key] && (
                        <input
                          type="number" min="1"
                          value={calcInput.addons[`${a.key}Qty`]}
                          onChange={(e) => setCalcInput((c) => ({ ...c, addons: { ...c.addons, [`${a.key}Qty`]: e.target.value } }))}
                          style={{ width: 60 }}
                        />
                      )}
                    </div>
                  ))}
                  </>
                  )}

                  {calcInput.serviceType === 'cleaning' && (
                    <div className="field" style={{ marginTop: 10 }}>
                      <label className="field-label">Oven clean</label>
                      <select value={calcInput.oven} onChange={(e) => setCalcInput((c) => ({ ...c, oven: e.target.value }))}>
                        {Object.entries(OVEN_OPTIONS).map(([key, o]) => (
                          <option key={key} value={key}>{o.label}{o.price ? ` (£${o.price})` : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {breakdown && (
                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12, marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <strong style={{ fontSize: 22 }}>{formatPrice(breakdown.finalPrice)}</strong>
                        <span className="badge scheduled">{breakdown.pricePosition}</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
                        {breakdown.totalHours}h estimated · {breakdown.chargeableHours}h chargeable
                        {' · '}{formatPrice(breakdown.hourlyEquivalent)}/hr equivalent
                      </p>
                      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                        Profit {formatPrice(breakdown.profit)} ({(breakdown.marginPct * 100).toFixed(1)}%) — {breakdown.marginWarning}
                      </p>
                      {breakdown.monthlyContractValue > 0 && (
                        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                          {breakdown.visitsPerWeek}x/week — {formatPrice(breakdown.weeklyContractValue)}/week, approx. {formatPrice(breakdown.monthlyContractValue)}/month
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn-secondary" onClick={useCalculatedPrice} title="Copy the calculated price into the quote">Use this price</button>
                        <button type="button" className="btn-secondary" onClick={useGeneratedDescription} title="Copy the suggested wording into the quote description">Use this description</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={useShiftSchedule}
                  onChange={(e) => setUseShiftSchedule(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                Set out a shift pattern (staffed contracts)
              </label>

              {useShiftSchedule && (
                <div style={{ border: '1px solid var(--hairline)', borderRadius: 12, padding: 14, marginTop: 4 }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
                    Each shift is priced on its own hours and rate, so premium hours (early mornings, weekends)
                    can be charged differently from daytime cover. The document sets them out shift by shift.
                  </p>

                  <div className="field">
                    <label className="field-label">Site address</label>
                    <AddressAutocomplete
                      value={shiftSchedule.siteAddress || ''}
                      onChange={(text) => setShiftSchedule((prev) => ({ ...prev, siteAddress: text }))}
                      onSelect={({ address }) => setShiftSchedule((prev) => ({ ...prev, siteAddress: address }))}
                      placeholder="Start typing an address..."
                    />
                  </div>

                  {shiftSchedule.patterns.map((pattern, i) => (
                    <ShiftPatternRow
                      key={pattern.id || i}
                      pattern={pattern}
                      index={i}
                      onChange={(next) => updateShiftPattern(i, next)}
                      onRemove={() => removeShiftPattern(i)}
                    />
                  ))}

                  <button type="button" className="btn-secondary" onClick={addShiftPattern}>
                    + Add shift pattern
                  </button>

                  <div className="field-row" style={{ marginTop: 14 }}>
                    <div className="field">
                      <label className="field-label">Initial contract period from (weeks)</label>
                      <input
                        type="number" min="0" step="1"
                        value={shiftSchedule.initialWeeks.min}
                        onChange={(e) => setInitialWeeks('min', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">...to (weeks)</label>
                      <input
                        type="number" min="0" step="1"
                        value={shiftSchedule.initialWeeks.max}
                        onChange={(e) => setInitialWeeks('max', e.target.value)}
                      />
                    </div>
                  </div>

                  {scheduleSummary && (
                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <strong style={{ fontSize: 22 }}>{formatPrice(scheduleSummary.weeklyCharge)}/week</strong>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{scheduleSummary.weeklyHours} hours per week</span>
                      </div>
                      {scheduleSummary.contractValues.length > 0 && (
                        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
                          {scheduleSummary.contractValues
                            .map((c) => `${c.weeks} weeks ${formatPrice(c.value)}`)
                            .join(' · ')}
                          {' · approx. '}{formatPrice(scheduleSummary.monthlyCharge)}/month
                        </p>
                      )}
                      {scheduleSummary.occasional.map((p, i) => (
                        <p key={i} style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                          {p.label || 'Ad-hoc cover'}: {formatPrice(p.chargePerOccasion)} per {p.occasionLabel || 'occurrence'}
                        </p>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn-secondary" onClick={useWeeklyChargeAsPrice} title="Copy the weekly charge into the quote price">Use weekly charge as price</button>
                        <button type="button" className="btn-secondary" onClick={useScheduleDescription} title="Copy a summary of the shift pattern into the quote description">Use this description</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="field" style={{ marginTop: 12 }}>
                <label className="field-label">Description of work</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Weekly office clean, 2 cleaners, 2 hours"
                  required
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Price (£)</label>
                  <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="field-label">Valid until (optional)</label>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Notes (optional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes, not shown to the client" />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Adding...' : 'Add Quote'}</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>Open</button>
        <button className={filter === 'decided' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('decided')}>Decided</button>
        <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
      </div>

      {filteredQuotes.length === 0 && <p className="empty-state">Nothing here.</p>}

      <div className="job-list">
        {filteredQuotes.map((quote) => {
          const isExpanded = expandedQuoteId === quote.id;
          const b = quote.calculator_breakdown;
          const sched = summariseShiftSchedule(quote.shift_schedule);
          return (
            <div key={quote.id} className="card job-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2>
                    {quote.client_id ? (
                      <Link href={`/admin/clients/${quote.client_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {quote.clients?.name || 'Unknown client'}
                      </Link>
                    ) : (
                      quote.prospect_name
                    )}
                    {!quote.client_id && <span className="badge scheduled" style={{ marginLeft: 8, verticalAlign: 'middle' }}>prospect</span>}
                  </h2>
                  <p className="job-time">{quote.description}</p>
                  <p className="job-time">
                    {(quote.prospect_email || quote.prospect_phone) && (
                      <>{[quote.prospect_email, quote.prospect_phone].filter(Boolean).join(' · ')}{' · '}</>
                    )}
                    {quote.valid_until && <>Valid until {new Date(quote.valid_until).toLocaleDateString()}{' · '}</>}
                    Quoted {new Date(quote.created_at).toLocaleDateString()}
                  </p>
                  {sched && (
                    <p className="job-time">
                      {sched.weeklyHours} hrs/week across {sched.weekly.length} shift pattern{sched.weekly.length === 1 ? '' : 's'}
                      {' · '}{formatPrice(sched.weeklyCharge)}/week
                      {sched.contractValues.length > 0 && (
                        <> · {sched.contractValues.map((c) => `${c.weeks}wk ${formatPrice(c.value)}`).join(' · ')}</>
                      )}
                    </p>
                  )}
                  {quote.notes && <p className="job-time" style={{ fontStyle: 'italic' }}>{quote.notes}</p>}
                  {b && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setExpandedQuoteId(isExpanded ? null : quote.id)}
                      style={{ padding: '2px 10px', fontSize: 12, marginTop: 4 }}
                    >
                      {isExpanded ? 'Hide breakdown' : 'Why this price?'}
                    </button>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong style={{ fontSize: 18 }}>{formatPrice(quote.price)}</strong>
                </div>
              </div>

              {isExpanded && b && (
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12, marginTop: 10, fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
                  <div>{b.totalHours}h estimated · {b.chargeableHours}h chargeable · {formatPrice(b.hourlyEquivalent)}/hr equivalent · {b.pricePosition}</div>
                  <div>Profit {formatPrice(b.profit)} ({(b.marginPct * 100).toFixed(1)}%) — {b.marginWarning}</div>
                  <div>Labour {formatPrice(b.cleanerWageCost)} · Holiday {formatPrice(b.holidayCost)} · NI {formatPrice(b.niCost)} · Pension {formatPrice(b.pensionCost)}</div>
                  <div>Materials {formatPrice(b.materialsCost)} · Admin {formatPrice(b.adminCost)} · Travel {formatPrice(b.travelCost)}</div>
                  {b.ovenCharge > 0 && <div>Oven charge {formatPrice(b.ovenCharge)} (cleaner pay {formatPrice(b.ovenCleanerPay)})</div>}
                  {b.monthlyContractValue > 0 && (
                    <div>{b.visitsPerWeek}x/week — {formatPrice(b.weeklyContractValue)}/week, approx. {formatPrice(b.monthlyContractValue)}/month</div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
                <span className={`badge ${STATUS_BADGE_CLASS[quote.status]}`}>{STATUS_LABELS[quote.status]}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={quote.status}
                    onChange={(e) => changeStatus(quote, e.target.value)}
                    style={{ width: 'auto', margin: 0 }}
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button className="btn-secondary" onClick={() => downloadQuoteFile(quote, 'pdf')} title="Download this quote as a PDF to send to the client">PDF</button>
                  <button className="btn-secondary" onClick={() => downloadQuoteFile(quote, 'docx')} title="Download this quote as a Word document you can edit first">Word</button>
                  <button className="btn-secondary" onClick={() => deleteQuote(quote.id)} title="Delete this quote">Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
