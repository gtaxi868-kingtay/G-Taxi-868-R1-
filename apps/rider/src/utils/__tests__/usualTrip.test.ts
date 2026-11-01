import { usualTrip, type PastRide } from '../usualTrip';

// Local times; the function uses the device's local hour (Trinidad).
const at = (h: number, day = 1) => new Date(2026, 9, day, h, 15).toISOString();
const ride = (h: number, lat: number, lng: number, address: string, status = 'completed', day = 1): PastRide =>
    ({ created_at: at(h, day), status, dropoff_lat: lat, dropoff_lng: lng, dropoff_address: address });

const WORK = [10.6549, -61.5019, 'Republic Bank, Park St'] as const;
const GYM = [10.6720, -61.5170, 'Fitness Centre'] as const;

describe('usualTrip', () => {
    it('no history, no chip', () => {
        expect(usualTrip([], new Date(2026, 9, 20, 8))).toBeNull();
    });

    it('one trip is not a habit', () => {
        expect(usualTrip([ride(8, ...WORK)], new Date(2026, 9, 20, 8))).toBeNull();
    });

    it('the place you go most at this time of day', () => {
        const rides = [ride(8, ...WORK, 'completed', 1), ride(8, ...WORK, 'completed', 2), ride(9, ...WORK, 'completed', 3), ride(18, ...GYM, 'completed', 1), ride(18, ...GYM, 'completed', 2)];
        expect(usualTrip(rides, new Date(2026, 9, 20, 7, 40))).toMatchObject({ address: 'Republic Bank, Park St', count: 3 });
        expect(usualTrip(rides, new Date(2026, 9, 20, 18, 5))).toMatchObject({ address: 'Fitness Centre', count: 2 });
    });

    it('groups drop-offs a few metres apart as the same place', () => {
        const rides = [ride(8, 10.65491, -61.50192, 'Park St', 'completed', 1), ride(8, 10.65495, -61.50189, 'Park Street', 'completed', 2)];
        expect(usualTrip(rides, new Date(2026, 9, 20, 8))?.count).toBe(2);
    });

    it('ignores cancelled rides and rides with no drop-off', () => {
        const rides = [ride(8, ...WORK, 'cancelled', 1), ride(8, ...WORK, 'cancelled', 2), { created_at: at(8), status: 'completed', dropoff_lat: null, dropoff_lng: null, dropoff_address: null } as any];
        expect(usualTrip(rides, new Date(2026, 9, 20, 8))).toBeNull();
    });

    it('another time of day has no habit yet -> no chip', () => {
        const rides = [ride(8, ...WORK, 'completed', 1), ride(8, ...WORK, 'completed', 2)];
        expect(usualTrip(rides, new Date(2026, 9, 20, 23))).toBeNull();
    });
});
