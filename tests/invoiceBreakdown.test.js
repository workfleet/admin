import { describe, it, expect } from 'vitest';
import { buildInvoiceBreakdown, refreshesOf, propertyLineText, refreshLineText, breakdownText, formatHours, quickbooksRows, QUICKBOOKS_COLUMNS } from '../lib/invoiceBreakdown';
import { toCSV } from '../lib/csv';

const properties = [
  { id: 'olive', address: '20 Olive Street, Swansea, SA1 1AA' },
  { id: 'comm', address: 'Commercial Road, Swansea' },
  { id: 'idle', address: '1 Quiet Lane' },
];

const job = (over) => ({ id: Math.random().toString(36), property_id: 'olive', status: 'completed', duration_minutes: 60, room_refreshes: [], job_assignments: [{}], ...over });

describe('buildInvoiceBreakdown', () => {
  it('lists each property with its visit dates and charges booked hours at the rate', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [
        job({ scheduled_at: '2026-07-16T09:00:00Z', duration_minutes: 120 }),
        job({ scheduled_at: '2026-07-02T09:00:00Z', duration_minutes: 120 }),
        job({ property_id: 'comm', scheduled_at: '2026-07-05T09:00:00Z' }),
      ],
    });
    expect(b.lines.map((l) => l.name)).toEqual(['20 Olive Street', 'Commercial Road']);
    expect(b.lines[0].visits.map((v) => v.date)).toEqual(['2 July 2026', '16 July 2026']);
    expect(b.lines[0].amount).toBe(96);
    expect(b.lines[1].amount).toBe(24);
    expect(b.total).toBe(120);
    expect(propertyLineText(b.lines[0])).toBe('20 Olive Street - 2 cleaning visits: 2 July 2026, 16 July 2026');
  });

  it('takes refresh time off the clean and lists the room on its own line', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [job({ scheduled_at: '2026-07-02T09:00:00Z', duration_minutes: 120, room_refreshes: [{ room: 'Room 1', minutes: 60 }] })],
    });
    expect(b.lines[0].minutes).toBe(60);
    expect(b.refreshes).toHaveLength(1);
    expect(refreshLineText(b.refreshes[0])).toBe('Room refresh - Room 1, 20 Olive Street - 2 July 2026');
    expect(b.refreshTotal).toBe(24);
    expect(b.total).toBe(48);
  });

  it('a visit that was only a refresh is not counted as a cleaning visit', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [job({ scheduled_at: '2026-07-12T09:00:00Z', room_refreshes: [{ room: 'Room 4', minutes: 90 }] })],
    });
    expect(b.lines).toHaveLength(0);
    // Never charges more than was booked.
    expect(b.refreshes[0].minutes).toBe(60);
  });

  it('leaves out missed and not-yet-done visits and says so', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [
        job({ scheduled_at: '2026-07-02T09:00:00Z', status: 'missed' }),
        job({ scheduled_at: '2026-07-30T09:00:00Z', status: 'scheduled' }),
        job({ scheduled_at: '2026-07-03T09:00:00Z', job_assignments: [{}, {}] }),
      ],
    });
    expect(b.lines[0].visits).toHaveLength(1);
    expect(b.warnings.join(' ')).toMatch(/1 missed visit isn't charged/);
    expect(b.warnings.join(' ')).toMatch(/hasn't happened yet/);
    // Two cleaners: still the booked hour, charged once, no warning.
    expect(b.lines[0].amount).toBe(24);
    expect(b.warnings).toHaveLength(2);
  });

  it('dates visits in UK time', () => {
    const b = buildInvoiceBreakdown({ properties, rate: 24, jobs: [job({ scheduled_at: '2026-07-01T23:30:00Z' })] });
    expect(b.lines[0].visits[0].date).toBe('2 July 2026');
  });
});

describe('refreshesOf', () => {
  it('drops blank rooms and zero minutes', () => {
    expect(refreshesOf({ room_refreshes: [{ room: ' ', minutes: 30 }, { room: 'Room 2', minutes: 0 }, { room: 'Room 3', minutes: '45' }] }))
      .toEqual([{ room: 'Room 3', minutes: 45 }]);
    expect(refreshesOf({})).toEqual([]);
  });
});

describe('quickbooksRows', () => {
  it('makes one import row per invoice line, due 30 days after the invoice date', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [
        job({ scheduled_at: '2026-10-02T09:00:00Z', duration_minutes: 150, room_refreshes: [{ room: 'Room 1', minutes: 60 }] }),
        job({ property_id: 'comm', scheduled_at: '2026-10-05T09:00:00Z' }),
      ],
    });
    const rows = quickbooksRows(b, { invoiceNo: '1042', customer: 'TKR Management', invoiceDate: '2026-11-01', item: 'Cleaning', rate: 24 });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      invoiceNo: '1042', customer: 'TKR Management', invoiceDate: '01/11/2026', dueDate: '01/12/2026', terms: 'Net 30',
      item: 'Cleaning', description: '20 Olive Street - 1 cleaning visit: 2 October 2026', quantity: '1.50', rate: '24.00', amount: '36.00',
    });
    // Like QuickBooks' sample: later lines of the same invoice leave the customer and dates blank.
    expect(rows[1].customer).toBeUndefined();
    expect(rows[1].invoiceNo).toBe('1042');
    expect(rows[2]).toMatchObject({ serviceDate: '02/10/2026', description: 'Room refresh - Room 1, 20 Olive Street - 2 October 2026', quantity: '1.00', amount: '24.00' });
    expect(toCSV(QUICKBOOKS_COLUMNS, rows).split('\n')[0])
      .toBe('*InvoiceNo,*Customer,*InvoiceDate,*DueDate,Terms,Location,Memo,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,*ItemAmount,Service Date,Note to customer');
  });
});

describe('text', () => {
  it('formats hours', () => {
    expect(formatHours(60)).toBe('1 hr');
    expect(formatHours(90)).toBe('1.5 hrs');
    expect(formatHours(45)).toBe('0.75 hrs');
  });

  it('lays out the whole month like the client asked', () => {
    const b = buildInvoiceBreakdown({
      properties,
      rate: 24,
      jobs: [job({ scheduled_at: '2026-07-02T09:00:00Z', duration_minutes: 120, room_refreshes: [{ room: 'Room 1', minutes: 60 }] })],
    });
    const text = breakdownText(b, 'July 2026', 24);
    expect(text).toContain('HMO Cleaning - July 2026');
    expect(text).toContain('  * 2 July 2026');
    expect(text).toContain('Room Refreshes');
    expect(text).toContain('Total: £48.00');
  });
});
