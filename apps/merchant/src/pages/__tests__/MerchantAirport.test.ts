import { describe, it, expect } from 'vitest';
import { pickupLabel } from '../MerchantAirport';

const p = (status: string, metadata: Record<string, any> = {}, cancellation_reason: string | null = null) => ({ id: 'r', status, scheduled_for: null, total_fare_cents: 1, payment_method: 'cash', ride_pin: '1', metadata, cancellation_reason });

describe('pickupLabel', () => {
    it('tells the hotel whether the pickup follows the flight', () => {
        expect(pickupLabel(p('scheduled', { flight_tracked: true }))).toBe('Booked · following the flight');
        expect(pickupLabel(p('scheduled', { flight_tracked: false }))).toBe('Booked · not tracked');
    });
    it('puts a cancelled or diverted flight first, so the hotel calls the guest', () => {
        expect(pickupLabel(p('scheduled', { flight_problem: 'cancelled' }))).toMatch(/call your guest/);
        expect(pickupLabel(p('scheduled', { flight_problem: 'diverted' }))).toMatch(/diverted/);
    });
    it('follows the ride after the driver is found', () => {
        expect(pickupLabel(p('assigned'))).toBe('Driver on the way');
        expect(pickupLabel(p('completed'))).toBe('Done');
    });
    it('says when flight data is out of date, and when a guest never came', () => {
        expect(pickupLabel(p('scheduled', { flight_problem: 'stale' }))).toMatch(/out of date/);
        expect(pickupLabel(p('cancelled', {}, 'Airport guest no-show: driver waited'))).toBe("Guest didn't come (driver waited)");
        expect(pickupLabel(p('cancelled', {}, 'Rider cancelled'))).toBe('Cancelled');
    });
});
