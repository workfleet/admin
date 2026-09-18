import { describe, it, expect } from 'vitest';
import { flattenPrivate, isSubcontractor, privateOf } from '../lib/profilePrivate';

// Whether someone is a subcontractor decides whether their rota shows a
// holiday balance at all, so the default has to be the safe one: anyone the
// database has no opinion about is an employee, exactly as before 0104.

describe('privateOf', () => {
  it('reads the embed whether it comes back as an object or a one-element array', () => {
    expect(privateOf({ profile_private: { employment_type: 'subcontractor' } }).employment_type).toBe('subcontractor');
    expect(privateOf({ profile_private: [{ employment_type: 'subcontractor' }] }).employment_type).toBe('subcontractor');
    expect(privateOf({ profile_private: [] })).toBeNull();
    expect(privateOf({})).toBeNull();
  });
});

describe('flattenPrivate', () => {
  it('lifts the private fields onto the profile with employee as the default', () => {
    const flat = flattenPrivate({ id: 'a', full_name: 'A', profile_private: { holiday_adjustment_hours: 26, deactivated_at: null } });
    expect(flat).toEqual({ id: 'a', full_name: 'A', holiday_adjustment_hours: 26, deactivated_at: null, employment_type: 'employee' });
  });

  it('keeps a subcontractor marking', () => {
    const flat = flattenPrivate({ id: 'a', profile_private: { employment_type: 'subcontractor' } });
    expect(flat.employment_type).toBe('subcontractor');
    expect(flat.holiday_adjustment_hours).toBe(0);
  });

  it('copes with a profile that has no private row yet', () => {
    expect(flattenPrivate({ id: 'a' }).employment_type).toBe('employee');
    expect(flattenPrivate(null)).toBeNull();
  });
});

describe('isSubcontractor', () => {
  it('is true only for the explicit value', () => {
    expect(isSubcontractor('subcontractor')).toBe(true);
    expect(isSubcontractor('employee')).toBe(false);
    // A database without 0104, or a lookup that failed, hands back nothing -
    // that must not switch anyone's holiday off.
    expect(isSubcontractor(undefined)).toBe(false);
    expect(isSubcontractor(null)).toBe(false);
  });
});
