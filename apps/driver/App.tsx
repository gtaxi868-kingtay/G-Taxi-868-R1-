import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { supabase } from '@gtaxi/core';
import { ENV } from '@gtaxi/shared/env';
import { OutboxService } from '@gtaxi/shared/OutboxService';
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
import { ReportIssueScreen } from './src/screens/ReportIssueScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineBanner } from './src/components/OfflineBanner';
import { installCrashReporter } from '@gtaxi/core';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';

const LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';
const UPDATE_LOCATION_URL = `${ENV.SUPABASE_URL}/functions/v1/update_driver_location`;

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: { data?: any; error?: any }) => {
    if (error) return;
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
            } catch (_err) { /* silent */ }
        }
    }
});

async function startBackgroundLocationTracking() {
    try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
        if (!hasStarted) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK, {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 30000,
                distanceInterval: 50,
                foregroundService: {
                    notificationTitle: "G-Taxi Driver",
                    notificationBody: "Location tracking active",
                    notificationColor: VOICES.driver.accent,
                },
                pausesUpdatesAutomatically: false,
            });
        }
    } catch (_err) { /* silent */ }
}

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const SentryMock: any = { wrap: (comp: any) => comp, init: () => { } };
let Sentry = SentryMock;

if (!isExpoGo) {
    try {
        Sentry = require('@sentry/react-native');
        Sentry.init({
            dsn: ENV.SENTRY_DSN || 'https://placeholder@sentry.io/123456',
            enabled: process.env.APP_ENV === 'production',
            enableInExpoDevelopment: true,
            debug: __DEV__,
            environment: process.env.APP_ENV || 'development',
        });
    } catch (_e) { /* silent */ }
}

function AuthNavigator() {
    return (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
            <AuthStack.Screen name="Login" component={LoginScreen} />
            <AuthStack.Screen name="Register" component={RegisterScreen} />
        </AuthStack.Navigator>
    );
}

function AppNavigator() {
    const { user } = useAuth();
    const [initialRoute, setInitialRoute] = useState<keyof AppStackParamList | null>(null);
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
        } catch (_err) {
            await AsyncStorage.removeItem('active_ride_id');
            setInitialRoute('Dashboard');
        }
    }, [user]);

    useEffect(() => {
        checkActiveRide();

        supabase.from('system_feature_flags')
            .select('id, is_active')
            .in('id', ['scheduled_rides_enabled', 'kiosk_active'])
            .then(({ data }) => {
                if (data) {
                    for (const flag of data) {
                        if (flag.id === 'scheduled_rides_enabled') {
                            setScheduledEnabled(flag.is_active);
                        }
                    }
                }
            });

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
                    () => { checkActiveRide(); }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    }, [user, checkActiveRide]);

    if (!initialRoute) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: SURFACE.base }}>
                <ActivityIndicator size="large" color={VOICES.driver.accent} />
            </View>
        );
    }

    return (
        <AppStack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
            <AppStack.Screen name="Dashboard" component={DashboardScreen} />
            <AppStack.Screen name="PendingApproval" component={PendingApprovalScreen} />
            <AppStack.Screen name="TripRequest" component={TripRequestScreen} />
            <AppStack.Screen
                name="ActiveTrip"
                component={ActiveTripScreen}
                initialParams={activeRideId ? { rideId: activeRideId } : undefined}
            />
            <AppStack.Screen name="Earnings" component={EarningsScreen} />
            <AppStack.Screen name="Wallet" component={WalletScreen} />
            {scheduledEnabled && (
                <AppStack.Screen name="ScheduledRides" component={ScheduledRidesScreen} />
            )}
            <AppStack.Screen name="Profile" component={ProfileScreen} />
            <AppStack.Screen name="Chat" component={ChatScreen} />
            <AppStack.Screen name="StrategySettings" component={StrategySettingsScreen} />
            <AppStack.Screen name="Legal" component={LegalScreen} />
            <AppStack.Screen name="ReportIssue" component={ReportIssueScreen} />
        </AppStack.Navigator>
    );
}

function RootNavigator() {
    const { user, loading } = useAuth();
    if (loading) return null;
    return user ? <AppNavigator /> : <AuthNavigator />;
}

function App() {
    useEffect(() => {
        installCrashReporter();
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
