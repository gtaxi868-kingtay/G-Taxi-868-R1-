import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useNetInfo } from '@react-native-community/netinfo';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';

const ACTIVE_STATES = ['assigned', 'arrived', 'in_progress'];

// Brings the driver back to a live trip when the app returns to the front,
// and once when this mounts. Same rules as the start-up check in App.tsx:
// any live trip is restored no matter how old it is (a driver whose phone
// died overnight still has a trip to finish or close), newest first, never
// maybeSingle. If this layer fails, the home screen's trip card is the
// visible way back — nothing here is the only door.
export function DriverActiveRideRestorationHandler() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const netInfo = useNetInfo();
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const restoreActiveRide = async () => {
      if (!mountedRef.current) return;
      if (!user) return;
      if (!netInfo.isConnected) return;

      try {
        const { data: driverRecord } = await supabase
          .from('drivers')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!driverRecord) return;

        const { data: rides } = await supabase
          .from('rides')
          .select('id, status, updated_at')
          .eq('driver_id', driverRecord.id)
          .in('status', ACTIVE_STATES)
          .order('updated_at', { ascending: false })
          .limit(1);

        const ride = rides?.[0];
        if (!ride) return;

        const currentRoute = navigation.getState()?.routes[navigation.getState()?.index];
        if (
          currentRoute?.name === 'ActiveTrip' &&
          currentRoute?.params?.rideId === ride.id
        ) {
          return;
        }

        navigation.reset({
          index: 0,
          routes: [
            {
              name: 'ActiveTrip',
              params: { rideId: ride.id },
            },
          ],
        });
      } catch {
        // Silent fallback — the home screen trip card covers failures here.
      }
    };

    restoreActiveRide();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        restoreActiveRide();
      }
    });

    return () => appStateSub.remove();
  }, [user, netInfo.isConnected, navigation]);

  return null;
}
