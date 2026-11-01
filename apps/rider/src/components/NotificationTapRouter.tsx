import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '@gtaxi/core';
import { navigationRef } from '../navigation/navigationRef';
import { routeForNotification, routeForRideStatus, type NotificationRoute } from '../navigation/notificationRoute';

// Sends a tapped push notification to the right screen. Mounted only while the
// rider is signed in (inside AppNavigator), so the screens it targets exist.
//
// useLastNotificationResponse covers both cases:
//   * app closed: the tap that launched the app (cold start)
//   * app open or in the background: each new tap
// Each response is handled once (by notification id), then cleared, so a
// remount never replays an old tap.
export function NotificationTapRouter() {
    const response = Notifications.useLastNotificationResponse();
    const handled = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        const id = response.notification.request.identifier;
        if (handled.current.has(id)) return;
        handled.current.add(id);

        const data = (response.notification.request.content.data || {}) as Record<string, unknown>;
        let cancelled = false;

        (async () => {
            let route: NotificationRoute = routeForNotification(data);
            // A ride push may be stale: route on the ride's status right now.
            const rideId = typeof data.ride_id === 'string' ? data.ride_id : null;
            if (rideId && !/wallet|topup|deposit|refund|payout|withdraw/i.test(String(data.type || ''))) {
                const { data: ride } = await supabase.from('rides').select('status').eq('id', rideId).maybeSingle();
                route = routeForRideStatus((ride as any)?.status, rideId) || route;
            }
            if (cancelled) return;
            go(route);
            Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
        })().catch((err) => console.warn('[NotificationTapRouter] could not route tap:', err));

        return () => { cancelled = true; };
    }, [response]);

    return null;
}

// The navigator may still be mounting on a cold start; wait for it briefly.
function go(route: NotificationRoute, tries = 0) {
    if (!navigationRef.isReady()) {
        if (tries < 20) setTimeout(() => go(route, tries + 1), 150);
        return;
    }
    // Already on this ride (e.g. the active-ride restorer got there first).
    const current = navigationRef.getCurrentRoute();
    if (current?.name === route.name && (current?.params as any)?.rideId && (current?.params as any)?.rideId === route.params?.rideId) return;
    navigationRef.navigate(route.name, route.params);
}
