import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

interface LocationData {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

export function useLocationTracking(enabled: boolean = true) {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Location permission denied'); return; }
      const current = await Location.getCurrentPositionAsync({});
      if (mounted) setLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (pos) => { if (mounted) setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); }
      );
    })();
    return () => { mounted = false; watchRef.current?.remove(); };
  }, [enabled]);

  return { location, error };
}
