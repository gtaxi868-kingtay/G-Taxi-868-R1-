import { describe, it, expect } from 'vitest';
import { pickupOutcome } from '../AirportFlights';

const r = (status: string, metadata: Record<string, any> = {}, cancellation_reason: string | null = null) => ({ status, metadata, cancellation_reason });
describe('pickupOutcome', () => {
    it('puts the problems first', () => {
        expect(pickupOutcome(r('cancelled', {}, 'Airport guest no-show: driver waited'))).toBe('Guest no-show');
        expect(pickupOutcome(r('scheduled', { flight_problem: 'cancelled' }))).toMatch(/hotel must act/);
        expect(pickupOutcome(r('scheduled', { flight_problem: 'stale', flight_tracked: true }))).toBe('Flight data stale');
    });
    it('shows whether the pickup followed the flight', () => {
        expect(pickupOutcome(r('scheduled', { flight_tracked: true, pickup_moved_from: '2026-10-27T04:00:00Z' }))).toBe('Booked · moved with flight');
        expect(pickupOutcome(r('scheduled', { flight_tracked: false }))).toBe('Booked · not tracked');
        expect(pickupOutcome(r('completed'))).toBe('Completed');
    });
});
