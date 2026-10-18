import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

// The admin app is the G Guardian's phone. raise_admin_alert (every SOS,
// and every "STILL UNANSWERED" escalation) pushes to admins whose
// profiles.push_token is an Expo token — but this app never registered one,
// so no SOS ever reached an admin phone. Called once an admin is verified.
//
// Registration used to fail silently (the caller did `.catch(() => {})` and
// every failure path returned null), so a guardian could believe their phone
// was receiving SOS alerts when it was not. Every outcome is now reported
// with a reason the app shows to the guardian.

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

export type GuardianPushFailure = 'not_a_device' | 'permission_denied' | 'no_token' | 'save_failed';

export type GuardianPushResult =
    | { ok: true; token: string }
    | { ok: false; reason: GuardianPushFailure; detail?: string };

// Plain-English explanation for each failure, shown in the warning banner.
export const GUARDIAN_PUSH_MESSAGES: Record<GuardianPushFailure, string> = {
    not_a_device: 'This is a simulator, not a real phone, so it cannot receive SOS alerts.',
    permission_denied: 'Notifications are turned off for this app. Turn them on in Settings to receive SOS alerts.',
    no_token: 'This phone could not get a push address. Check the internet connection and try again.',
    save_failed: 'This phone could not be saved as a guardian phone. Check the internet connection and try again.',
};

async function attemptRegistration(userId: string): Promise<GuardianPushResult> {
    if (!Device.isDevice) return { ok: false, reason: 'not_a_device' };

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
        status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return { ok: false, reason: 'permission_denied' };

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'SOS and urgent alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 250, 500, 250, 500],
            sound: 'default',
            bypassDnd: true,
        });
    }

    let token: string;
    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (err) {
        console.error('registerGuardianPush: could not get push token:', err);
        return { ok: false, reason: 'no_token', detail: String(err) };
    }

    const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
    if (error) {
        console.error('registerGuardianPush: could not save token:', error.message);
        return { ok: false, reason: 'save_failed', detail: error.message };
    }
    return { ok: true, token };
}

const RETRY_DELAYS_MS = [2000, 5000];

// Tries up to 3 times. Failures that a retry cannot fix (simulator,
// notifications turned off) return immediately.
export async function registerGuardianPush(userId: string): Promise<GuardianPushResult> {
    let last: GuardianPushResult = { ok: false, reason: 'no_token' };
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
            last = await attemptRegistration(userId);
        } catch (err) {
            console.error('registerGuardianPush: unexpected error:', err);
            last = { ok: false, reason: 'no_token', detail: String(err) };
        }
        if (last.ok || last.reason === 'not_a_device' || last.reason === 'permission_denied') return last;
        if (attempt < RETRY_DELAYS_MS.length) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
    }
    return last;
}
