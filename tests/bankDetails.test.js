import { describe, expect, it } from 'vitest';
import { BANK_DETAIL_FIELDS, emptyBankForm, formToBankDetails, formatSortCode, maskAccountNumber } from '../lib/bankDetails.js';

describe('emptyBankForm', () => {
  it('gives every field a string so the inputs start controlled', () => {
    const form = emptyBankForm();
    for (const f of BANK_DETAIL_FIELDS) expect(form[f.key]).toBe('');
  });
});

describe('formToBankDetails', () => {
  it('stores the digits only, however the person typed them', () => {
    const { row, error } = formToBankDetails({ account_holder_name: ' J Kidwell ', sort_code: '12-34-56', account_number: '1234 5678' });
    expect(error).toBeUndefined();
    expect(row).toEqual({ account_holder_name: 'J Kidwell', sort_code: '123456', account_number: '12345678' });
  });

  it('refuses a sort code or account number of the wrong length', () => {
    expect(formToBankDetails({ account_holder_name: 'J', sort_code: '12345', account_number: '12345678' }).error).toMatch(/6 digits/);
    expect(formToBankDetails({ account_holder_name: 'J', sort_code: '123456', account_number: '1234567' }).error).toMatch(/8 digits/);
    expect(formToBankDetails({ account_holder_name: 'J', sort_code: '123456', account_number: '123456789' }).error).toMatch(/8 digits/);
  });

  it('needs a name on the account', () => {
    expect(formToBankDetails({ account_holder_name: '   ', sort_code: '123456', account_number: '12345678' }).error).toMatch(/name/i);
  });

  it('never returns a row alongside an error', () => {
    const result = formToBankDetails({});
    expect(result.error).toBeTruthy();
    expect(result.row).toBeUndefined();
  });
});

describe('formatSortCode', () => {
  it('prints six digits the way a card does', () => {
    expect(formatSortCode('123456')).toBe('12-34-56');
  });

  it('leaves anything else alone rather than inventing a shape', () => {
    expect(formatSortCode('1234')).toBe('1234');
    expect(formatSortCode(null)).toBe('');
  });
});

describe('maskAccountNumber', () => {
  it('shows only the last four digits', () => {
    expect(maskAccountNumber('12345678')).toBe('••••5678');
  });

  it('shows nothing for nothing', () => {
    expect(maskAccountNumber(null)).toBe('');
    expect(maskAccountNumber('')).toBe('');
  });
});
