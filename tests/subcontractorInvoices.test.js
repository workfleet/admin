import { describe, it, expect } from 'vitest';
import {
  parseMoney, formatMoney, computeTotals, extrasFromForm, rowFromForm,
  nextInvoiceNumber, invoiceablePeriods, newForm, formFromInvoice, canEdit, attachmentPath,
} from '../lib/subcontractorInvoices';

describe('parseMoney', () => {
  it('reads typed amounts', () => {
    expect(parseMoney('12.5')).toBe(12.5);
    expect(parseMoney('£1,200.00')).toBe(1200);
    expect(parseMoney(' 7 ')).toBe(7);
    expect(parseMoney('-3.456')).toBe(-3.46);
  });
  it('refuses nonsense', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats pounds', () => {
    expect(formatMoney(1234.5)).toBe('£1,234.50');
    expect(formatMoney(-2)).toBe('-£2.00');
  });
});

describe('computeTotals', () => {
  it('matches the database arithmetic', () => {
    // 7h 20m at £14.25 = 104.50
    const t = computeTotals({ minutes: 440, hourlyRate: 14.25, extras: [{ amount: 12.345 }, { amount: 3 }], vatRate: 20 });
    expect(t.hoursAmount).toBe(104.5);
    expect(t.extrasTotal).toBe(15.35);
    expect(t.subtotal).toBe(119.85);
    expect(t.vatAmount).toBe(23.97);
    expect(t.total).toBe(143.82);
  });
  it('splits share minutes fine', () => {
    expect(computeTotals({ minutes: 45, hourlyRate: 13 }).total).toBe(9.75);
  });
});

describe('extrasFromForm', () => {
  it('drops blank rows and needs a description', () => {
    expect(extrasFromForm([{ description: '', amount: '' }, { description: 'Mileage', amount: '4.50' }]))
      .toEqual({ extras: [{ description: 'Mileage', amount: 4.5 }] });
    expect(extrasFromForm([{ description: '', amount: '3' }]).error).toMatch(/description/);
    expect(extrasFromForm([{ description: 'Bleach', amount: 'x' }]).error).toMatch(/Bleach/);
  });
});

describe('rowFromForm', () => {
  const base = { periodId: 'p1', invoiceNumber: ' INV-1 ', hourlyRate: '15', extras: [], chargeVat: false, vatNumber: 'GB123' };
  it('builds the row', () => {
    const { row } = rowFromForm(base, { minutes: 60 });
    expect(row.invoice_number).toBe('INV-1');
    expect(row.hourly_rate).toBe(15);
    expect(row.vat_rate).toBe(0);
    expect(row.vat_number).toBeNull();
  });
  it('needs a VAT number to charge VAT', () => {
    expect(rowFromForm({ ...base, chargeVat: true, vatNumber: '' }, { minutes: 60 }).error).toMatch(/VAT number/);
    expect(rowFromForm({ ...base, chargeVat: true }, { minutes: 60 }).row.vat_rate).toBe(20);
  });
  it('needs a period, number, rate and something to bill', () => {
    expect(rowFromForm({ ...base, periodId: '' }, { minutes: 60 }).error).toMatch(/pay period/);
    expect(rowFromForm({ ...base, invoiceNumber: '' }, { minutes: 60 }).error).toMatch(/number/);
    expect(rowFromForm({ ...base, hourlyRate: '0' }, { minutes: 60 }).error).toMatch(/rate/);
    expect(rowFromForm({ ...base, hourlyRate: '500' }, { minutes: 60 }).error).toMatch(/too high/);
    expect(rowFromForm(base, { minutes: 0 }).error).toMatch(/no hours/);
    expect(rowFromForm({ ...base, extras: [{ description: 'Materials', amount: '10' }] }, { minutes: 0 }).row).toBeTruthy();
  });
});

describe('nextInvoiceNumber', () => {
  it('counts on from the last one', () => {
    expect(nextInvoiceNumber('INV-007')).toBe('INV-008');
    expect(nextInvoiceNumber('41')).toBe('42');
    expect(nextInvoiceNumber('INV-099')).toBe('INV-100');
    expect(nextInvoiceNumber('November')).toBe('');
  });
});

describe('invoiceablePeriods', () => {
  const p1 = { id: 'p1', period_start: '2026-11-06', period_end: '2026-11-13' };
  const p2 = { id: 'p2', period_start: '2026-11-13', period_end: '2026-11-20' };
  it('lists closed periods with hours and no live invoice, newest first', () => {
    const lines = [{ minutes: 120, payroll_periods: p1 }, { minutes: 60, payroll_periods: [p2] }];
    const adjustments = [{ minutes: 30, period: p1 }];
    const list = invoiceablePeriods(lines, adjustments, []);
    expect(list.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(list[1].minutes).toBe(150);
    expect(invoiceablePeriods(lines, adjustments, [{ period_id: 'p2', status: 'submitted' }]).map((p) => p.id)).toEqual(['p1']);
    expect(invoiceablePeriods(lines, adjustments, [{ period_id: 'p2', status: 'withdrawn' }]).map((p) => p.id)).toEqual(['p2', 'p1']);
  });
  it('leaves out a period whose adjustments cancel the hours', () => {
    expect(invoiceablePeriods([{ minutes: 60, payroll_periods: p1 }], [{ minutes: -60, period: p1 }], [])).toEqual([]);
  });
});

describe('forms', () => {
  it('carries details forward from the last invoice', () => {
    const f = newForm({ invoice_number: 'A9', business_name: 'Sparkle Ltd', hourly_rate: 15, vat_rate: 20, vat_number: 'GB1' });
    expect(f.invoiceNumber).toBe('A10');
    expect(f.hourlyRate).toBe('15.00');
    expect(f.chargeVat).toBe(true);
    expect(f.periodId).toBe('');
  });
  it('round-trips a saved invoice', () => {
    const f = formFromInvoice({ period_id: 'p1', invoice_number: 'X1', hourly_rate: '14.5', vat_rate: 0, extras: [{ description: 'Travel', amount: 3 }] });
    expect(f.extras).toEqual([{ description: 'Travel', amount: '3.00' }]);
    expect(rowFromForm(f, { minutes: 60 }).row.extras).toEqual([{ description: 'Travel', amount: 3 }]);
  });
  it('knows what is still editable', () => {
    expect(canEdit({ status: 'queried' })).toBe(true);
    expect(canEdit({ status: 'approved' })).toBe(false);
  });
  it('makes safe storage paths in their folder', () => {
    expect(attachmentPath('u1', 'my invoice (1).pdf', 5)).toBe('u1/5-my_invoice_1_.pdf');
  });
});
