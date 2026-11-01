// Where a tapped push notification should take the rider.
//
// Before 2026-10-25 the tap listener only logged, so every notification tap
// (including "SOS recorded") just opened the app wherever it last was.
//
// The edge functions do not share one payload vocabulary (accept_ride sends
// ride ids, grocery sends {type:'order', order_id}, travel sends
// {type:'travel_booking_confirmed', package_id}, trigger_emergency sends
// {type:'emergency_acknowledged', ride_id}, ...). So this routes on the ids a
// payload carries first and uses `type` only to refine. Anything unknown goes
// to the Notifications list: a tap must always land somewhere sensible and
// must never throw.
export type NotificationRoute = { name: string; params?: Record<string, any> };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const MONEY = /wallet|topup|deposit|refund|payout|withdraw/;
const CANCELLED = /cancel/;
const FINISHED = /complete|receipt|rating|payment_confirmed/;

export function routeForNotification(data: Record<string, unknown> | null | undefined): NotificationRoute {
    const d = data || {};
    const type = (str(d.type) || str(d.event_type) || '').toLowerCase();

    // Money first: refunds can carry ride/package ids but belong in the wallet.
    if (MONEY.test(type)) return { name: 'Home', params: { screen: 'WalletTab' } };

    const rideId = str(d.ride_id);
    if (rideId) {
        if (CANCELLED.test(type)) return { name: 'Home', params: { screen: 'Activity' } };
        if (FINISHED.test(type)) return { name: 'Receipt', params: { rideId } };
        // Live ride updates and SOS acknowledgements open the ride itself.
        return { name: 'ActiveRide', params: { rideId } };
    }

    const orderId = str(d.order_id);
    if (orderId) return { name: 'GroceryOrderStatus', params: { orderId } };

    if (type.startsWith('escape') || type.startsWith('travel')) {
        const packageId = str(d.package_id) || str(d.escape_package_id);
        return { name: 'EscapeStorefront', params: packageId ? { packageId } : undefined };
    }

    if (type === 'progression_unlock') return { name: 'Home', params: { screen: 'Services' } };

    return { name: 'Notifications' };
}

// A ride notification can be stale (tapped an hour later). When the ride's
// CURRENT status is known, route on that instead of the payload's label, so a
// finished ride opens its receipt rather than a dead live-ride screen.
export function routeForRideStatus(status: string | null | undefined, rideId: string): NotificationRoute | null {
    switch (status) {
        case 'assigned':
        case 'arrived':
        case 'in_progress':
            return { name: 'ActiveRide', params: { rideId } };
        case 'completed':
        case 'payment_confirmed':
        case 'closed':
            return { name: 'Receipt', params: { rideId } };
        case 'cancelled':
        case 'canceled':
            return { name: 'Home', params: { screen: 'Activity' } };
        case 'searching':
        case 'requested':
            // Still looking for a driver: the active-ride restoration handler
            // owns that screen; just bring the rider to the map.
            return { name: 'Home', params: { screen: 'Map' } };
        default:
            return null; // unknown: keep the payload-based route
    }
}
