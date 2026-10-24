import React, { useEffect, useState } from 'react';
import './global.css';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import {
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { applyGlobalFont } from './src/theme/typography';
import { ToastHost } from './src/components/Toast';
import { HomePreview } from './src/screens/design/HomePreview';
import { MoodPreview } from './src/screens/design/MoodPreview';
import { GALLERY_PARAMS } from './src/screens/design/galleryParams';
import { MoodProvider, useTheme } from './src/ui/kit';

// Every Text/TextInput gets Manrope at the right weight (see typography.ts).
applyGlobalFont();
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ENV } from '@g868/shared/env';
import { useAppOpenedLogger } from './src/services/analytics';
import { usePendingDriverCode } from './src/services/driverCode';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StripeProvider } from '@stripe/stripe-react-native';
import { OutboxService } from '@g868/shared/OutboxService';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RideProvider } from './src/context/RideContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { SubscriptionScreen } from './src/screens/SubscriptionScreen';
import { GSpotScreen } from './src/screens/GSpotScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AnimatedSplash } from './src/components/AnimatedSplash';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { DestinationSearchScreen } from './src/screens/DestinationSearchScreen';
import { RideConfirmationScreen } from './src/screens/RideConfirmationScreen';
import { SearchingDriverScreen } from './src/screens/SearchingDriverScreen';
import { ActiveRideScreen } from './src/screens/ActiveRideScreen';
import { EditProfileScreen } from './src/screens/EditProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PaymentScreen } from './src/screens/PaymentScreen';
import { RatingScreen } from './src/screens/RatingScreen';
import { TripsScreen } from './src/screens/TripsScreen';
import { HelpScreen } from './src/screens/HelpScreen';
import { PromoScreen } from './src/screens/PromoScreen';
import { ReportProblemScreen } from './src/screens/ReportProblemScreen';
import { ReceiptScreen } from './src/screens/ReceiptScreen';
import { SavedPlacesScreen } from './src/screens/SavedPlacesScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { WalletTopUpScreen } from './src/screens/WalletTopUpScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { AISettingsScreen } from './src/screens/AISettingsScreen';
import { GroceryStorefrontScreen } from './src/screens/GroceryStorefrontScreen';
import { ProductListingScreen } from './src/screens/ProductListingScreen';
import { ProductDetailScreen } from './src/screens/ProductDetailScreen';
import { GroceryCartScreen } from './src/screens/GroceryCartScreen';
import { GroceryOrderStatusScreen } from './src/screens/GroceryOrderStatusScreen';
import { VisionScannerScreen } from './src/screens/VisionScannerScreen';
import { LaundryLandingScreen } from './src/screens/LaundryLandingScreen';
import { LaundryEstimatorScreen } from './src/screens/LaundryEstimatorScreen';
import { LaundryOrderStatusScreen } from './src/screens/LaundryOrderStatusScreen';
import { DriverFoundScreen } from './src/screens/DriverFoundScreen';
import { NfcHandshakeScreen } from './src/screens/NfcHandshakeScreen';
import { NfcScanScreen } from './src/screens/NfcScanScreen';
import { NfcPayScreen } from './src/screens/NfcPayScreen';
import { TagMarkerScreen } from './src/screens/TagMarkerScreen';
import RideReviewScreen from './src/screens/RideReviewScreen';
import { ServiceBookingScreen } from './src/screens/ServiceBookingScreen';
import { LegalScreen } from './src/screens/LegalScreen';
import { ReferralScreen } from './src/screens/ReferralScreen';
import { FoodDeliveryScreen } from './src/screens/FoodDeliveryScreen';
import EscapeStorefrontScreen from './src/screens/EscapeStorefrontScreen';
import EscapeCheckoutScreen from './src/screens/EscapeCheckoutScreen';
import ActivePassScreen from './src/screens/ActivePassScreen';
import PassportSubmissionScreen from './src/screens/PassportSubmissionScreen';
import CarnivalScreen from './src/screens/CarnivalScreen';
import EventsScreen from './src/screens/EventsScreen';
import { CashWithdrawalScreen } from './src/screens/CashWithdrawalScreen';


import { EscapeTripProvider } from './src/context/EscapeContext';
import { ActiveRideRestorationHandler } from './src/components/ActiveRideRestorationHandler';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineBanner } from './src/components/OfflineBanner';
import { installCrashReporter } from '@gtaxi/core';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const queryClient = new QueryClient();

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isWeb = Platform.OS === 'web';

const SentryMock: any = { wrap: (comp: any) => comp, init: () => { } };
let Sentry = SentryMock;

if (!isExpoGo && !isWeb) {
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

function AuthNavigator({ initialRoute }: { initialRoute?: any } = {}) {
    const m = useTheme();
    return (
        <AuthStack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: m.page },
                animation: 'slide_from_right',
            }}
        >
            <AuthStack.Screen name="Login" component={LoginScreen} />
            <AuthStack.Screen name="Signup" component={SignupScreen} />
            <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </AuthStack.Navigator>
    );
}

