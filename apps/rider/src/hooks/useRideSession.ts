import { useEffect, useRef, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import type { LocationObject } from 'expo-location';

interface UseRideSessionOptions {
    rideId: string;
    rideStatus: string | undefined;
    driverId: string | undefined;
    location: LocationObject | null;
    aiSuggestionsEnabled: boolean;
    onDriverLocationUpdate: (lat: number, lng: number) => void;
    onSignalStatusChange: (status: 'ok' | 'stale' | 'lost') => void;
    onAiInsight: (message: string) => void;
}

export function useRideSession({
    rideId,
    rideStatus,
    driverId,
    location,
    aiSuggestionsEnabled,
    onDriverLocationUpdate,
    onSignalStatusChange,
    onAiInsight,
}: UseRideSessionOptions) {
    const lastLocationUpdateRef = useRef<number>(Date.now());
    const signalCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const driverChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const currentSignalStatus = useRef<'ok' | 'stale' | 'lost'>('ok');

    const attachDriverChannel = useCallback(() => {
        if (!driverId || driverChannelRef.current) return;

        driverChannelRef.current = supabase
            .channel(`driver_loc_${driverId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driverId}` },
                (payload: any) => {
                    onDriverLocationUpdate(payload.new.lat, payload.new.lng);
                    lastLocationUpdateRef.current = Date.now();
                    if (currentSignalStatus.current !== 'ok') {
                        currentSignalStatus.current = 'ok';
                        onSignalStatusChange('ok');
                    }
                }
            )
            .subscribe();
    }, [driverId, onDriverLocationUpdate, onSignalStatusChange]);

    const detachDriverChannel = useCallback(() => {
        if (driverChannelRef.current) {
            supabase.removeChannel(driverChannelRef.current);
            driverChannelRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!driverId) return;
        attachDriverChannel();
        return detachDriverChannel;
    }, [driverId, attachDriverChannel, detachDriverChannel]);

    // Signal staleness: 15s check, escalates stale→lost
    useEffect(() => {
        if (!driverId) return;

        signalCheckIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - lastLocationUpdateRef.current;
            if (elapsed > 180_000 && currentSignalStatus.current !== 'lost') {
                currentSignalStatus.current = 'lost';
                onSignalStatusChange('lost');
            } else if (elapsed > 30_000 && currentSignalStatus.current === 'ok') {
                currentSignalStatus.current = 'stale';
                onSignalStatusChange('stale');
            }
        }, 15_000);

        return () => {
            if (signalCheckIntervalRef.current) clearInterval(signalCheckIntervalRef.current);
        };
    }, [driverId, onSignalStatusChange]);

    // AI concierge poll: every 2 min while in_progress, coordinated with signal check so they don't fire together
    useEffect(() => {
        if (rideStatus !== 'in_progress' || !aiSuggestionsEnabled) return;

        const poll = async () => {
            try {
                const { data } = await supabase.functions.invoke('ai_concierge_proactive', {
                    body: {
                        ride_id: rideId,
                        lat: location?.coords?.latitude,
                        lng: location?.coords?.longitude,
                    },
                });
                if (data?.suggestion) {
                    onAiInsight(data.suggestion);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            } catch {
                // Non-fatal — AI suggestions degrade silently
            }
        };

        // Stagger by 7.5s from the signal check (which fires at 0, 15, 30… s)
        const timer = setTimeout(() => {
            poll();
            const interval = setInterval(poll, 120_000);
            // Capture interval id for cleanup via ref trick
            (timer as any).__interval = interval;
        }, 7_500);

        return () => {
            clearTimeout(timer);
            if ((timer as any).__interval) clearInterval((timer as any).__interval);
        };
    }, [rideStatus, aiSuggestionsEnabled, rideId, location?.coords?.latitude, location?.coords?.longitude, onAiInsight]);

    return { reattachDriverChannel: attachDriverChannel, detachDriverChannel };
}
