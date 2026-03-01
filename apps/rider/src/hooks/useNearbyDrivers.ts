// useNearbyDrivers.ts
// Hook to fetch and subscribe to nearby driver locations in real-time

import { useEffect, useState, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { supabase } from '../../../../shared/supabase';

// Animated wrapper for driver positions
interface AnimatedDriver {
    id: string;
    lat: Animated.Value;
    lng: Animated.Value;
    heading: number;
    is_online?: boolean;
}

interface DriverFromDB {
    id: string;
    lat: number;
    lng: number;
    heading: number;
    is_online?: boolean;
}

export function useNearbyDrivers(userLat: number, userLng: number, radiusKm: number = 5) {
    const [drivers, setDrivers] = useState<AnimatedDriver[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Keep a map of driver IDs to their Animated values for smooth updates
    const animatedDriversRef = useRef<Map<string, AnimatedDriver>>(new Map());

    // Helper to animate a driver to new position
    const animateDriverToPosition = (driver: AnimatedDriver, newLat: number, newLng: number, heading: number) => {
        Animated.parallel([
            Animated.timing(driver.lat, {
                toValue: newLat,
                duration: 3000,
                easing: Easing.linear,
                useNativeDriver: false,
            }),
            Animated.timing(driver.lng, {
                toValue: newLng,
                duration: 3000,
                easing: Easing.linear,
                useNativeDriver: false,
            }),
        ]).start();

        // Update heading immediately (no animation needed)
        driver.heading = heading;
    };

    // Convert DB driver to animated driver
    const createAnimatedDriver = (dbDriver: DriverFromDB): AnimatedDriver => ({
        id: dbDriver.id,
        lat: new Animated.Value(dbDriver.lat),
        lng: new Animated.Value(dbDriver.lng),
        heading: dbDriver.heading || 0,
        is_online: dbDriver.is_online,
    });

    useEffect(() => {
        let channel: any;

        const fetchDrivers = async () => {
            try {
                setLoading(true);

                // Fetch online drivers via security definer view (avoids RLS block on drivers table)
                const { data, error: fetchError } = await supabase
                    .from('drivers_map_view')
                    .select('id, lat, lng, heading, is_online')
                    .not('lat', 'is', null)
                    .not('lng', 'is', null);

                if (fetchError) throw fetchError;

                // Initialize animated drivers
                const animatedList: AnimatedDriver[] = (data || []).map((d: DriverFromDB) => {
                    const animated = createAnimatedDriver(d);
                    animatedDriversRef.current.set(d.id, animated);
                    return animated;
                });

                setDrivers(animatedList);
                setLoading(false);
            } catch (err) {
                setError(String(err));
                setLoading(false);
            }
        };

        const subscribeToUpdates = () => {
            channel = supabase
                .channel('driver-locations-realtime')
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'drivers', // Must remain 'drivers' because Realtime doesn't fire on views
                    },
                    (payload) => {
                        const payloadData = payload.new;
                        // Map the payload to only the fields we care about
                        const updatedDriver: DriverFromDB = {
                            id: payloadData.id,
                            lat: payloadData.lat,
                            lng: payloadData.lng,
                            heading: payloadData.heading,
                            is_online: payloadData.is_online
                        };
                        const existing = animatedDriversRef.current.get(updatedDriver.id);

                        if (existing && updatedDriver.lat && updatedDriver.lng) {
                            // Animate existing driver to new position
                            animateDriverToPosition(
                                existing,
                                updatedDriver.lat,
                                updatedDriver.lng,
                                updatedDriver.heading || 0
                            );
                            existing.is_online = updatedDriver.is_online;

                        } else if (!existing && updatedDriver.is_online && updatedDriver.lat) {
                            // New driver came online - add them
                            const newAnimated = createAnimatedDriver(updatedDriver);
                            animatedDriversRef.current.set(updatedDriver.id, newAnimated);
                            setDrivers(prev => [...prev, newAnimated]);
                        }
                    }
                )
                .subscribe();
        };

        fetchDrivers();
        subscribeToUpdates();

        return () => {
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [userLat, userLng]);

    return { drivers, loading, error };
}
