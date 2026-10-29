import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { Nunito_800ExtraBold, Nunito_900Black } from '@expo-google-fonts/nunito';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ActivityIndicator, View, Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { supabase } from '@gtaxi/core';
import { ENV } from '@g868/shared/env';
import { OutboxService } from '@g868/shared/OutboxService';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { DriverTabs } from './src/navigation/DriverTabs';
import { MoodProvider } from './src/ui/kit';
import { TripRequestScreen } from './src/screens/TripRequestScreen';
import { ActiveTripScreen } from './src/screens/ActiveTripScreen';
import { DeliveryRequestScreen } from './src/screens/DeliveryRequestScreen';
import { ActiveDeliveryScreen } from './src/screens/ActiveDeliveryScreen';
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
import { NetworksScreen } from './src/screens/NetworksScreen';
import { VehicleSalesScreen } from './src/screens/VehicleSalesScreen';
import LeaseScreen from './src/screens/LeaseScreen';
import LeaseConsentScreen from './src/screens/LeaseConsentScreen';
import GGarageScreen from './src/screens/GGarageScreen';
import { CommanderDashboardScreen } from './src/screens/CommanderDashboardScreen';
import { CommanderConsoleScreen } from './src/screens/CommanderConsoleScreen';
import { CommanderRegisterNodeScreen } from './src/screens/CommanderRegisterNodeScreen';
import { BecomeCommanderScreen } from './src/screens/BecomeCommanderScreen';
import { CashWithdrawalScreen } from './src/screens/CashWithdrawalScreen';
import { RedeemCashCodeScreen } from './src/screens/RedeemCashCodeScreen';
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
                .select('id, status, verified_status')
                .eq('user_id', user.id)
                .maybeSingle();

            if (!driverRecord) {
                setInitialRoute('Dashboard');
                return;
            }

            // A live trip outranks everything else here, including the
            // approval gate: a driver mid-trip must always land back on the
            // trip screen. Newest first, never maybeSingle — with two active
            // rows maybeSingle errors and the trip reads as "no trip".
            const { data: activeRides, error: rideError } = await supabase
                .from('rides')
                .select('id')
                .eq('driver_id', driverRecord.id)
                .in('status', ['assigned', 'arrived', 'in_progress'])
                .order('updated_at', { ascending: false })
                .limit(1);

            if (!rideError && activeRides && activeRides.length > 0) {
                setActiveRideId(activeRides[0].id);
                await AsyncStorage.setItem('active_ride_id', activeRides[0].id);
                setInitialRoute('ActiveTrip');
                return;
            }

            if (rideError) {
                // The check itself failed (signal, server). Fall back to the
                // last trip this phone knew about — the trip screen verifies
                // the ride and leaves on its own if it is finished. A failed
                // check must never erase the saved trip.
                const savedRideId = await AsyncStorage.getItem('active_ride_id').catch(() => null);
                if (savedRideId) {
                    setActiveRideId(savedRideId);
                    setInitialRoute('ActiveTrip');
                    return;
                }
            }

            // Approval lives in verified_status. drivers.status is only
            // online/offline/busy (CHECK), so the old status === 'pending'
            // test never matched and new drivers landed on the dashboard.
            if (driverRecord.verified_status === 'pending' || driverRecord.verified_status === 'unverified') {
                setInitialRoute('PendingApproval');
                return;
            }

            await AsyncStorage.removeItem('active_ride_id');
            setInitialRoute('Dashboard');
        } catch (_err) {
            // Same rule as a failed ride check: a saved trip beats a blank
            // dashboard. Land on Dashboard only when nothing is saved.
            const savedRideId = await AsyncStorage.getItem('active_ride_id').catch(() => null);
            if (savedRideId) {
                setActiveRideId(savedRideId);
                setInitialRoute('ActiveTrip');
            } else {
                setInitialRoute('Dashboard');
            }
        }
    }, [user]);

    useEffect(() => {
        checkActiveRide();

        // Re-check when the app comes back to the front. This used to listen to
        // the driver's own row, which changes on every location update -- each
        // ping came back as a live message and triggered two more reads.
        if (user) {
            const sub = AppState.addEventListener('change', (next) => {
                if (next === 'active') checkActiveRide();
            });
            return () => sub.remove();
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
            {/* Dashboard is the tab home: Drive · Earnings · Wallet · You */}
            <AppStack.Screen name="Dashboard" component={DriverTabs} />
            <AppStack.Screen name="PendingApproval" component={PendingApprovalScreen} />
            <AppStack.Screen name="TripRequest" component={TripRequestScreen} />
            <AppStack.Screen
                name="ActiveTrip"
                component={ActiveTripScreen}
                initialParams={activeRideId ? { rideId: activeRideId } : undefined}
            />
            <AppStack.Screen name="DeliveryRequest" component={DeliveryRequestScreen} />
            <AppStack.Screen name="ActiveDelivery" component={ActiveDeliveryScreen} />
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
            <AppStack.Screen name="Networks" component={NetworksScreen} />
            <AppStack.Screen name="VehicleSales" component={VehicleSalesScreen} />
            <AppStack.Screen name="Lease" component={LeaseScreen} />
            <AppStack.Screen name="LeaseConsent" component={LeaseConsentScreen} />
            <AppStack.Screen name="GGarage" component={GGarageScreen} />
            <AppStack.Screen name="CommanderDashboard" component={CommanderDashboardScreen} />
            <AppStack.Screen name="CommanderConsole" component={CommanderConsoleScreen} />
            <AppStack.Screen name="CommanderRegisterNode" component={CommanderRegisterNodeScreen} />
            <AppStack.Screen name="BecomeCommander" component={BecomeCommanderScreen} />
            <AppStack.Screen name="CashWithdrawal" component={CashWithdrawalScreen} />
            <AppStack.Screen name="RedeemCashCode" component={RedeemCashCodeScreen} />
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
        Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
        Nunito_800ExtraBold, Nunito_900Black,
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
                        <MoodProvider>
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
                        </MoodProvider>
                    </AuthProvider>
                </ErrorBoundary>
            </SafeAreaProvider>
        </StripeProvider>
    );
}

export default isExpoGo ? App : Sentry.wrap(App);
