import { useState, useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateDriverLocation } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MAX_JUMP_METERS = 150;
const MIN_TIME_DIFF_MS = 3000;
const QUEUE_KEY = 'pending_locations_v1';
const MAX_QUEUE_SIZE = 50;
const SIGNAL_TIMEOUT_MS = 10000; // 10s without GPS triggers Dead Reckoning

export type SignalStatus = 'searching' | 'lock' | 'dead_reckoning' | 'denied';

export function useLocationTracking() {
    const { driver, user } = useAuth();
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [signalStatus, setSignalStatus] = useState<SignalStatus>('searching');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    
    const lastLocationRef = useRef<Location.LocationObject | null>(null);
    const prevLocationRef = useRef<Location.LocationObject | null>(null); // For velocity calculation
    const lastUpdateTimestampRef = useRef<number>(0);
    const isFlushing = useRef(false);
    
    // Dead Reckoning State
    const velocityRef = useRef<{ dx: number, dy: number }>({ dx: 0, dy: 0 }); // Lat/Lng change per second
    const accelRef = useRef<{ x: number, y: number, z: number }>({ x: 0, y: 0, z: 0 });
    const drIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Accelerometer Listener ──────────────────────────────────────────────
    useEffect(() => {
        if (!driver?.is_online) return;
        
        Accelerometer.setUpdateInterval(500);
        const sub = Accelerometer.addListener(data => {
            accelRef.current = data;
        });
        
        return () => sub.remove();
    }, [driver?.is_online]);

    // ── Location Tracker & Permissions ────────────────────────────────────────
    useEffect(() => {
        const startTracking = async () => {
            const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
            if (fgStatus !== 'granted') {
                setErrorMsg('Foreground location permission denied');
                setSignalStatus('denied');
                Alert.alert(
                    "Location Required",
                    "G-Taxi needs your location to match you with riders. Please enable it in Settings.",
                    [
                        { text: "Cancel", style: "cancel" },
                        { text: "Open Settings", onPress: () => Linking.openSettings() }
                    ]
                );
                return;
            }

            const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
            if (bgStatus !== 'granted') {
                console.warn('Background location permission denied');
                Alert.alert(
                    "Background Location Required",
                    "To keep you online while using other apps (like Maps), choose 'Always Allow' in Settings.",
                    [
                        { text: "Cancel", style: "cancel" },
                        { text: "Open Settings", onPress: () => Linking.openSettings() }
                    ]
                );
            }

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

            const sub = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 5000,
                    distanceInterval: 5,
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
            
            // Start Dead Reckoning Watchdog
            drIntervalRef.current = setInterval(performDeadReckoningStep, 2000);
        } else {
            setSignalStatus('searching');
        }

        return () => {
            if (fgSubscriber) fgSubscriber.remove();
            if (drIntervalRef.current) clearInterval(drIntervalRef.current);
            if (!driver?.is_online) {
                Location.stopLocationUpdatesAsync('LOCATION_TRACKING').catch(() => { });
            }
        };
    }, [driver?.is_online]);

    // ── Dead Reckoning Algorithm ──────────────────────────────────────────────
    const performDeadReckoningStep = () => {
        const now = Date.now();
        const diff = now - lastUpdateTimestampRef.current;
        
        // Anti-Ocean-Trajectory Guard: Do not extrapolate if silent for more than 30s
        if (diff > 30000) return;

        if (diff > SIGNAL_TIMEOUT_MS && lastLocationRef.current) {
            setSignalStatus('dead_reckoning');
            
            // Extrapolate position based on last known velocity
            const v = velocityRef.current;
            const a = accelRef.current;
            
            // Deceleration detection: If accelerometer 'Z' or 'Y' (depending on mounting) 
            // drops significantly, we assume the car slowed down.
            // Simplified: if sqrt(x^2 + y^2) is low, car is likely stopped.
            const force = Math.sqrt(a.x * a.x + a.y * a.y);
            const friction = force < 0.2 ? 0.3 : 0.95; // Drastically slow down if nearly no G-force detected

            const newLat = lastLocationRef.current.coords.latitude + (v.dx * (diff / 1000)) * friction;
            const newLng = lastLocationRef.current.coords.longitude + (v.dy * (diff / 1000)) * friction;

            const extrapolatedLoc: any = {
                ...lastLocationRef.current,
                coords: {
                    ...lastLocationRef.current.coords,
                    latitude: newLat,
                    longitude: newLng,
                    accuracy: 999, // Flag as approximate
                },
                timestamp: now
            };
            
            handleLocationUpdate(extrapolatedLoc, true);
        }
    };

    const handleLocationUpdate = async (newLoc: Location.LocationObject, isExtrapolated = false) => {
        const now = Date.now();
        const lastLoc = lastLocationRef.current;
        const lastTime = lastUpdateTimestampRef.current;

        const lat = parseFloat(newLoc.coords.latitude.toFixed(6));
        const lng = parseFloat(newLoc.coords.longitude.toFixed(6));
        const heading = newLoc.coords.heading || 0;

        if (!isExtrapolated) {
            setSignalStatus('lock');
            
            // Jump detection (GPS Noise Filter)
            if (lastLoc) {
                const dist = getDistanceFromLatLonInM(lastLoc.coords.latitude, lastLoc.coords.longitude, lat, lng);
                if (dist > MAX_JUMP_METERS && (now - lastTime) < MIN_TIME_DIFF_MS) return;
                
                // Update Velocity Vector (lat/lng change per second)
                const timeSec = (now - lastTime) / 1000;
                if (timeSec > 0) {
                    velocityRef.current = {
                        dx: (lat - lastLoc.coords.latitude) / timeSec,
                        dy: (lng - lastLoc.coords.longitude) / timeSec
                    };
                }
            }
            prevLocationRef.current = lastLoc;
        }

        setLocation(newLoc);
        lastLocationRef.current = newLoc;
        lastUpdateTimestampRef.current = now;

        if (user?.id) {
            // Push update to backend (standard queue logic)
            queueLocationUpdate(user.id, lat, lng, heading);
        }
    };

    const queueLocationUpdate = async (userId: string, lat: number, lng: number, heading: number) => {
        const update = { lat, lng, heading, ts: Date.now() };
        try {
            const stored = await AsyncStorage.getItem(QUEUE_KEY);
            let queue = stored ? JSON.parse(stored) : [];
            queue.push(update);
            if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE);
            await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
            
            const res = await updateDriverLocation(userId, lat, lng, heading);
            if (res.ok) await AsyncStorage.removeItem(QUEUE_KEY);
        } catch (err) {
            console.warn('[GPS Queue] Sync fail:', err);
        }
    };

    // ── Background Flush Heartbeat ───────────────────────────────────────────
    useEffect(() => {
        if (!driver?.is_online) return;
        const interval = setInterval(async () => {
            if (isFlushing.current || !user?.id) return;
            isFlushing.current = true;
            try {
                const stored = await AsyncStorage.getItem(QUEUE_KEY);
                if (stored) {
                    const queue = JSON.parse(stored);
                    if (queue.length > 0) {
                        const latest = queue[queue.length - 1];
                        const res = await updateDriverLocation(user.id, latest.lat, latest.lng, latest.heading);
                        if (res.ok) await AsyncStorage.removeItem(QUEUE_KEY);
                    }
                }
            } finally {
                isFlushing.current = false;
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [driver?.is_online, user?.id]);

    return { location, signalStatus, errorMsg };
}

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
    var R = 6371;
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000;
}

function deg2rad(deg: number) { return deg * (Math.PI / 180); }
