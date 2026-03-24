import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TripRequestScreen } from './src/screens/TripRequestScreen';
import { ActiveTripScreen } from './src/screens/ActiveTripScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ScheduledRidesScreen } from './src/screens/ScheduledRidesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { PendingApprovalScreen } from './src/screens/PendingApprovalScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { StrategySettingsScreen } from './src/screens/StrategySettingsScreen';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../../shared/supabase';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ENV } from '../../shared/env';
import { OutboxService } from '../../shared/OutboxService';

// ── Phase 5 Fix 5.7: Background retry task for offline ride completions ────────
const RETRY_TASK = 'OFFLINE_COMPLETION_RETRY';
const COMPLETE_RIDE_URL = `${ENV.SUPABASE_URL}/functions/v1/complete_ride`;

TaskManager.defineTask(RETRY_TASK, async () => {
    try {
        const pending = await AsyncStorage.getItem('pending_completions');
        if (!pending) return BackgroundFetch.BackgroundFetchResult.NoData;

        const completions: Array<{ ride_id: string; driver_lat: number; driver_lng: number }> = JSON.parse(pending);
        if (completions.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return BackgroundFetch.BackgroundFetchResult.Failed;

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
                    }
                } else {
                    remaining.push(item);
                }
            } catch (err) {
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

async function registerBackgroundRetryTask() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(RETRY_TASK);
        if (!isRegistered) {
            await BackgroundFetch.registerTaskAsync(RETRY_TASK, {
                minimumInterval: 30,
                stopOnTerminate: false,
                startOnBoot: true,
            });
            console.log('[BackgroundFetch] Registered OFFLINE_COMPLETION_RETRY task.');
        }
    } catch (err) {
        console.warn('[BackgroundFetch] Could not register retry task:', err);
    }
}

const Stack = createNativeStackNavigator();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Safe dynamic providers
let Sentry: any = { wrap: (comp: any) => comp, init: () => { } };

if (!isExpoGo) {
    try {
        Sentry = require('@sentry/react-native');
        Sentry.init({
            dsn: 'https://fd1b20b3e7e9a18f89380de9537867ff@o4510426117767168.ingest.us.sentry.io/4510969904300032',
            environment: __DEV__ ? 'development' : 'production',
            tracesSampleRate: __DEV__ ? 0.0 : 0.2,
            enableNative: true,
            debug: __DEV__,
        });
    } catch (e) {
        console.warn('Sentry failed to load in non-expo-go env', e);
    }
}

function AuthNavigator() {
    return (
        <Stack.Navigator id="AuthStack" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
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
                const { data: driverRecord } = await supabase
                    .from('drivers')
                    .select('id, status')
                    .eq('user_id', user.id)
                    .single();

                if (!driverRecord) {
                    setInitialRoute('Dashboard');
                    return;
                }

                if (driverRecord.status === 'pending') {
                    setInitialRoute('PendingApproval');
                    return;
                }

                const { data } = await supabase
                    .from('rides')
                    .select('id')
                    .eq('driver_id', driverRecord.id)
                    .in('status', ['assigned', 'arrived', 'in_progress'])
                    .maybeSingle();

                if (data) {
                    setActiveRideId(data.id);
                    setInitialRoute('ActiveTrip');
                } else {
                    setInitialRoute('Dashboard');
                }
            } catch (err) {
                console.warn('Boot check failed:', err);
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
        <Stack.Navigator id="AppStack" initialRouteName={initialRoute as any} screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="PendingApproval" component={PendingApprovalScreen} />
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
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="StrategySettings" component={StrategySettingsScreen} />
        </Stack.Navigator>
    );
}

function RootNavigator() {
    const { user, loading } = useAuth();
    if (loading) return null;
    return user ? <AppNavigator /> : <AuthNavigator />;
}

function App() {
    useEffect(() => {
        registerBackgroundRetryTask();
        OutboxService.getInstance().processQueue();
    }, []);

    return (
        <SafeAreaProvider>
            <ErrorBoundary>
                <AuthProvider>
                    <NavigationContainer>
                        <StatusBar style="dark" />
                        <RootNavigator />
                    </NavigationContainer>
                </AuthProvider>
            </ErrorBoundary>
        </SafeAreaProvider>
    );
}

export default isExpoGo ? App : Sentry.wrap(App);
