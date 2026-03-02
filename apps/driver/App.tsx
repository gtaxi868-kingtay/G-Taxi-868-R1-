import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TripRequestScreen } from './src/screens/TripRequestScreen';
import { ActiveTripScreen } from './src/screens/ActiveTripScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ScheduledRidesScreen } from './src/screens/ScheduledRidesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../../shared/supabase';
import { ErrorBoundary } from './src/components/ErrorBoundary';

// ── Phase 5 Fix 5.7: Background retry task for offline ride completions ────────
// When the driver loses connectivity at the moment of completion, the complete_ride
// call is queued in AsyncStorage under 'pending_completions'. This background task
// retries all queued completions every 30 seconds, even when the app is backgrounded.
const RETRY_TASK = 'OFFLINE_COMPLETION_RETRY';
const COMPLETE_RIDE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/complete_ride`;

TaskManager.defineTask(RETRY_TASK, async () => {
    try {
        const pending = await AsyncStorage.getItem('pending_completions');
        if (!pending) return BackgroundFetch.BackgroundFetchResult.NoData;

        const completions: Array<{ ride_id: string; driver_lat: number; driver_lng: number }> = JSON.parse(pending);
        if (completions.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            // Not authenticated — can't retry, leave pending items for later.
            return BackgroundFetch.BackgroundFetchResult.Failed;
        }

        const remaining: typeof completions = [];

        for (const item of completions) {
            try {
                const res = await fetch(COMPLETE_RIDE_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify(item),
                });

                if (res.ok) {
                    const json = await res.json();
                    if (json.success) {
                        console.log(`[RETRY_TASK] Ride ${item.ride_id} completed successfully on retry.`);
                        // Successfully completed — do not add back to remaining.
                    } else {
                        // Server rejected (e.g. ride already completed) — discard.
                        console.warn(`[RETRY_TASK] Ride ${item.ride_id} rejected by server:`, json.error);
                    }
                } else {
                    // Network or server error — keep for next retry.
                    console.warn(`[RETRY_TASK] HTTP ${res.status} for ride ${item.ride_id} — requeueing.`);
                    remaining.push(item);
                }
            } catch (err) {
                // Network error — requeue.
                console.warn(`[RETRY_TASK] Network error for ride ${item.ride_id} — requeueing:`, err);
                remaining.push(item);
            }
        }

        await AsyncStorage.setItem('pending_completions', JSON.stringify(remaining));

        return remaining.length < completions.length
            ? BackgroundFetch.BackgroundFetchResult.NewData
            : BackgroundFetch.BackgroundFetchResult.NoData;

    } catch (err) {
        console.error('[RETRY_TASK] Unexpected error:', err);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

// ── Register the background task on app startup ───────────────────────────────
async function registerBackgroundRetryTask() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(RETRY_TASK);
        if (!isRegistered) {
            await BackgroundFetch.registerTaskAsync(RETRY_TASK, {
                minimumInterval: 30,      // seconds — OS may delay beyond this
                stopOnTerminate: false,   // continue after app swipe-close on Android
                startOnBoot: true,        // restart after device reboot
            });
            console.log('[BackgroundFetch] Registered OFFLINE_COMPLETION_RETRY task.');
        }
    } catch (err) {
        // BackgroundFetch is not available on all platforms (e.g. web builds)
        console.warn('[BackgroundFetch] Could not register retry task:', err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator();

function AuthNavigator() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
    );
}

function AppNavigator() {
    const { user } = useAuth();
    const [initialRoute, setInitialRoute] = useState<string | null>(null);
    const [activeRideId, setActiveRideId] = useState<string | undefined>();

    useEffect(() => {
        async function checkActiveRide() {
            if (!user) {
                setInitialRoute('Dashboard');
                return;
            }

            try {
                const { data } = await supabase
                    .from('rides')
                    .select('id')
                    .eq('driver_id', user.id)
                    .in('status', ['assigned', 'arrived', 'in_progress'])
                    .maybeSingle();

                if (data) {
                    setActiveRideId(data.id);
                    setInitialRoute('ActiveTrip');
                } else {
                    setInitialRoute('Dashboard');
                }
            } catch (err) {
                console.warn('Silent failure on boot check:', err);
                setInitialRoute('Dashboard');
            }
        }
        checkActiveRide();
    }, [user]);

    if (!initialRoute) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    return (
        <Stack.Navigator initialRouteName={initialRoute as any} screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="TripRequest" component={TripRequestScreen} />
            <Stack.Screen
                name="ActiveTrip"
                component={ActiveTripScreen}
                initialParams={activeRideId ? { rideId: activeRideId } : undefined}
            />
            <Stack.Screen name="Earnings" component={EarningsScreen} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
            <Stack.Screen name="ScheduledRides" component={ScheduledRidesScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
        </Stack.Navigator>
    );
}

function RootNavigator() {
    const { user, loading } = useAuth();

    if (loading) {
        return null; // Or Splash
    }

    return user ? <AppNavigator /> : <AuthNavigator />;
}

Sentry.init({
    dsn: 'https://fd1b20b3e7e9a18f89380de9537867ff@o4510426117767168.ingest.us.sentry.io/4510969904300032',
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 0.0 : 0.2,
    enableNative: true,
    debug: __DEV__,
});

function App() {
    useEffect(() => {
        // Register the offline completion retry task as early as possible.
        registerBackgroundRetryTask();
    }, []);

    return (
        <ErrorBoundary>
            <AuthProvider>
                <NavigationContainer>
                    <StatusBar style="dark" />
                    <RootNavigator />
                </NavigationContainer>
            </AuthProvider>
        </ErrorBoundary>
    );
}

export default Sentry.wrap(App);
