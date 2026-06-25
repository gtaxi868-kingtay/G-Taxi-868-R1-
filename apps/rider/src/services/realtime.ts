// Realtime subscription hooks for ride updates
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@gtaxi/core';

export interface RideUpdate {
    ride_id: string;
    status: 'requested' | 'searching' | 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'closed';
    driver_id?: string;
    driver_name?: string;
    driver_vehicle?: string;
    driver_plate?: string;
    driver_rating?: number;
    driver_lat?: number;
    driver_lng?: number;
    dropoff_lat?: number;
    dropoff_lng?: number;
    estimated_arrival_min?: number;
    payment_method?: string;
    total_fare_cents?: number;
}

/**
 * Hook to subscribe to realtime ride status updates
 * Uses Supabase Realtime to listen for changes to a specific ride
 * Polling fallback activates ONLY when WebSocket disconnects
 */
export function useRideSubscription(rideId: string | null) {
    const [rideUpdate, setRideUpdate] = useState<RideUpdate | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [connectionLost, setConnectionLost] = useState(false);

    useEffect(() => {
        if (!rideId) return;

        let channel: any;
        let pollInterval: NodeJS.Timeout;
        let reconnectTimer: NodeJS.Timeout;
        let mounted = true;

        const doPoll = async () => {
            try {
                const { data: ride, error: pollError } = await supabase
                    .from('rides')
                    .select('id, status, driver_id, payment_method, total_fare_cents')
                    .eq('id', rideId)
                    .single();

                if (pollError || !ride || !mounted) return;

                setRideUpdate(prev => {
                    if (prev?.status !== ride.status || prev?.driver_id !== ride.driver_id) {
                        return {
                            ride_id: ride.id,
                            status: ride.status,
                            driver_id: ride.driver_id,
                            payment_method: ride.payment_method,
                            total_fare_cents: ride.total_fare_cents,
                        };
                    }
                    return prev;
                });
            } catch {
                // poll errors are non-fatal
            }
        };

        const startPolling = () => {
            setConnectionLost(true);
            doPoll();
            pollInterval = setInterval(doPoll, 5000);
        };

        const stopPolling = () => {
            setConnectionLost(false);
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = undefined as any;
            }
        };

        const tryReconnect = () => {
            if (!mounted) return;
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
                        if (!mounted) return;
                        const ride = payload.new as any;
                        setRideUpdate({
                            ride_id: ride.id,
                            status: ride.status,
                            driver_id: ride.driver_id,
                            payment_method: ride.payment_method,
                            total_fare_cents: ride.total_fare_cents,
                        });
                    }
                )
                .subscribe((status) => {
                    if (!mounted) return;
                    if (status === 'SUBSCRIBED') {
                        setIsConnected(true);
                        stopPolling();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        setIsConnected(false);
                        if (!pollInterval) startPolling();
                    }
                });
        };

        const setupSubscription = () => {
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
                        if (!mounted) return;
                        const ride = payload.new as any;
                        setRideUpdate({
                            ride_id: ride.id,
                            status: ride.status,
                            driver_id: ride.driver_id,
                            payment_method: ride.payment_method,
                            total_fare_cents: ride.total_fare_cents,
                        });
                    }
                )
                .subscribe((status) => {
                    if (!mounted) return;
                    setIsConnected(status === 'SUBSCRIBED');
                    if (status === 'CHANNEL_ERROR') {
                        setError('Failed to connect to realtime updates');
                        startPolling();
                    }
                    if (status === 'TIMED_OUT') {
                        startPolling();
                        reconnectTimer = setTimeout(tryReconnect, 30_000);
                    }
                });
        };

        setupSubscription();

        return () => {
            mounted = false;
            if (channel) supabase.removeChannel(channel);
            if (pollInterval) clearInterval(pollInterval);
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [rideId]);

    return { rideUpdate, isConnected, error, connectionLost };
}

/**
 * Hook to subscribe to driver location updates
 * Shows driver position on map during pickup
 * Polling fallback activates ONLY when WebSocket disconnects
 */
export function useDriverLocationSubscription(driverId: string | null) {
    const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);

    useEffect(() => {
        if (!driverId) return;

        let channel: any;
        let pollInterval: NodeJS.Timeout;
        let reconnectTimer: NodeJS.Timeout;
        let mounted = true;

        const doPoll = async () => {
            if (!mounted) return;
            try {
                const { data, error } = await supabase
                    .from('driver_locations')
                    .select('lat, lng')
                    .eq('driver_id', driverId)
                    .single();

                if (error || !data || !mounted) return;

                if (data.lat && data.lng) {
                    setDriverLocation(prev => {
                        if (prev?.latitude !== data.lat || prev?.longitude !== data.lng) {
                            return { latitude: data.lat, longitude: data.lng };
                        }
                        return prev;
                    });
                }
            } catch {
                // non-fatal
            }
        };

        const startPolling = () => {
            doPoll();
            if (!pollInterval) {
                pollInterval = setInterval(doPoll, 5000);
            }
        };

        const stopPolling = () => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = undefined as any;
            }
        };

        const setupSubscription = () => {
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
                        if (!mounted) return;
                        const driver = payload.new as any;
                        if (driver.lat !== undefined && driver.lng !== undefined) {
                            setDriverLocation({
                                latitude: driver.lat,
                                longitude: driver.lng,
                            });
                        }
                    }
                )
                .subscribe((status) => {
                    if (!mounted) return;
                    if (status === 'SUBSCRIBED') {
                        stopPolling();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        startPolling();
                        reconnectTimer = setTimeout(setupSubscription, 30_000);
                    }
                });
        };

        // Fetch initial location
        doPoll();
        setupSubscription();

        return () => {
            mounted = false;
            if (channel) supabase.removeChannel(channel);
            if (pollInterval) clearInterval(pollInterval);
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [driverId]);

    return driverLocation;
}

/**
 * Fetch driver details when a driver is assigned
 * Uses the `drivers` table directly (not a view) for reliability
 */
export async function fetchDriverDetails(driverId: string) {
    const { data, error } = await supabase
        .from('drivers')
        .select('id, name, vehicle_model, plate_number, rating, phone_number, photo_url')
        .eq('id', driverId)
        .single();

    if (error || !data) {
        console.error('Error fetching driver:', error);
        // Return a safe fallback instead of null to prevent downstream crashes
        return {
            name: 'Driver',
            vehicle: 'Vehicle',
            id: driverId,
            phone: '',
            photo_url: undefined,
            plate: '---',
            rating: 4.8,
        };
    }

    return {
        name: data.name,
        vehicle: data.vehicle_model,
        id: data.id,
        phone: data.phone_number,
        photo_url: data.photo_url,
        plate: data.plate_number,
        rating: data.rating || 4.8,
    };
}
