import React, { useEffect, useState, useCallback } from 'react';
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
import { LegalScreen } from './src/screens/LegalScreen';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../../shared/supabase';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineBanner } from './src/components/OfflineBanner';
import { ENV } from '../../shared/env';
import { OutboxService } from '../../shared/OutboxService';
import { StripeProvider } from '@stripe/stripe-react-native';

// ── Free Background Location using expo-location ───────────────────────────────
const LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
const UPDATE_LOCATION_URL = `${ENV.SUPABASE_URL}/functions/v1/update_driver_location`;

// Define background location task using expo-task-manager + expo-location (free alternative)
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: { data?: any, error?: any }) => {
    if (error) {
        console.error(`[LOCATION_TASK] Error: ${error.message}`);
        return;
    }
    if (data) {
        const locations = data.locations as Location.LocationObject[];
        const location = locations[0];
        if (location) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;

                const activeRideId = await AsyncStorage.getItem('active_ride_id');

                await fetch(UPDATE_LOCATION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        lat: parseFloat(location.coords.latitude.toFixed(6)),
                        lng: parseFloat(location.coords.longitude.toFixed(6)),
                        heading: location.coords.heading || 0,
                        accuracy: location.coords.accuracy,
                        active_ride_id: activeRideId || undefined,
                        is_background: true
                    }),
                });
            } catch (err) {
                console.warn('[LOCATION_TASK] Sync failed:', err);
            }
        }
    }
});

async function startBackgroundLocationTracking() {
    try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
        if (!hasStarted) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK, {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 30000, // Update every 30 seconds
                distanceInterval: 50, // Or every 50 meters
                foregroundService: {
                    notificationTitle: "G-Taxi Driver",
                    notificationBody: "Location tracking active",
                    notificationColor: '#FFD700',
                },
                pausesUpdatesAutomatically: false,
            });
            console.log('[Location] Background tracking started');
        }
    } catch (err) {
        console.warn('[Location] Could not start background tracking:', err);
    }
}

const Stack = createNativeStackNavigator();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Sentry is disabled for now to prevent native boot-time crashes in APK builds
const Sentry: any = { wrap: (comp: any) => comp, init: () => { } };

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
    const [scheduledEnabled, setScheduledEnabled] = useState(false);

    const checkActiveRide = useCallback(async () => {
        if (!user) {
            setInitialRoute('Dashboard');
            return;
        }

        try {
            const { data: driverRecord } = await supabase
                .from('drivers')
                .select('id, status')
                .eq('user_id', user.id)
                .maybeSingle();

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
                await AsyncStorage.setItem('active_ride_id', data.id);
                setInitialRoute('ActiveTrip');
            } else {
                await AsyncStorage.removeItem('active_ride_id');
                setInitialRoute('Dashboard');
            }
        } catch (err) {
            console.warn('Boot check failed:', err);
            await AsyncStorage.removeItem('active_ride_id');
            setInitialRoute('Dashboard');
        }
    }, [user]);

    useEffect(() => {
        checkActiveRide();

        // Check scheduled rides feature flag
        supabase.from('system_feature_flags')
            .select('is_enabled')
            .eq('flag_name', 'scheduled_rides_enabled')
            .maybeSingle()
            .then(({ data }) => setScheduledEnabled(data?.is_enabled ?? false));

        // Real-time listener for status changes (e.g. Admin Approval)
        if (user) {
            const channel = supabase
                .channel(`driver-status-${user.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'drivers',
                        filter: `user_id=eq.${user.id}`,
                    },
                    () => {
                        console.log('Driver status updated in real-time. Refreshing check...');
                        checkActiveRide();
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [user, checkActiveRide]);

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
            {scheduledEnabled && (
                <Stack.Screen name="ScheduledRides" component={ScheduledRidesScreen} />
            )}
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="StrategySettings" component={StrategySettingsScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
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
        startBackgroundLocationTracking();
        OutboxService.getInstance().processQueue();
    }, []);

    return (
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ENV.STRIPE_PUBLISHABLE_KEY}>
            <SafeAreaProvider>
                <ErrorBoundary>
                    <AuthProvider>
                        <View style={{ flex: 1 }}>
                            <OfflineBanner />
                            <NavigationContainer>
                                <StatusBar style="dark" />
                                <RootNavigator />
                            </NavigationContainer>
                        </View>
                    </AuthProvider>
                </ErrorBoundary>
            </SafeAreaProvider>
        </StripeProvider>
    );
}

export default isExpoGo ? App : Sentry.wrap(App);
