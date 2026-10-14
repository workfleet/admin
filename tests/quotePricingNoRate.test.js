import { describe, it, expect } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { Packer } from 'docx';
import { createElement } from 'react';
import { quoteSections } from '../lib/quoteTemplate';
import QuotePdfDocument from '../lib/quotePdfDocument';
import { buildQuoteDocx } from '../lib/quoteDocxDocument';

// The client is told what each service costs, never the hours and hourly
// rate behind it - a client given the rate starts negotiating the rate.

const contractQuote = {
  id: 'a1b2c3d4', prospect_name: 'Swansea Council', description: 'Daily cleaning of the bus station concourse and washrooms.',
  price: 1200, price_period: 'week', created_at: '2026-10-14T09:00:00Z', valid_until: '2026-11-14T00:00:00Z',
  prospect_email: 'facilities@example.com',
  calculator_input: null, calculator_breakdown: null,
  shift_schedule: {
    siteAddress: 'Swansea Bus Station, Plymouth Street, Swansea SA1 3AR, UK',
    initialWeeks: { min: 4, max: 6 },
    patterns: [
      { id: 'p1', label: 'Daytime cleaning', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '07:00', end: '15:00', operatives: 1, rate: 18, recurrence: 'weekly' },
      { id: 'p2', label: 'Event cover', days: [], start: '18:00', end: '22:00', operatives: 2, rate: 20, recurrence: 'occasional', occasionLabel: 'event' },
    ],
  },
};

const ovenQuote = {
  id: 'e5f6a7b8', prospect_name: 'Mrs Jones', description: 'End of tenancy clean.',
  price: 245, price_period: 'one_off', created_at: '2026-10-14T09:00:00Z',
  calculator_input: { serviceType: 'cleaning', propertyType: 'House', cleanType: 'End of tenancy', condition: 'Average', furnished: 'No', rooms: { bedrooms: 3, bathrooms: 1 }, oven: 'double' },
  calculator_breakdown: { totalHours: 5, chargeableHours: 5, ovenCharge: 65 },
  shift_schedule: null,
};

function pricingText(quote) {
  return JSON.stringify(quoteSections(quote).find((s) => s.title === 'Pricing'));
}

describe('quote pricing', () => {
  it('prices a shift pattern without its hours or rate', () => {
    const text = pricingText(contractQuote);
    expect(text).toContain('/week');
    expect(text).not.toMatch(/per hour|\/hr|hrs|Rate|Hours/);
  });

  it('breaks out an oven clean without hours or rate', () => {
    const text = pricingText(ovenQuote);
    expect(text).toContain('£180.00');
    expect(text).toContain('£65.00');
    expect(text).not.toMatch(/per hour|\/hr|hours|labour/i);
  });

  it('never states the labour hours anywhere in the document', () => {
    const commercial = { ...ovenQuote, calculator_input: { ...ovenQuote.calculator_input, serviceType: 'commercial', commercialFrequency: 'Weekly' }, calculator_breakdown: { totalHours: 5, visitsPerWeek: 1 } };
    for (const quote of [ovenQuote, commercial]) {
      const text = JSON.stringify(quoteSections(quote));
      expect(text).not.toMatch(/Estimated labour|Attendance per visit|5 hours/);
    }
  });

  it('does not list the free standard inclusions, only extras chosen', () => {
    const text = JSON.stringify(quoteSections(ovenQuote));
    expect(text).not.toMatch(/Included as standard|Fridge clean|Washing machine/);
    expect(text).toContain('Also included: Double oven clean.');
  });

  it('renders both documents', async () => {
    for (const quote of [contractQuote, ovenQuote]) {
      expect((await renderToBuffer(createElement(QuotePdfDocument, { quote }))).length).toBeGreaterThan(1000);
      expect((await Packer.toBuffer(buildQuoteDocx(quote))).length).toBeGreaterThan(1000);
    }
  });
});
