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

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

export async function registerGuardianPush(userId: string): Promise<string | null> {
    if (!Device.isDevice) return null;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
        status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'SOS and urgent alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 250, 500, 250, 500],
            sound: 'default',
            bypassDnd: true,
        });
    }

    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
        if (error) {
            console.error('registerGuardianPush: could not save token:', error.message);
            return null;
        }
        return token;
    } catch (err) {
        console.error('registerGuardianPush: could not get push token:', err);
        return null;
    }
}
