import React, { useEffect } from 'react';
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
                // 1. Check for active ride
                const response = await getActiveRide();

                if (response.success && response.data) {
                    const ride = response.data;
                    console.log('Found active ride:', ride.status, 'updated:', ride.updated_at);

                    // 2. Check if ride is stale (no updates for 30 minutes)
                    const updatedAt = new Date(ride.updated_at || ride.created_at);
                    const now = new Date();
                    const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

                    if (minutesSinceUpdate > RIDE_TTL_MINUTES) {
                        console.log(`Ride is stale (${minutesSinceUpdate.toFixed(0)} min old). Auto-cancelling...`);

                        // Auto-cancel stale ride using safe RPC
                        const { error } = await supabase.rpc('expire_ride', { p_ride_id: ride.ride_id });

                        if (error) {
                            console.error('Failed to expire stale ride:', error);
                        } else {
                            console.log('Stale ride cancelled via RPC. User can start fresh.');
                        }
                        return; // Don't restore - let user go to home screen
                    }

                    // 3. Ride is fresh - proceed with restoration
                    console.log('Restoring fresh ride:', ride.status);

                    const destination: Location = {
                        latitude: ride.dropoff_lat,
                        longitude: ride.dropoff_lng,
                        address: ride.dropoff_address || 'Destination',
                    };

                    const fare: FareEstimate = {
                        distance_km: ride.distance_meters / 1000,
                        duration_min: Math.round(ride.duration_seconds / 60),
                        total_fare_cents: ride.total_fare_cents,
                        route_polyline: '',
                    };

                    // 4. Navigate based on status with enriched data
                    if (ride.status === 'requested' || ride.status === 'searching') {
                        navigation.navigate('SearchingDriver', {
                            destination,
                            fare,
                            rideId: ride.ride_id,
                        });
                    } else if (ride.status === 'assigned' || ride.status === 'in_progress' || ride.status === 'arrived') {
                        // Driver info is now enriched in the getActiveRide response (ONE CALL RESTORATION)
                        const driver = ride.driver;

                        if (driver) {
                            console.log('Driver found in enriched response, navigating to ActiveRide');
                            navigation.navigate('ActiveRide', {
                                destination,
                                fare,
                                driver: {
                                    ...driver,
                                    vehicle: driver.vehicle, // Standardized label
                                    plate: driver.plate,     // Standardized label
                                },
                                rideId: ride.ride_id,
                            });
                        } else {
                            console.error('Ride is active but no driver info returned, letting user go home');
                            // We won't cancel it automatically here, but we don't restore the screen
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