function AppNavigator({ initialRoute }: { initialRoute?: any } = {}) {
    const m = useTheme();
    const p = (name: string) => (initialRoute === name ? GALLERY_PARAMS[name] : undefined);
    return (
        <>
            {!initialRoute && <ActiveRideRestorationHandler />}
            <AppStack.Navigator
                initialRouteName={initialRoute}
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: m.page },
                    animation: 'slide_from_right',
                }}
            >
                <AppStack.Screen name="Home" component={HomeScreen} initialParams={p("Home")} />
                <AppStack.Screen name="Profile" component={ProfileScreen} initialParams={p("Profile")} />
                <AppStack.Screen name="Subscription" component={SubscriptionScreen} initialParams={p("Subscription")} />
                <AppStack.Screen name="GSpot" component={GSpotScreen} initialParams={p("GSpot")} />
                <AppStack.Screen name="Notifications" component={NotificationsScreen} initialParams={p("Notifications")} />
                <AppStack.Screen name="DestinationSearch" component={DestinationSearchScreen} initialParams={p("DestinationSearch")} />
                <AppStack.Screen name="RideConfirmation" component={RideConfirmationScreen} initialParams={p("RideConfirmation")} />
                <AppStack.Screen name="RideReview" component={RideReviewScreen} initialParams={p("RideReview")} />
                <AppStack.Screen name="SearchingDriver" component={SearchingDriverScreen} initialParams={p("SearchingDriver")} />
                <AppStack.Screen name="ActiveRide" component={ActiveRideScreen} initialParams={p("ActiveRide")} />
                <AppStack.Screen name="Rating" component={RatingScreen} initialParams={p("Rating")} />
                <AppStack.Screen name="Trips" component={TripsScreen} initialParams={p("Trips")} />
                <AppStack.Screen name="EditProfile" component={EditProfileScreen} initialParams={p("EditProfile")} />
                <AppStack.Screen name="Settings" component={SettingsScreen} initialParams={p("Settings")} />
                <AppStack.Screen name="Payment" component={PaymentScreen} initialParams={p("Payment")} />
                <AppStack.Screen name="Wallet" component={WalletScreen} initialParams={p("Wallet")} />
                <AppStack.Screen name="WalletTopUp" component={WalletTopUpScreen} initialParams={p("WalletTopUp")} />
                <AppStack.Screen name="SavedPlaces" component={SavedPlacesScreen} initialParams={p("SavedPlaces")} />
                <AppStack.Screen name="Help" component={HelpScreen} initialParams={p("Help")} />
                <AppStack.Screen name="ReportProblem" component={ReportProblemScreen} initialParams={p("ReportProblem")} />
                <AppStack.Screen name="Receipt" component={ReceiptScreen} initialParams={p("Receipt")} />
                <AppStack.Screen name="Promo" component={PromoScreen} initialParams={p("Promo")} />
                <AppStack.Screen name="Chat" component={ChatScreen} initialParams={p("Chat")} />
                <AppStack.Screen name="AISettings" component={AISettingsScreen} initialParams={p("AISettings")} />
                <AppStack.Screen name="GroceryStorefront" component={GroceryStorefrontScreen} initialParams={p("GroceryStorefront")} />
                <AppStack.Screen name="ProductListing" component={ProductListingScreen} initialParams={p("ProductListing")} />
                <AppStack.Screen name="ProductDetail" component={ProductDetailScreen} initialParams={p("ProductDetail")} />
                <AppStack.Screen name="GroceryCart" component={GroceryCartScreen} initialParams={p("GroceryCart")} />
                <AppStack.Screen name="GroceryOrderStatus" component={GroceryOrderStatusScreen} initialParams={p("GroceryOrderStatus")} />
                <AppStack.Screen name="VisionScanner" component={VisionScannerScreen} initialParams={p("VisionScanner")} />
                <AppStack.Screen name="LaundryLanding" component={LaundryLandingScreen} initialParams={p("LaundryLanding")} />
                <AppStack.Screen name="LaundryEstimator" component={LaundryEstimatorScreen} initialParams={p("LaundryEstimator")} />
                <AppStack.Screen name="LaundryOrderStatus" component={LaundryOrderStatusScreen} initialParams={p("LaundryOrderStatus")} />
                <AppStack.Screen name="DriverFound" component={DriverFoundScreen} initialParams={p("DriverFound")} />
                <AppStack.Screen name="NfcHandshake" component={NfcHandshakeScreen} initialParams={p("NfcHandshake")} />
                <AppStack.Screen name="NfcScan" component={NfcScanScreen} initialParams={p("NfcScan")} />
                <AppStack.Screen name="NfcPay" component={NfcPayScreen} initialParams={p("NfcPay")} />
                <AppStack.Screen name="TagMarker" component={TagMarkerScreen} initialParams={p("TagMarker")} />
                <AppStack.Screen name="ServiceBooking" component={ServiceBookingScreen} initialParams={p("ServiceBooking")} />
                <AppStack.Screen name="Legal" component={LegalScreen} initialParams={p("Legal")} />
                <AppStack.Screen name="Referral" component={ReferralScreen} initialParams={p("Referral")} />
                <AppStack.Screen name="FoodDelivery" component={FoodDeliveryScreen} initialParams={p("FoodDelivery")} />
                <AppStack.Screen name="EscapeStorefront" component={EscapeStorefrontScreen} initialParams={p("EscapeStorefront")} />
                <AppStack.Screen name="EscapeCheckout" component={EscapeCheckoutScreen} initialParams={p("EscapeCheckout")} />
                <AppStack.Screen name="ActivePass" component={ActivePassScreen} initialParams={p("ActivePass")} />
                <AppStack.Screen name="PassportSubmission" component={PassportSubmissionScreen} initialParams={p("PassportSubmission")} />
                <AppStack.Screen name="Carnival" component={CarnivalScreen} initialParams={p("Carnival")} />
                <AppStack.Screen name="Events" component={EventsScreen} initialParams={p("Events")} />
                <AppStack.Screen name="CashWithdrawal" component={CashWithdrawalScreen} initialParams={p("CashWithdrawal")} />
            </AppStack.Navigator>
        </>
    );
}

