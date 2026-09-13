import { useState, useEffect, useRef } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer } from 'expo-sensors';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { updateDriverLocation } from '../services/api';

const LOCATION_TASK_NAME = 'G_TAXI_BACKGROUND_LOCATION_ENGINE';
const MAX_JUMP_METERS = 150;
const MIN_TIME_DIFF_MS = 3000;
const SIGNAL_TIMEOUT_MS = 10000;
const DISTANCE_FILTER_METERS = 3;
const TIME_INTERVAL_MS = 5000;

export type SignalStatus = 'searching' | 'lock' | 'dead_reckoning' | 'denied';

let isTaskDefined = false;
if (!isTaskDefined) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
    if (error) return;
    if (data?.locations?.[0]) {
      const loc = data.locations[0];
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      try {
        await updateDriverLocation(
          session.user.id,
          parseFloat(loc.coords.latitude.toFixed(6)),
          parseFloat(loc.coords.longitude.toFixed(6)),
          loc.coords.heading || 0,
          loc.coords.speed || 0
        );
      } catch (_err) {
        // Update fails silently — next update will retry
      }
    }
  });
  isTaskDefined = true;
}

export function useLocationTracking() {
  const { driver, user } = useAuth();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [signalStatus, setSignalStatus] = useState<SignalStatus>('searching');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);
  const prevLocationRef = useRef<Location.LocationObject | null>(null);
  const lastUpdateTimestampRef = useRef<number>(0);
  const velocityRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const accelRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const drIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fgWatchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!driver?.is_online) return;

    Accelerometer.setUpdateInterval(500);
    const accelSub = Accelerometer.addListener(data => {
      accelRef.current = data;
    });

    const init = async () => {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        setErrorMsg('Foreground location permission denied');
        setSignalStatus('denied');
        Alert.alert(
          "Location Required",
          "G-Taxi needs your location to match you with riders. Enable it in Settings.",
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
      }

      try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!hasStarted) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: TIME_INTERVAL_MS,
            distanceInterval: DISTANCE_FILTER_METERS,
            foregroundService: {
              notificationTitle: "G-TAXI Dispatch Engine Online",
              notificationBody: "Streaming production GPS data to marketplace core...",
              notificationColor: "#00FFFF",
            },
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
          });
        }
      } catch (_err) {
        console.warn('Background location task failed to start');
      }

      const watchSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: TIME_INTERVAL_MS,
          distanceInterval: DISTANCE_FILTER_METERS,
        },
        handleLocationUpdate
      );
      fgWatchRef.current = watchSub;
    };

    init();

    drIntervalRef.current = setInterval(performDeadReckoningStep, 2000);

    return () => {
      accelSub.remove();
      if (fgWatchRef.current) fgWatchRef.current.remove();
      if (drIntervalRef.current) clearInterval(drIntervalRef.current);
      if (!driver?.is_online) {
        Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
      }
    };
  }, [driver?.is_online]);

  const performDeadReckoningStep = () => {
    const now = Date.now();
    const diff = now - lastUpdateTimestampRef.current;
    if (diff > 30000) return;
    if (diff > SIGNAL_TIMEOUT_MS && lastLocationRef.current) {
      setSignalStatus('dead_reckoning');
      const v = velocityRef.current;
      const a = accelRef.current;
      const force = Math.sqrt(a.x * a.x + a.y * a.y);
      const friction = force < 0.2 ? 0.3 : 0.95;
      const newLat = lastLocationRef.current.coords.latitude + (v.dx * (diff / 1000)) * friction;
      const newLng = lastLocationRef.current.coords.longitude + (v.dy * (diff / 1000)) * friction;
      const extrapolatedLoc: any = {
        ...lastLocationRef.current,
        coords: {
          ...lastLocationRef.current.coords,
          latitude: newLat,
          longitude: newLng,
          accuracy: 999,
        },
        timestamp: now,
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

    if (lastLoc && !isExtrapolated) {
      const dist = getDistanceFromLatLonInM(lastLoc.coords.latitude, lastLoc.coords.longitude, lat, lng);
      if (dist < DISTANCE_FILTER_METERS) return;
    }

    if (!isExtrapolated) {
      setSignalStatus('lock');
      if (lastLoc) {
        const dist = getDistanceFromLatLonInM(lastLoc.coords.latitude, lastLoc.coords.longitude, lat, lng);
        if (dist > MAX_JUMP_METERS && (now - lastTime) < MIN_TIME_DIFF_MS) return;
        const timeSec = (now - lastTime) / 1000;
        if (timeSec > 0) {
          velocityRef.current = {
            dx: (lat - lastLoc.coords.latitude) / timeSec,
            dy: (lng - lastLoc.coords.longitude) / timeSec,
          };
        }
      }
      prevLocationRef.current = lastLoc;
    }

    setLocation(newLoc);
    lastLocationRef.current = newLoc;
    lastUpdateTimestampRef.current = now;

    if (user?.id) {
      try {
        await updateDriverLocation(user.id, lat, lng, heading, newLoc.coords.speed || 0);
      } catch (_err) {
        // Update fails silently — next update retries
      }
    }
  };

  return { location, signalStatus, errorMsg };
}

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deg2rad(deg: number) { return deg * (Math.PI / 180); }
