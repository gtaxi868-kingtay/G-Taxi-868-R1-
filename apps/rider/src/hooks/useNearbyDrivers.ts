// useNearbyDrivers.ts
// Hook to fetch and subscribe to nearby driver locations in real-time

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '@gtaxi/core';

// A nearby driver dot. Positions are plain numbers: the map marker
// (components/home/CarMarker) glides between updates itself. This used to hold
// Animated.Value objects, which HomeScreen passed straight into
// <Marker coordinate> and into distance maths, so cars were mis-placed and the
// "~N min" ETA never showed.
export interface NearbyDriver {
    id: string;
    lat: number;
    lng: number;
    heading: number;
    is_online?: boolean;
}

// ~200m debounce threshold in degrees (0.002 ≈ 200m at equator)
const LOCATION_DEBOUNCE_THRESHOLD = 0.002;

export function useNearbyDrivers(userLat: number, userLng: number, radiusKm: number = 5) {
    const [drivers, setDrivers] = useState<NearbyDriver[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

                const newDriverList: NearbyDriver[] = (data || [])
                    .filter((d: any) => Number.isFinite(d?.lat) && Number.isFinite(d?.lng))
                    .map((d: any) => ({ id: d.id, lat: d.lat, lng: d.lng, heading: d.heading || 0, is_online: d.is_online }));
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
