import { useEffect, useState } from 'react';
import { supabase } from '../../../../shared/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface RideOffer {
    id: string; // offer id
    ride_id: string;
    distance_meters: number;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    created_at: string;
    expires_at: string;
}

export function useRideOfferSubscription(driverId: string | undefined) {
    const [offer, setOffer] = useState<RideOffer | null>(null);

    useEffect(() => {
        if (!driverId) return;

        console.log('Subscribing to direct ride offers for driver:', driverId);

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
                    console.log('Ride offer update received:', payload);
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
