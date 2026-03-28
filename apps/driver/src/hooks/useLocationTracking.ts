import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { updateDriverLocation } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MAX_JUMP_METERS = 100;
const MIN_TIME_DIFF_MS = 3000;

export function useLocationTracking() {
    const { driver, user } = useAuth();
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const lastLocationRef = useRef<Location.LocationObject | null>(null);
    const lastUpdateTimestampRef = useRef<number>(0);

    useEffect(() => {
        const startTracking = async () => {
            const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
            if (fgStatus !== 'granted') {
                setErrorMsg('Foreground location permission denied');
                return;
            }

            const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
            if (bgStatus !== 'granted') {
                console.warn('Background location permission denied');
            }

            // Fix 2: Start persistent background tracking
            // This stays alive even if the app is backgrounded.
            await Location.startLocationUpdatesAsync('LOCATION_TRACKING', {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 5000,
                distanceInterval: 10,
                foregroundService: {
                    notificationTitle: "G-TAXI Driver is Live",
                    notificationBody: "Your location is being shared to receive nearby ride requests.",
                    notificationColor: "#FFD700",
                },
            });

            // Fallback: Also watch in foreground for immediate UI updates
            const sub = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 5000,
                    distanceInterval: 10,
                },
                handleLocationUpdate
            );
            return sub;
        };

        let fgSubscriber: Location.LocationSubscription | undefined;

        if (driver?.is_online) {
            startTracking().then(sub => {
                if (sub) fgSubscriber = sub;
            });
        }

        return () => {
            if (fgSubscriber) fgSubscriber.remove();
            // We only stop background updates if the user goes offline or logs out
            if (!driver?.is_online) {
                Location.stopLocationUpdatesAsync('LOCATION_TRACKING').catch(() => { });
            }
        };
    }, [driver?.is_online]);

    const handleLocationUpdate = (newLoc: Location.LocationObject) => {
        const now = Date.now();
        const lastLoc = lastLocationRef.current;
        const lastTime = lastUpdateTimestampRef.current;

        // 1. Precision Check (Format to 6 decimals)
        const lat = parseFloat(newLoc.coords.latitude.toFixed(6));
        const lng = parseFloat(newLoc.coords.longitude.toFixed(6));
        const heading = newLoc.coords.heading || 0;

        // 2. Jump/Teleport Check
        if (lastLoc) {
            const dist = getDistanceFromLatLonInM(
                lastLoc.coords.latitude,
                lastLoc.coords.longitude,
                lat,
                lng
            );
            const timeDiff = now - lastTime;

            if (dist > MAX_JUMP_METERS && timeDiff < MIN_TIME_DIFF_MS) {
                console.warn('[Location] Rejected jump:', dist, 'm in', timeDiff, 'ms');
                return; // Reject update
            }
        }

        // Update state
        setLocation(newLoc);
        lastLocationRef.current = newLoc;
        lastUpdateTimestampRef.current = now;

        // Send to API
        if (user) {
            updateDriverLocation(user.id, lat, lng, heading).catch(err =>
                console.error('Failed to update location:', err)
            );
        }
    };

    return { location, errorMsg };
}

// Haversine formula
function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d * 1000; // Meters
}

function deg2rad(deg: number) {
    return deg * (Math.PI / 180);
}
