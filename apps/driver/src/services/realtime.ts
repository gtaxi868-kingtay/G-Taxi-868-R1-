import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@gtaxi/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';

export interface RideOffer {
    id: string; // offer id
    ride_id: string;
    distance_meters: number;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    created_at: string;
    expires_at: string;
}

export interface DeliveryOffer {
    id: string;
    order_id: string;
    driver_id: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    expires_at: string;
    created_at: string;
    // Enriched from push payload / local fetch
    merchant_name?: string;
    delivery_fee_cents?: number;
    // What the driver is actually paid (server fills it from
    // calculate_delivery_driver_payout when the offer is created).
    driver_payout_cents?: number | null;
    total_cents?: number;
    merchant_address?: string;
    rider_address?: string;
}

// Offers reach the driver only through these channels (push is not set up),
// so a silent drop or a slow start meant missed jobs. Each channel now:
//  - reads any offer already pending once it is connected (an offer sent
//    while the app was closed, or in the first seconds after connecting,
//    used to be lost),
//  - reconnects after an error or timeout,
//  - re-reads when the app comes back to the foreground.
function useOfferChannel<T extends { id: string; status: string; expires_at: string }>(
    table: 'ride_offers' | 'delivery_offers',
    driverId: string | undefined,
) {
    const [offer, setOffer] = useState<T | null>(null);

    useEffect(() => {
        if (!driverId) return;
        let mounted = true;
        let channel: RealtimeChannel | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        const readPending = async () => {
            const { data } = await supabase
                .from(table)
                .select('*')
                .eq('driver_id', driverId)
                .eq('status', 'pending')
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1);
            if (!mounted) return;
            const latest = (data?.[0] as T | undefined) ?? null;
            setOffer(current => latest ?? (current && new Date(current.expires_at) > new Date() ? current : null));
        };

        const connect = () => {
            if (!mounted) return;
            channel = supabase
                .channel(`driver-${table}:${driverId}:${Date.now()}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table, filter: `driver_id=eq.${driverId}` },
                    (payload) => {
                        const updated = payload.new as T;
                        if (updated.status === 'pending') setOffer(updated);
                        else setOffer(current => (current?.id === updated.id ? null : current));
                    },
                )
                .subscribe((status) => {
                    if (!mounted) return;
                    if (status === 'SUBSCRIBED') {
                        readPending();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        if (channel) supabase.removeChannel(channel);
                        channel = null;
                        clearTimeout(retryTimer);
                        retryTimer = setTimeout(connect, 3000);
                    }
                });
        };

        connect();
        const appSub = AppState.addEventListener('change', (next) => {
            if (next === 'active') readPending();
        });
        // A trip push is a second, independent signal: when one arrives (or
        // is tapped) read the offer straight away instead of waiting for the
        // live channel, which can be asleep while another app is in front.
        const isOfferPush = (data: any) => !!data && (data.type === 'RIDE_OFFER' || data.type === 'DELIVERY_OFFER' || data.ride_id || data.order_id);
        const pushIn = Notifications.addNotificationReceivedListener((n) => {
            if (isOfferPush(n.request.content.data)) readPending();
        });
        const pushTap = Notifications.addNotificationResponseReceivedListener((r) => {
            if (isOfferPush(r.notification.request.content.data)) readPending();
        });

        return () => {
            mounted = false;
            clearTimeout(retryTimer);
            appSub.remove();
            pushIn.remove();
            pushTap.remove();
            if (channel) supabase.removeChannel(channel);
        };
    }, [table, driverId]);

    return { offer, clearOffer: () => setOffer(null) };
}

export function useDeliveryOfferSubscription(driverId: string | undefined) {
    return useOfferChannel<DeliveryOffer>('delivery_offers', driverId);
}

export function useRideOfferSubscription(driverId: string | undefined) {
    return useOfferChannel<RideOffer>('ride_offers', driverId);
}
