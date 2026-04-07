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

// ~200m debounce threshold in degrees (0.002 ≈ 200m at equator)
const LOCATION_DEBOUNCE_THRESHOLD = 0.002;

export function useNearbyDrivers(userLat: number, userLng: number, radiusKm: number = 5) {
    const [drivers, setDrivers] = useState<AnimatedDriver[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Keep a map of driver IDs to their Animated values for smooth updates
    const animatedDriversRef = useRef<Map<string, AnimatedDriver>>(new Map());

    // Track the last location that triggered a subscription to debounce
    const lastSubscribedLocation = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });

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

    // Convert DB driver to animated driver (reusing existing values if possible)
    const getOrCreateAnimatedDriver = (dbDriver: DriverFromDB): AnimatedDriver => {
        const existing = animatedDriversRef.current.get(dbDriver.id);
        if (existing) {
            // Update static fields but keep animated values
            existing.heading = dbDriver.heading || 0;
            existing.is_online = dbDriver.is_online;
            return existing;
        }

        return {
            id: dbDriver.id,
            lat: new Animated.Value(dbDriver.lat),
            lng: new Animated.Value(dbDriver.lng),
            heading: dbDriver.heading || 0,
            is_online: dbDriver.is_online,
        };
    };

    useEffect(() => {
        // Null/NaN guard: don't subscribe if location is invalid
        if (!userLat || !userLng || isNaN(userLat) || isNaN(userLng)) {
            return;
        }

        // Debounce: only re-subscribe if location changed by more than ~200m
        const latDiff = Math.abs(userLat - lastSubscribedLocation.current.lat);
        const lngDiff = Math.abs(userLng - lastSubscribedLocation.current.lng);

        if (
            lastSubscribedLocation.current.lat !== 0 &&
            latDiff < LOCATION_DEBOUNCE_THRESHOLD &&
            lngDiff < LOCATION_DEBOUNCE_THRESHOLD
        ) {
            // Location hasn't changed enough — skip re-subscription
            return;
        }

        // Update tracked location
        lastSubscribedLocation.current = { lat: userLat, lng: userLng };

        let pollTimer: any;

        const fetchNearbyFromRedis = async () => {
            try {
                // Call the new Redis-backed Edge Function
                const { data, error: fetchError } = await supabase.functions.invoke('get_nearby_drivers', {
                    body: { lat: userLat, lng: userLng, radius: radiusKm }
                });

                if (fetchError) throw fetchError;

                const redisDrivers = data.drivers || [];

                // Update animated drivers
                const newDriverList: AnimatedDriver[] = redisDrivers.map((d: DriverFromDB) => {
                    const existing = animatedDriversRef.current.get(d.id);
                    if (existing) {
                        animateDriverToPosition(existing, d.lat, d.lng, d.heading || 0);
                        return existing;
                    } else {
                        const newAnimated = getOrCreateAnimatedDriver(d);
                        animatedDriversRef.current.set(d.id, newAnimated);
                        return newAnimated;
                    }
                });

                // Remove drivers that are no longer in the results (offline or too far)
                const currentIds = new Set(redisDrivers.map((d: any) => d.id));
                for (const [id, _] of animatedDriversRef.current) {
                    if (!currentIds.has(id)) {
                        animatedDriversRef.current.delete(id);
                    }
                }

                setDrivers(newDriverList);
                setLoading(false);
            } catch (err) {
                console.error("Redis fetch failed:", err);
                setError(String(err));
                setLoading(false);
            }
        };

        // Initial fetch
        fetchNearbyFromRedis();

        // High-frequency poll (Every 3 seconds) — MUCH safer than Postgres Realtime for location
        pollTimer = setInterval(fetchNearbyFromRedis, 3000);

        return () => {
            if (pollTimer) clearInterval(pollTimer);
        };
    }, [userLat, userLng]);

    return { drivers, loading, error };
}
