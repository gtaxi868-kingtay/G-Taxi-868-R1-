import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRide } from '../context/RideContext';
import { supabase } from '../../../../shared/supabase';
import { Location, FareEstimate } from '../types/ride';

// Ride TTL: 30 minutes of no activity = stale
const RIDE_TTL_MINUTES = 30;

export function ActiveRideRestorationHandler() {
    const navigation = useNavigation<any>();
    const { activeRide, loading, checkActiveRide } = useRide();

    useEffect(() => {
        const handleRestoration = async () => {
            if (loading || !activeRide) return;

            const ride = activeRide;
            console.log('Restoration Check:', ride.status, 'updated:', ride.updated_at);

            const updatedAt = new Date(ride.updated_at || ride.created_at || Date.now());
            const now = new Date();
            const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

            if (minutesSinceUpdate > RIDE_TTL_MINUTES) {
                console.log(`Ride is stale (${minutesSinceUpdate.toFixed(0)} min old). Auto-cancelling...`);
                const { error } = await supabase.rpc('expire_ride', { p_ride_id: ride.ride_id });
                if (error) console.error('Failed to expire stale ride:', error);
                return;
            }

            const destination: Location = {
                latitude: ride.dropoff_lat,
                longitude: ride.dropoff_lng,
                address: ride.dropoff_address || 'Destination',
            };

            const fare: FareEstimate = {
                distance_meters: ride.distance_meters,
                duration_seconds: ride.duration_seconds,
                total_fare_cents: ride.total_fare_cents,
                route_polyline: '',
            };

            if (ride.status === 'requested' || ride.status === 'searching') {
                navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'SearchingDriver',
                        params: { destination, fare, rideId: ride.ride_id }
                    }],
                });
            } else if (ride.status === 'assigned') {
                // FIX 1: Show driver found confirmation before active ride
                navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'DriverFound',
                        params: {
                            destination,
                            fare,
                            rideId: ride.ride_id,
                        }
                    }],
                });
            } else if (ride.status === 'arrived' || ride.status === 'in_progress') {
                // If we're already on ActiveRide, don't reset (to avoid component flicker)
                const currentRoute = navigation.getState()?.routes[navigation.getState()?.index];
                if (currentRoute?.name === 'ActiveRide' && currentRoute?.params?.rideId === ride.ride_id) {
                    return;
                }

                if (ride.driver_id) {
                    navigation.reset({
                        index: 0,
                        routes: [{
                            name: 'ActiveRide',
                            params: {
                                destination,
                                fare,
                                rideId: ride.ride_id,
                            }
                        }],
                    });
                }
            } else if (ride.status === 'completed') {
                // FIX 2: Navigate to receipt after ride completion
                navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'Receipt',
                        params: { rideId: ride.ride_id }
                    }],
                });
            } else if (ride.status === 'cancelled') {
                // FIX 3: Return home after cancellation
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Home' }],
                });
            }
        };

        handleRestoration();

        const appStateSub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                checkActiveRide();
            }
        });

        return () => appStateSub.remove();
    }, [activeRide, loading]);

    return null;
}

