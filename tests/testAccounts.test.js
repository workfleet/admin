import { describe, it, expect } from 'vitest';
import { TEST_ACCOUNT_IDS, isTestAccount, withoutTestAccounts } from '../lib/testAccounts';

const testId = TEST_ACCOUNT_IDS[0];

describe('withoutTestAccounts', () => {
  it('drops rows whose id is a test account and keeps the rest in order', () => {
    const rows = [{ id: 'a' }, { id: testId }, { id: 'b' }];
    expect(withoutTestAccounts(rows)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('can match on another key, for rows keyed by cleaner_id', () => {
    const rows = [{ cleaner_id: testId }, { cleaner_id: 'c' }];
    expect(withoutTestAccounts(rows, 'cleaner_id')).toEqual([{ cleaner_id: 'c' }]);
  });

  it('treats a missing result set as empty, like (rows || []) did', () => {
    expect(withoutTestAccounts(null)).toEqual([]);
    expect(withoutTestAccounts(undefined)).toEqual([]);
  });

  it('leaves rows with no id alone', () => {
    expect(withoutTestAccounts([{ full_name: 'x' }, null])).toEqual([{ full_name: 'x' }, null]);
  });
});

describe('isTestAccount', () => {
  it('knows the listed ids and nothing else', () => {
    expect(isTestAccount(testId)).toBe(true);
    expect(isTestAccount('not-a-test-account')).toBe(false);
    expect(isTestAccount(undefined)).toBe(false);
  });
});
