import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRide } from '../context/RideContext';
import { supabase } from '@gtaxi/core';
import { Location, FareEstimate } from '@gtaxi/core';

const RIDE_TTL_MINUTES = 30;

export function ActiveRideRestorationHandler() {
    const navigation = useNavigation<any>();
    const { activeRide, loading, checkActiveRide } = useRide();

    useEffect(() => {
        const handleRestoration = async () => {
            if (loading || !activeRide) return;

            const ride = activeRide;

            const updatedAt = new Date(ride.updated_at || ride.created_at || Date.now());
            const now = new Date();
            const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

            if (minutesSinceUpdate > RIDE_TTL_MINUTES) {
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
                navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'Receipt',
                        params: { rideId: ride.ride_id }
                    }],
                });
            } else if (ride.status === 'payment_confirmed' || ride.status === 'closed') {
                navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'Receipt',
                        params: { rideId: ride.ride_id }
                    }],
                });
            } else if (ride.status === 'cancelled') {
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
