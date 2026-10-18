import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@gtaxi/core';

// Phase 1 analytics, phone side. Only three events are ever sent from the
// phone; everything else (booked, cancelled, completed...) is recorded by
// the server at the moment it happens. Nothing else is sent: no location,
// no device details. The server takes the user from the sign-in and
// rate-limits; a failure here is ignored and never affects the app.
export type PhoneEvent = 'rider_app_opened' | 'rider_destination_searched' | 'rider_referral_shared';

export function logAppEvent(event: PhoneEvent): void {
    supabase.rpc('log_app_event', { p_event: event }).then(() => {}, () => {});
}

// "Opened the app": when it comes to the front, at most once per 30 minutes.
const OPEN_THROTTLE_MS = 30 * 60 * 1000;
let lastOpenLoggedAt = 0;

export function useAppOpenedLogger(signedIn: boolean): void {
    useEffect(() => {
        if (!signedIn) return;
        const maybeLog = () => {
            const now = Date.now();
            if (now - lastOpenLoggedAt < OPEN_THROTTLE_MS) return;
            lastOpenLoggedAt = now;
            logAppEvent('rider_app_opened');
        };
        maybeLog();
        const sub = AppState.addEventListener('change', (s) => { if (s === 'active') maybeLog(); });
        return () => sub.remove();
    }, [signedIn]);
}
