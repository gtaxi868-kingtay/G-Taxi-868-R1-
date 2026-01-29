import React, { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { getActiveRide } from '../services/api';
import { fetchDriverDetails } from '../services/realtime';
import { supabase } from '../services/supabase';
import { Location, FareEstimate } from '../types/ride';

export function ActiveRideRestorationHandler() {
    const navigation = useNavigation<any>();

    useEffect(() => {
        const restoreRide = async () => {
            try {
                // 1. Check for active ride
                const response = await getActiveRide();

                if (response.success && response.data) {
                    const ride = response.data;
                    console.log('Restoring active ride:', ride.status);

                    // Reconstruct objects
                    const destination: Location = {
                        latitude: ride.dropoff_lat,
                        longitude: ride.dropoff_lng,
                        address: ride.dropoff_address || 'Destination',
                    };

                    const fare: FareEstimate = {
                        distance_km: ride.distance_meters / 1000,
                        duration_min: Math.round(ride.duration_seconds / 60),
                        total_fare_cents: ride.total_fare_cents,
                        route_polyline: '', // Polyline might be missing, API doesn't return it in ActiveRideResponse yet
                    };

                    // 2. Navigate based on status
                    if (ride.status === 'requested' || ride.status === 'searching') {
                        navigation.navigate('SearchingDriver', {
                            destination,
                            fare,
                            rideId: ride.ride_id,
                        });
                    } else if (ride.status === 'assigned' || ride.status === 'in_progress') {
                        // 3. For active rides, we need driver details
                        // ActiveRideResponse from API currently doesn't include driver_id, so we query Supabase directly
                        const { data: rideData, error } = await supabase
                            .from('rides')
                            .select('driver_id')
                            .eq('id', ride.ride_id)
                            .single();

                        if (rideData?.driver_id) {
                            const driver = await fetchDriverDetails(rideData.driver_id);
                            if (driver) {
                                navigation.navigate('ActiveRide', {
                                    destination,
                                    fare,
                                    driver,
                                    rideId: ride.ride_id,
                                });
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to restore ride:', error);
            }
        };

        restoreRide();
    }, []);

    return null;
}