function RootNavigator() {
    const { user, loading, passwordRecovery } = useAuth();
    useAppOpenedLogger(!!user);
    usePendingDriverCode(!!user);
    if (loading) return <AnimatedSplash onFinish={() => { }} />;
    if (user && passwordRecovery) return <ResetPasswordScreen />;
    return user ? <RideProvider><EscapeTripProvider><AppNavigator /></EscapeTripProvider></RideProvider> : <AuthNavigator />;
}

const linking = {
    prefixes: ['gtaxi://'],
    config: {
        screens: {
            Home: {
                path: 'request',
                parse: {
                    lat: (lat: string) => parseFloat(lat),
                    lng: (lng: string) => parseFloat(lng),
                    stand: (stand: string) => stand,
                }
            },
            EscapeStorefront: 'escape/:packageId?',
        }
    }
};

function App() {
    const [fontsLoaded, fontError] = useFonts({
        CormorantGaramond_500Medium,
        CormorantGaramond_600SemiBold,
        Manrope_400Regular,
        Manrope_500Medium,
        Manrope_600SemiBold,
        Manrope_700Bold,
        Manrope_800ExtraBold,
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

    // Hold on the brand canvas until the serif is ready; if it errors, render anyway
    // (system-font fallback) so a font hiccup never blocks the app. On web, useFonts can
    // hang without ever resolving loaded or error, so also bail out after a short timeout.
    if (!fontsLoaded && !fontError && !fontTimedOut) {
        return <View style={{ flex: 1, backgroundColor: '#07070F' }} />;
    }

    // Design sample for review (web only): /design-preview
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname === '/design-preview') {
        return (
            <SafeAreaProvider>
                {new URLSearchParams(window.location.search).has('mood') ? <MoodPreview /> : <HomePreview />}
                <ToastHost />
            </SafeAreaProvider>
        );
    }

    // Screen gallery for layout review (web only): /design-preview/screens?s=Home
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname === '/design-preview/screens') {
        const s = new URLSearchParams(window.location.search).get('s') || 'Home';
        const isAuth = s === 'Login' || s === 'Signup' || s === 'ForgotPassword';
        const mq = new URLSearchParams(window.location.search).get('mood');
        return (
            <SafeAreaProvider><MoodProvider force={mq === 'day' || mq === 'night' ? mq : undefined}>
                <QueryClientProvider client={queryClient}>
                    <AuthProvider>
                        <ErrorBoundary>
                            <NavigationContainer>
                                {isAuth ? <AuthNavigator initialRoute={s} /> : (
                                    <RideProvider><EscapeTripProvider><AppNavigator initialRoute={s} /></EscapeTripProvider></RideProvider>
                                )}
                            </NavigationContainer>
                            <ToastHost />
                        </ErrorBoundary>
                    </AuthProvider>
                </QueryClientProvider>
            </MoodProvider></SafeAreaProvider>
        );
    }

    const content = (
        <SafeAreaProvider><MoodProvider>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ErrorBoundary>
                        <View style={{ flex: 1 }}>
                            <OfflineBanner />
                            <NavigationContainer linking={linking}>
                                                                <RootNavigator />
                            </NavigationContainer>
                            <ToastHost />
                        </View>
                    </ErrorBoundary>
                </AuthProvider>
            </QueryClientProvider>
        </MoodProvider></SafeAreaProvider>
    );

    if (isExpoGo || isWeb) return content;

    return (
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ENV.STRIPE_PUBLISHABLE_KEY}>
            {content}
        </StripeProvider>
    );
}

export default (isExpoGo || isWeb) ? App : SentryMock.wrap(App);
