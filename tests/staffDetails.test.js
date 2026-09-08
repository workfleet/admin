import { describe, expect, it } from 'vitest';
import { detailsToForm, formToDetails, missingEssentials, STAFF_DETAIL_FIELDS } from '../lib/staffDetails.js';

describe('detailsToForm', () => {
  it('gives every field a string, even with no row', () => {
    const form = detailsToForm(null);
    for (const f of STAFF_DETAIL_FIELDS) expect(form[f.key]).toBe('');
  });

  it('carries values through as strings', () => {
    const form = detailsToForm({ phone: '07700 900123', date_of_birth: '1990-04-02', start_date: null });
    expect(form.phone).toBe('07700 900123');
    expect(form.date_of_birth).toBe('1990-04-02');
    expect(form.start_date).toBe('');
  });
});

describe('formToDetails', () => {
  it('trims, nulls blanks and normalises the NI number', () => {
    const row = formToDetails({ phone: ' 07700 900123 ', address: '   ', ni_number: 'qq 12 34 56 c' });
    expect(row.phone).toBe('07700 900123');
    expect(row.address).toBeNull();
    expect(row.ni_number).toBe('QQ123456C');
    expect(row.emergency_contact_name).toBeNull();
  });

  it('only returns the keys asked for, so a partial form cannot blank the rest', () => {
    const row = formToDetails({ phone: '1', start_date: '' }, ['phone']);
    expect(row).toEqual({ phone: '1' });
  });
});

describe('missingEssentials', () => {
  it('lists what the office cannot do without', () => {
    expect(missingEssentials(null)).toEqual(['phone', 'address', 'emergency contact']);
    expect(missingEssentials({ phone: '1', address: 'x', emergency_contact_phone: '2' })).toEqual([]);
    expect(missingEssentials({ phone: '1', address: 'x' })).toEqual(['emergency contact']);
  });
});
