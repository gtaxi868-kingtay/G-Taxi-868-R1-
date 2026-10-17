// useNearbyDrivers.ts
// Hook to fetch and subscribe to nearby driver locations in real-time

import { useEffect, useState, useRef } from 'react';
import { Animated, Easing, AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '@gtaxi/core';

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

    // Only refresh while the home screen is in front and the app is open.
    const isFocused = useIsFocused();
    const [appActive, setAppActive] = useState(AppState.currentState === 'active');
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
        return () => sub.remove();
    }, []);

    // Re-query only when the rider has moved ~200 m (rounded position as the
    // dependency). The old early-return here cleared the refresh timer on
    // small moves without starting a new one, so the car map could freeze.
    const roundedLat = Math.round(userLat / LOCATION_DEBOUNCE_THRESHOLD) * LOCATION_DEBOUNCE_THRESHOLD;
    const roundedLng = Math.round(userLng / LOCATION_DEBOUNCE_THRESHOLD) * LOCATION_DEBOUNCE_THRESHOLD;

    useEffect(() => {
        if (!userLat || !userLng || isNaN(userLat) || isNaN(userLng)) return;
        if (!isFocused || !appActive) return;

        let cancelled = false;

        const fetchNearby = async () => {
            try {
                // Database call (nearby_driver_dots): approved, online, recently
                // seen drivers, positions rounded ~100 m. It replaces the
                // get_nearby_drivers edge function, which cost one function
                // call per rider every 10 s.
                const { data, error: fetchError } = await supabase.rpc('nearby_driver_dots', {
                    p_lat: userLat, p_lng: userLng, p_radius_km: radiusKm,
                });
                if (fetchError) throw fetchError;
                if (cancelled) return;

                const dots: DriverFromDB[] = (data || []).map((d: any) => ({ id: d.id, lat: d.lat, lng: d.lng, heading: 0 }));
                const newDriverList: AnimatedDriver[] = dots.map((d) => {
                    const existing = animatedDriversRef.current.get(d.id);
                    if (existing) {
                        animateDriverToPosition(existing, d.lat, d.lng, d.heading || 0);
                        return existing;
                    }
                    const created = getOrCreateAnimatedDriver(d);
                    animatedDriversRef.current.set(d.id, created);
                    return created;
                });
                const currentIds = new Set(dots.map((d) => d.id));
                for (const [id] of animatedDriversRef.current) {
                    if (!currentIds.has(id)) animatedDriversRef.current.delete(id);
                }
                setDrivers(newDriverList);
                setError(null);
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                console.warn('nearby drivers fetch failed:', err);
                setError(String(err));
                setLoading(false);
            }
        };

        fetchNearby();
        const pollTimer = setInterval(fetchNearby, 30_000);
        return () => {
            cancelled = true;
            clearInterval(pollTimer);
        };
    }, [roundedLat, roundedLng, radiusKm, isFocused, appActive]);

    return { drivers, loading, error };
}
