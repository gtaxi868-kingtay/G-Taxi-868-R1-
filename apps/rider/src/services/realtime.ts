// Realtime subscription hooks for ride updates
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../../shared/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface RideUpdate {
    ride_id: string;
    status: 'requested' | 'searching' | 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
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
 * ALSO includes polling fallback for when Realtime times out
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
        let pollInterval: NodeJS.Timeout;

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
                            console.log('[Realtime] Ride update received:', payload);
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
                        console.log('[Realtime] Subscription status:', status);
                        setIsConnected(status === 'SUBSCRIBED');
                        if (status === 'CHANNEL_ERROR') {
                            setError('Failed to connect to realtime updates');
                        }
                        if (status === 'TIMED_OUT') {
                            console.log('[Realtime] Timed out - polling fallback active');
                        }
                    });
            } catch (err) {
                console.error('[Realtime] Subscription error:', err);
                setError('Failed to setup realtime subscription');
            }
        };

        // POLLING FALLBACK - checks ride status every 3 seconds
        // This catches updates even when Realtime times out
        const startPolling = () => {
            pollInterval = setInterval(async () => {
                try {
                    const { data: ride, error: pollError } = await supabase
                        .from('rides')
                        .select('id, status, driver_id')
                        .eq('id', rideId)
                        .single();

                    if (pollError) {
                        console.log('[Poll] Error:', pollError.message);
                        return;
                    }

                    if (ride) {
                        // Only update if status actually changed
                        setRideUpdate(prev => {
                            if (prev?.status !== ride.status || prev?.driver_id !== ride.driver_id) {
                                console.log('[Poll] Ride update detected:', ride.status, ride.driver_id);
                                return {
                                    ride_id: ride.id,
                                    status: ride.status,
                                    driver_id: ride.driver_id,
                                };
                            }
                            return prev;
                        });
                    }
                } catch (err) {
                    console.log('[Poll] Fetch error:', err);
                }
            }, 3000); // Poll every 3 seconds
        };

        setupSubscription();
        startPolling();

        // Cleanup on unmount
        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [rideId]);

    return { rideUpdate, isConnected, error };
}

/**
 * Hook to subscribe to driver location updates
 * Useful for showing driver position on map during pickup
 * ALSO includes polling fallback for when Realtime times out
 */
export function useDriverLocationSubscription(driverId: string | null) {
    const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);

    useEffect(() => {
        if (!driverId) {
            return;
        }

        let channel: RealtimeChannel;
        let pollInterval: NodeJS.Timeout;

        const setupSubscription = async () => {
            // Fetch initial driver location first
            try {
                const { data } = await supabase
                    .from('drivers')
                    .select('lat, lng')
                    .eq('id', driverId)
                    .single();

                if (data?.lat && data?.lng) {
                    setDriverLocation({ lat: data.lat, lng: data.lng });
                }
            } catch (err) {
                console.log('[Driver] Initial fetch failed:', err);
            }

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
                        console.log('[Realtime] Driver location update:', driver.lat, driver.lng);
                        if (driver.lat !== undefined && driver.lng !== undefined) {
                            setDriverLocation({
                                lat: driver.lat,
                                lng: driver.lng,
                            });
                        }
                    }
                )
                .subscribe((status) => {
                    console.log('[Driver Realtime] Status:', status);
                    if (status === 'TIMED_OUT') {
                        console.log('[Driver Realtime] Timed out - using polling fallback');
                    }
                });
        };

        // POLLING FALLBACK - fetches driver location every 2 seconds
        const startPolling = () => {
            pollInterval = setInterval(async () => {
                try {
                    const { data, error } = await supabase
                        .from('drivers')
                        .select('lat, lng')
                        .eq('id', driverId)
                        .single();

                    if (error) {
                        return;
                    }

                    if (data?.lat && data?.lng) {
                        setDriverLocation(prev => {
                            // Only update if position changed
                            if (prev?.lat !== data.lat || prev?.lng !== data.lng) {
                                return { lat: data.lat, lng: data.lng };
                            }
                            return prev;
                        });
                    }
                } catch (err) {
                    // Silently ignore polling errors
                }
            }, 2000); // Poll every 2 seconds for smooth map updates
        };

        setupSubscription();
        startPolling();

        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
            if (pollInterval) {
                clearInterval(pollInterval);
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
        .select('id, name, vehicle_model, plate_number, rating')
        .eq('id', driverId)
        .single();

    if (error) {
        console.error('Error fetching driver:', error);
        return null;
    }

    return {
        name: data.name,
        vehicle: data.vehicle_model, // We only have vehicle_model in DB currently
        plate: data.plate_number,
        rating: data.rating || 4.8,
    };
}
