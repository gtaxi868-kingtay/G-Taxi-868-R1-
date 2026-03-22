import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getActiveRide } from '../services/api';
import { fetchDriverDetails } from '../services/realtime';
import { supabase } from '../../../../shared/supabase';
import { Location, FareEstimate } from '../types/ride';

// Ride TTL: 30 minutes of no activity = stale
const RIDE_TTL_MINUTES = 30;

export function ActiveRideRestorationHandler() {
    const navigation = useNavigation<any>();

    useEffect(() => {
        const restoreRide = async () => {
            try {
                const response = await getActiveRide();

                if (response.success && response.data) {
                    const ride = response.data;
                    console.log('Found active ride:', ride.status, 'updated:', ride.updated_at);

                    const updatedAt = new Date(ride.updated_at || ride.created_at);
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
                        navigation.navigate('SearchingDriver', {
                            destination,
                            fare,
                            rideId: ride.ride_id,
                        });
                    } else if (ride.status === 'assigned' || ride.status === 'in_progress' || ride.status === 'arrived') {
                        const driver = ride.driver;
                        if (driver) {
                            navigation.navigate('ActiveRide', {
                                destination,
                                fare,
                                driver: {
                                    ...driver,
                                    vehicle: driver.vehicle,
                                    plate: driver.plate,
                                },
                                rideId: ride.ride_id,
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to restore ride:', error);
            }
        };

        restoreRide();

        const appStateSub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                restoreRide();
            }
        });

        return () => appStateSub.remove();
    }, []);

    return null;
}

