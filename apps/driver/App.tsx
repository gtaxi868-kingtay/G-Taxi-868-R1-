import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ActivityIndicator, View, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { OutboxService } from '@g868/shared/OutboxService';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TripRequestScreen } from './src/screens/TripRequestScreen';
import { ActiveTripScreen } from './src/screens/ActiveTripScreen';
import { DeliveryRequestScreen } from './src/screens/DeliveryRequestScreen';
import { ActiveDeliveryScreen } from './src/screens/ActiveDeliveryScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ScheduledRidesScreen } from './src/screens/ScheduledRidesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { PendingApprovalScreen } from './src/screens/PendingApprovalScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { StrategySettingsScreen } from './src/screens/StrategySettingsScreen';
import { LegalScreen } from './src/screens/LegalScreen';
import { ReportIssueScreen } from './src/screens/ReportIssueScreen';
import ComplianceDocumentsScreen from './src/screens/ComplianceDocumentsScreen';
import { RatingsScreen } from './src/screens/RatingsScreen';
import { ScoutReferralScreen } from './src/screens/ScoutReferralScreen';
import { DriverReferralScreen } from './src/screens/DriverReferralScreen';
import { VehicleSalesScreen } from './src/screens/VehicleSalesScreen';
import LeaseScreen from './src/screens/LeaseScreen';
import LeaseConsentScreen from './src/screens/LeaseConsentScreen';
import GGarageScreen from './src/screens/GGarageScreen';
import { CommanderDashboardScreen } from './src/screens/CommanderDashboardScreen';
import { CommanderConsoleScreen } from './src/screens/CommanderConsoleScreen';
import { CommanderRegisterNodeScreen } from './src/screens/CommanderRegisterNodeScreen';
import { BecomeCommanderScreen } from './src/screens/BecomeCommanderScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineBanner } from './src/components/OfflineBanner';
import { DriverActiveRideRestorationHandler } from './src/components/DriverActiveRideRestorationHandler';
import { installCrashReporter } from '@gtaxi/core';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';


const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const SentryMock: any = { wrap: (comp: any) => comp, init: () => { } };
let Sentry = SentryMock;

if (!isExpoGo) {
    try {
        const dsn = ENV.SENTRY_DSN || process.env.EXPO_PUBLIC_SENTRY_DSN;
        if (!dsn || dsn.includes('placeholder')) {
            console.warn('[Sentry] SENTRY_DSN is missing or still set to placeholder. Crash reporting disabled.');
        } else {
            Sentry = require('@sentry/react-native');
            Sentry.init({
                dsn,
                enabled: process.env.APP_ENV === 'production',
                enableInExpoDevelopment: true,
                debug: __DEV__,
                environment: process.env.APP_ENV || 'development',
            });
        }
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
        <>
            <DriverActiveRideRestorationHandler />
            <AppStack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
            <AppStack.Screen name="Dashboard" component={DashboardScreen} />
            <AppStack.Screen name="PendingApproval" component={PendingApprovalScreen} />
            <AppStack.Screen name="TripRequest" component={TripRequestScreen} />
            <AppStack.Screen
                name="ActiveTrip"
                component={ActiveTripScreen}
                initialParams={activeRideId ? { rideId: activeRideId } : undefined}
            />
            <AppStack.Screen name="DeliveryRequest" component={DeliveryRequestScreen} />
            <AppStack.Screen name="ActiveDelivery" component={ActiveDeliveryScreen} />
            <AppStack.Screen name="Earnings" component={EarningsScreen} />
            <AppStack.Screen name="Wallet" component={WalletScreen} />
            <AppStack.Screen name="ScheduledRides" component={ScheduledRidesScreen} />
            <AppStack.Screen name="Profile" component={ProfileScreen} />
            <AppStack.Screen name="Chat" component={ChatScreen} />
            <AppStack.Screen name="StrategySettings" component={StrategySettingsScreen} />
            <AppStack.Screen name="Legal" component={LegalScreen} />
            <AppStack.Screen name="ReportIssue" component={ReportIssueScreen} />
            <AppStack.Screen name="ComplianceDocuments" component={ComplianceDocumentsScreen} />
            <AppStack.Screen name="Ratings" component={RatingsScreen} />
            <AppStack.Screen name="ScoutReferral" component={ScoutReferralScreen} />
            <AppStack.Screen name="DriverReferral" component={DriverReferralScreen} />
            <AppStack.Screen name="VehicleSales" component={VehicleSalesScreen} />
            <AppStack.Screen name="Lease" component={LeaseScreen} />
            <AppStack.Screen name="LeaseConsent" component={LeaseConsentScreen} />
            <AppStack.Screen name="GGarage" component={GGarageScreen} />
            <AppStack.Screen name="CommanderDashboard" component={CommanderDashboardScreen} />
            <AppStack.Screen name="CommanderConsole" component={CommanderConsoleScreen} />
            <AppStack.Screen name="CommanderRegisterNode" component={CommanderRegisterNodeScreen} />
            <AppStack.Screen name="BecomeCommander" component={BecomeCommanderScreen} />
        </AppStack.Navigator>
        </>);
}

function RootNavigator() {
    const { user, loading } = useAuth();
    if (loading) return null;
    return user ? <AppNavigator /> : <AuthNavigator />;
}

function App() {
    const [fontsLoaded, fontError] = useFonts({
        CormorantGaramond_500Medium,
        CormorantGaramond_600SemiBold,
    });
    const [fontTimedOut, setFontTimedOut] = useState(false);

    useEffect(() => {
        installCrashReporter();
        OutboxService.getInstance().processQueue();
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web' || fontsLoaded || fontError) return;
        const timer = setTimeout(() => setFontTimedOut(true), 2500);
        return () => clearTimeout(timer);
    }, [fontsLoaded, fontError]);

    // On web, useFonts can hang without ever resolving loaded or error — bail out after
    // a short timeout so the app doesn't sit behind a blank screen forever.
    if (!fontsLoaded && !fontError && !fontTimedOut) {
        return <View style={{ flex: 1, backgroundColor: '#08090D' }} />;
    }

    return (
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ENV.STRIPE_PUBLISHABLE_KEY}>
            <SafeAreaProvider>
                <ErrorBoundary>
                    <AuthProvider>
                        <View style={{ flex: 1 }}>
                            <OfflineBanner />
                            <NavigationContainer linking={{
                                prefixes: ['gtaxi-driver://'],
                                config: {
                                    screens: {
                                        CommanderDashboard: 'commander',
                                        CommanderConsole: 'commander-console',
                                        CommanderRegisterNode: 'commander-register-node'
                                    }
                                }
                            }}>
                                <StatusBar style="light" />
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
