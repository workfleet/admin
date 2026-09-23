import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import ContractPdfDocument from '../lib/contractPdfDocument.js';
import { buildContractText } from '../lib/staffContract.js';

// Onboarding files this PDF into the new starter's documents as the last
// step of a form they only get to fill in once, so a crash in here is
// expensive and silent - the submission saves, the contract doesn't appear.
// Rendering it for real is the only check that catches that.
function submissionFor(overrides = {}) {
  return {
    full_name: 'Sam Taylor',
    signed_name: 'Sam Taylor',
    signed_at: '2026-09-23T10:15:00.000Z',
    signed_ip: '203.0.113.7',
    policies_agreed: true,
    contract_text: buildContractText(
      { full_name: 'Sam Taylor', address: '1 Long Road, Swansea' },
      { job_title: 'Cleaning Operative', hourly_rate: 13, pay_frequency: 'weekly', start_date: '2026-10-05' },
    ),
    ...overrides,
  };
}

describe('ContractPdfDocument', () => {
  it('renders a real PDF from a signed submission', async () => {
    const buffer = await renderToBuffer(createElement(ContractPdfDocument, { submission: submissionFor() }));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(5000);
  }, 20000);

  it('renders without the optional signing metadata', async () => {
    const buffer = await renderToBuffer(
      createElement(ContractPdfDocument, { submission: submissionFor({ signed_ip: null, signed_at: null, policies_agreed: false }) })
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  }, 20000);
});
