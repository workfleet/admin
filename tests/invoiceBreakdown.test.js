import { describe, it, expect } from 'vitest';
import { buildInvoiceBreakdown, refreshesOf, propertyLineText, refreshLineText, breakdownText, formatHours, quickbooksRows, QUICKBOOKS_COLUMNS, invoicingDay, invoicePeriod, shiftPricingFor } from '../lib/invoiceBreakdown';
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

describe('invoicingDay', () => {
  it('is the 30th, or the working day before', () => {
    expect(invoicingDay(2026, 9)).toEqual([2026, 9, 30]); // Fri 30 Oct
    expect(invoicingDay(2026, 4)).toEqual([2026, 4, 29]); // Sat 30 May
    expect(invoicingDay(2027, 1)).toEqual([2027, 1, 26]); // Feb: Sun 28th, so Fri 26th
    expect(invoicingDay(2027, 7)).toEqual([2027, 7, 27]); // Mon 30 Aug is the bank holiday
    expect(invoicingDay(2029, 2)).toEqual([2029, 2, 29]); // Fri 30 Mar is Good Friday
  });
});

describe('invoicePeriod', () => {
  it('runs from last invoicing day to this one, UK midnight to UK midnight', () => {
    const p = invoicePeriod('2026-10');
    expect(p.start).toBe('2026-09-29T23:00:00.000Z'); // 30 Sep, BST
    expect(p.end).toBe('2026-10-30T00:00:00.000Z'); // 30 Oct, GMT
    expect(p.invoiceDay).toBe('2026-10-30');
    expect(p.covers).toBe('30 September 2026 to 29 October 2026');
    expect(invoicePeriod('2027-01').start).toBe('2026-12-30T00:00:00.000Z');
  });
});

describe('quickbooksRows', () => {
  it('makes one import row per invoice line, due on receipt', () => {
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
      invoiceNo: '1042', customer: 'TKR Management', invoiceDate: '01/11/2026', dueDate: '01/11/2026', terms: 'Due on receipt',
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

describe('Swansea Bus Station, priced per shift', () => {
  const pricing = shiftPricingFor('Swansea Bus Station');
  const bus = [{ id: 'bus', address: 'Swansea City Bus Station, Plymouth Street' }];
  const at = (iso, over) => job({ property_id: 'bus', scheduled_at: iso, ...over });

  it('rebuilds the September invoice from its shifts', () => {
    const jobs = [];
    // 13 weekday 2pm shifts (BST, so 13:00Z) from Mon 7 Sept.
    const weekdays = [7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23];
    for (const d of weekdays) jobs.push(at(`2026-09-${String(d).padStart(2, '0')}T13:00:00Z`, { duration_minutes: 240 }));
    // 12 nights, lengths and crew sizes varying - each is still one shift.
    for (let i = 0; i < 12; i += 1) jobs.push(at(`2026-09-${String(7 + i).padStart(2, '0')}T22:00:00Z`, { duration_minutes: i % 2 ? 720 : 180, job_assignments: [{}, {}, {}] }));
    jobs.push(at('2026-09-12T09:00:00Z', { duration_minutes: 480 }), at('2026-09-19T09:00:00Z', { duration_minutes: 480 }));
    jobs.push(at('2026-09-13T09:00:00Z', { duration_minutes: 360 }), at('2026-09-20T09:15:00Z', { duration_minutes: 360 }));
    const b = buildInvoiceBreakdown({ properties: bus, jobs, rate: 0, pricing });
    expect(b.lines.map((l) => [propertyLineText(l), l.quantity, l.unitPrice, l.amount])).toEqual([
      ['Day shift cleaning - 2pm - 6pm', 13, 97.08, 1262.04],
      ['Early hours shift cleaning - 11pm - 5am', 12, 105, 1260],
      ['Saturday shift cleaning - 10am - 6pm', 2, 194.16, 388.32],
      ['Sunday shift cleaning - 10am - 4pm', 2, 145.62, 291.24],
    ]);
    expect(b.total).toBe(3201.6);
    expect(b.warnings).toEqual([]);

    const rows = quickbooksRows(b, { invoiceNo: '1050', customer: 'Swansea Bus Station', invoiceDate: '2026-09-29', item: pricing.item, rate: 0 });
    expect(rows.map((r) => [r.quantity, r.rate, r.amount])).toEqual([['13', '97.08', '1262.04'], ['12', '105.00', '1260.00'], ['2', '194.16', '388.32'], ['2', '145.62', '291.24']]);
    expect(rows[0].item).toBe('Commercial Cleans');
    expect(pricing.customer).toBe('Swansea Bus Station - Swansea Council');
  });

  it('counts a shift starting after midnight as a night, and flags odd ones', () => {
    const b = buildInvoiceBreakdown({
      properties: bus,
      pricing,
      jobs: [
        at('2026-10-16T01:00:00Z'), // Fri 2am
        at('2026-10-23T13:00:00Z'), // Fri 2pm
        at('2026-10-23T13:00:00Z'), // the same again
        at('2026-09-22T07:00:00Z'), // Tue 8am
      ],
    });
    expect(b.lines.map((l) => [l.key, l.quantity])).toEqual([['day', 3], ['night', 1]]);
    expect(b.warnings.join(' ')).toMatch(/22 September 2026: a visit starting at 8:00 is charged as a day shift/);
    expect(b.warnings.join(' ')).toMatch(/23 October 2026: two day shifts that day/);
  });

  it('leaves hourly clients alone', () => {
    expect(shiftPricingFor('TKR Management')).toBeNull();
  });
});
