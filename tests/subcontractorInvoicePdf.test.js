import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import SubcontractorInvoicePdf from '../lib/subcontractorInvoicePdf.js';

// The PDF is what goes to the accountant; rendering it for real is the only
// check that catches a crash in the layout.
const invoice = {
  id: 'i1', subcontractor_name: 'Sam Taylor', invoice_number: 'INV-004',
  business_name: 'Sparkle Cleaning', business_address: '1 Long Road\nSwansea',
  period_start: '2026-11-06', period_end: '2026-11-13',
  minutes: 450, hourly_rate: 15, hours_amount: 112.5,
  extras: [{ description: 'Mileage', amount: 6.3 }], extras_total: 6.3,
  vat_rate: 20, vat_number: 'GB123456789', subtotal: 118.8, vat_amount: 23.76, total: 142.56,
  notes: 'Thanks', status: 'paid', submitted_at: '2026-11-14T09:00:00Z', paid_at: '2026-11-18T09:00:00Z',
};

describe('SubcontractorInvoicePdf', () => {
  it('renders with VAT, extras and shifts', async () => {
    const buffer = await renderToBuffer(createElement(SubcontractorInvoicePdf, {
      invoice,
      shifts: [{ date: '2026-11-07', label: '12 High St', minutes: 225 }, { date: '2026-11-08', label: 'Correction: 12 High St', minutes: -15 }],
    }));
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('renders a bare invoice with no VAT or extras', async () => {
    const buffer = await renderToBuffer(createElement(SubcontractorInvoicePdf, {
      invoice: { ...invoice, vat_rate: 0, vat_number: null, extras: [], business_name: null, business_address: null, notes: null, paid_at: null, status: 'submitted' },
    }));
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
