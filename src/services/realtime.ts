// Realtime subscription hooks for ride updates
import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface RideUpdate {
    ride_id: string;
    status: 'requested' | 'searching' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
    driver_id?: string;
    driver_name?: string;
    driver_vehicle?: string;
    driver_plate?: string;
    driver_rating?: number;
    driver_lat?: number;
    driver_lng?: number;
    estimated_arrival_min?: number;
}

/**
 * Hook to subscribe to realtime ride status updates
 * Uses Supabase Realtime to listen for changes to a specific ride
 */
export function useRideSubscription(rideId: string | null) {
    const [rideUpdate, setRideUpdate] = useState<RideUpdate | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!rideId) {
            return;
        }

        let channel: RealtimeChannel;

        const setupSubscription = async () => {
            try {
                // Subscribe to changes on this specific ride
                channel = supabase
                    .channel(`ride:${rideId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'rides',
                            filter: `id=eq.${rideId}`,
                        },
                        (payload) => {
                            console.log('Ride update received:', payload);
                            const ride = payload.new as any;

                            setRideUpdate({
                                ride_id: ride.id,
                                status: ride.status,
                                driver_id: ride.driver_id,
                                // Driver info would come from a join - for now we'll fetch separately
                            });
                        }
                    )
                    .subscribe((status) => {
                        console.log('Subscription status:', status);
                        setIsConnected(status === 'SUBSCRIBED');
                        if (status === 'CHANNEL_ERROR') {
                            setError('Failed to connect to realtime updates');
                        }
                    });
            } catch (err) {
                console.error('Subscription error:', err);
                setError('Failed to setup realtime subscription');
            }
        };

        setupSubscription();

        // Cleanup on unmount
        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [rideId]);

    return { rideUpdate, isConnected, error };
}

/**
 * Hook to subscribe to driver location updates
 * Useful for showing driver position on map during pickup
 */
export function useDriverLocationSubscription(driverId: string | null) {
    const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);

    useEffect(() => {
        if (!driverId) {
            return;
        }

        let channel: RealtimeChannel;

        const setupSubscription = async () => {
            // Subscribe to driver's location updates
            channel = supabase
                .channel(`driver_location:${driverId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'drivers',
                        filter: `id=eq.${driverId}`,
                    },
                    (payload) => {
                        const driver = payload.new as any;
                        if (driver.current_lat && driver.current_lng) {
                            setDriverLocation({
                                lat: driver.current_lat,
                                lng: driver.current_lng,
                            });
                        }
                    }
                )
                .subscribe();
        };

        setupSubscription();

        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [driverId]);

    return driverLocation;
}

/**
 * Fetch driver details when a driver is assigned
 */
export async function fetchDriverDetails(driverId: string) {
    const { data, error } = await supabase
        .from('drivers')
        .select('id, full_name, vehicle_make, vehicle_model, license_plate, rating')
        .eq('id', driverId)
        .single();

    if (error) {
        console.error('Error fetching driver:', error);
        return null;
    }

    return {
        name: data.full_name,
        vehicle: `${data.vehicle_make} ${data.vehicle_model}`,
        plate: data.license_plate,
        rating: data.rating || 4.8,
    };
}
