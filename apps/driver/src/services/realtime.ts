import { useEffect, useState } from 'react';
import { supabase } from '@gtaxi/core';
import { RealtimeChannel } from '@supabase/supabase-js';

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
    total_cents?: number;
    merchant_address?: string;
    rider_address?: string;
}

export function useDeliveryOfferSubscription(driverId: string | undefined) {
    const [offer, setOffer] = useState<DeliveryOffer | null>(null);

    useEffect(() => {
        if (!driverId) return;

        const channel = supabase
            .channel(`driver-delivery-offers:${driverId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'delivery_offers',
                    filter: `driver_id=eq.${driverId}`,
                },
                (payload) => {
                    const updatedOffer = payload.new as DeliveryOffer;
                    if (updatedOffer.status === 'pending') {
                        setOffer(updatedOffer);
                    } else {
                        setOffer(current => current?.id === updatedOffer.id ? null : current);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [driverId]);

    return { offer, clearOffer: () => setOffer(null) };
}

export function useRideOfferSubscription(driverId: string | undefined) {
    const [offer, setOffer] = useState<RideOffer | null>(null);

    useEffect(() => {
        if (!driverId) return;

        __DEV__ && console.log('Subscribing to direct ride offers for driver:', driverId);

        const channel = supabase
            .channel(`driver-offers:${driverId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen for INSERT and UPDATE
                    schema: 'public',
                    table: 'ride_offers',
                    filter: `driver_id=eq.${driverId}`,
                },
                (payload) => {
                    __DEV__ && console.log('Ride offer update received:', payload);
                    const updatedOffer = payload.new as RideOffer;

                    if (updatedOffer.status === 'pending') {
                        setOffer(updatedOffer);
                    } else {
                        // If status is changed to declined, expired, or accepted, clear it
                        setOffer(current => current?.id === updatedOffer.id ? null : current);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [driverId]);

    return { offer, clearOffer: () => setOffer(null) };
}
