import { describe, it, expect } from 'vitest';
import { nextSteps, rideStatus } from '../MerchantOverview';

const biz = { name: 'H', category: 'hotel', address: null, has_location: true, status: 'active', is_active: true, area: null, billing: 'cash', credit_limit_cents: null, current_debt_cents: null };

describe('business overview', () => {
    it('lists only what still blocks real rides', () => {
        expect(nextSteps({ business: biz, touch_points: [{ name: 'Lobby', pickup_spot: null, tag_ready: true, live: true, status: 'live' }] })).toEqual([]);
        const steps = nextSteps({ business: { ...biz, status: 'pending', is_active: false, has_location: false }, touch_points: [] });
        expect(steps).toHaveLength(3);
        expect(steps[0]).toMatch(/reviewing/);
        expect(nextSteps({ business: biz, touch_points: [{ name: 'Lobby', pickup_spot: null, tag_ready: false, live: false, status: null }] })[0]).toMatch(/tag has not been programmed/);
    });
    it('ride states in plain words', () => {
        expect(rideStatus('scheduled')).toBe('Booked');
        expect(rideStatus('arrived')).toBe('Driver on the way');
        expect(rideStatus('payment_confirmed')).toBe('Done');
    });
});
