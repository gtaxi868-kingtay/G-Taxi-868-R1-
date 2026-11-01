import { BUSINESS_TYPES, businessTypeFor } from '../businessTypes';

describe('businessTypeFor', () => {
  it('prefers the owner choice over the old category', () => {
    expect(businessTypeFor({ business_type: 'auto', category: 'grocery' })?.key).toBe('auto');
  });

  it('reads the old categories', () => {
    expect(businessTypeFor({ category: 'creole' })?.key).toBe('food');
    expect(businessTypeFor({ category: 'barber' })?.key).toBe('beauty');
    expect(businessTypeFor({ category: 'hotel' })?.key).toBe('stays');
    expect(businessTypeFor({ category: 'pharmacy' })?.key).toBe('health');
  });

  it('asks when the category says nothing', () => {
    expect(businessTypeFor({ category: 'local' })).toBeNull();
    expect(businessTypeFor(null)).toBeNull();
  });
});

describe('BUSINESS_TYPES', () => {
  it('shapes the app around the business', () => {
    const of = (k: string) => BUSINESS_TYPES.find((t) => t.key === k)!;
    expect(of('food').catalog?.label).toBe('Menu');
    expect(of('beauty').work.label).toBe('Bookings');
    expect(of('auto').work.label).toBe('Jobs');
    expect(of('stays').work.route).toBe('PropertyManagement');
    expect(of('stays').catalog).toBeNull();
  });

  it('has a unique key for every type', () => {
    expect(new Set(BUSINESS_TYPES.map((t) => t.key)).size).toBe(BUSINESS_TYPES.length);
  });
});
