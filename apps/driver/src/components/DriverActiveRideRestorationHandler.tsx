import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useNetInfo } from '@react-native-community/netinfo';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';

const ACTIVE_STATES = ['assigned', 'arrived', 'in_progress'];
const RIDE_TTL_MINUTES = 30;

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

        const { data: ride } = await supabase
          .from('rides')
          .select('id, status, updated_at')
          .eq('driver_id', driverRecord.id)
          .in('status', ACTIVE_STATES)
          .order('updated_at', { ascending: false })
          .maybeSingle();

        if (!ride) return;

        if (ride.status !== 'in_progress') {
          const updatedAt = new Date(ride.updated_at);
          const now = new Date();
          const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

          if (minutesSinceUpdate > RIDE_TTL_MINUTES) {
            return;
          }
        }

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
        // Silent fallback — offline or query error
      }
    };

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        restoreActiveRide();
      }
    });

    return () => appStateSub.remove();
  }, [user, netInfo.isConnected, navigation]);

  return null;
}
