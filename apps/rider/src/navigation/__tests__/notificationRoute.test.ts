import { routeForNotification } from '../notificationRoute';

// Payload shapes taken from what the edge functions actually send
// (grep of supabase/functions, 2026-10-25).
describe('routeForNotification', () => {
    it('SOS acknowledged goes straight to the live ride', () => {
        expect(routeForNotification({ type: 'emergency_acknowledged', ride_id: 'r1' }))
            .toEqual({ name: 'ActiveRide', params: { rideId: 'r1' } });
    });

    it('a live ride update opens the ride', () => {
        expect(routeForNotification({ type: 'ride_accepted', ride_id: 'r1' }))
            .toEqual({ name: 'ActiveRide', params: { rideId: 'r1' } });
        expect(routeForNotification({ ride_id: 'r2' }))
            .toEqual({ name: 'ActiveRide', params: { rideId: 'r2' } });
    });

    it('a finished ride opens its receipt', () => {
        expect(routeForNotification({ type: 'ride_completed', ride_id: 'r1' }))
            .toEqual({ name: 'Receipt', params: { rideId: 'r1' } });
    });

    it('a cancelled ride opens your trips', () => {
        expect(routeForNotification({ type: 'ride_cancelled', ride_id: 'r1' }))
            .toEqual({ name: 'Home', params: { screen: 'Activity' } });
        expect(routeForNotification({ type: 'cancelled', ride_id: 'r1' }))
            .toEqual({ name: 'Home', params: { screen: 'Activity' } });
    });

    it('an order opens its status page', () => {
        expect(routeForNotification({ type: 'order', order_id: 'o1', merchant_id: 'm1' }))
            .toEqual({ name: 'GroceryOrderStatus', params: { orderId: 'o1' } });
    });

    it('money events open the wallet tab', () => {
        for (const type of ['wallet_topup', 'cash_deposit_confirmed', 'refund_completed', 'wipay_refund', 'travel_package_refund']) {
            expect(routeForNotification({ type })).toEqual({ name: 'Home', params: { screen: 'WalletTab' } });
        }
    });

    it('escape and travel open G-Escape', () => {
        expect(routeForNotification({ type: 'travel_booking_confirmed', booking_id: 'b1', package_id: 'p1' }))
            .toEqual({ name: 'EscapeStorefront', params: { packageId: 'p1' } });
        expect(routeForNotification({ type: 'escape_pool_update', escape_package_id: 'p2' }))
            .toEqual({ name: 'EscapeStorefront', params: { packageId: 'p2' } });
    });

    it('a new unlock opens Services', () => {
        expect(routeForNotification({ type: 'progression_unlock' })).toEqual({ name: 'Home', params: { screen: 'Services' } });
    });

    it('anything unknown or empty opens Notifications, never crashes', () => {
        expect(routeForNotification({ type: 'daily_suggestion' })).toEqual({ name: 'Notifications' });
        expect(routeForNotification({})).toEqual({ name: 'Notifications' });
        expect(routeForNotification(undefined)).toEqual({ name: 'Notifications' });
        expect(routeForNotification({ ride_id: 42 } as any)).toEqual({ name: 'Notifications' });
    });
});

import { routeForRideStatus } from '../notificationRoute';

describe('routeForRideStatus', () => {
    it('routes on the ride as it is now, not as it was when the push was sent', () => {
        expect(routeForRideStatus('in_progress', 'r1')).toEqual({ name: 'ActiveRide', params: { rideId: 'r1' } });
        expect(routeForRideStatus('assigned', 'r1')).toEqual({ name: 'ActiveRide', params: { rideId: 'r1' } });
        expect(routeForRideStatus('completed', 'r1')).toEqual({ name: 'Receipt', params: { rideId: 'r1' } });
        expect(routeForRideStatus('closed', 'r1')).toEqual({ name: 'Receipt', params: { rideId: 'r1' } });
        expect(routeForRideStatus('cancelled', 'r1')).toEqual({ name: 'Home', params: { screen: 'Activity' } });
        expect(routeForRideStatus('searching', 'r1')).toEqual({ name: 'Home', params: { screen: 'Map' } });
    });

    it('returns null when the status is unknown so the payload route is used', () => {
        expect(routeForRideStatus(undefined, 'r1')).toBeNull();
        expect(routeForRideStatus('weird', 'r1')).toBeNull();
    });
});
