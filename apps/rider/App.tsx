import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ENV } from '@gtaxi/shared/env';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StripeProvider } from '@stripe/stripe-react-native';
import { OutboxService } from '@gtaxi/shared/OutboxService';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RideProvider } from './src/context/RideContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { SubscriptionScreen } from './src/screens/SubscriptionScreen';
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
import { ReportProblemScreen } from './src/screens/ReportProblemScreen';
import { ReceiptScreen } from './src/screens/ReceiptScreen';
import { SavedPlacesScreen } from './src/screens/SavedPlacesScreen';
import { PromoScreen } from './src/screens/PromoScreen';
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
import { TagMarkerScreen } from './src/screens/TagMarkerScreen';
import RideReviewScreen from './src/screens/RideReviewScreen';
import { ServiceBookingScreen } from './src/screens/ServiceBookingScreen';
import { LegalScreen } from './src/screens/LegalScreen';
import { TravelStorefrontScreen } from './src/screens/TravelStorefrontScreen';
import { TravelPackageDetailScreen } from './src/screens/TravelPackageDetailScreen';
import { TravelBookingConfirmationScreen } from './src/screens/TravelBookingConfirmationScreen';
import { TravelMyBookingsScreen } from './src/screens/TravelMyBookingsScreen';
import { TravelWaitlistScreen } from './src/screens/TravelWaitlistScreen';
import { ReferralScreen } from './src/screens/ReferralScreen';
import { FoodDeliveryScreen } from './src/screens/FoodDeliveryScreen';
import EscapeStorefrontScreen from './src/screens/EscapeStorefrontScreen';
import EscapeCheckoutScreen from './src/screens/EscapeCheckoutScreen';
import ActivePassScreen from './src/screens/ActivePassScreen';
import PassportSubmissionScreen from './src/screens/PassportSubmissionScreen';
import CarnivalScreen from './src/screens/CarnivalScreen';
import EventsScreen from './src/screens/EventsScreen';
import { BecomeCommanderScreen } from './src/screens/BecomeCommander';
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

function AuthNavigator() {
    return (
        <AuthStack.Navigator
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: SURFACE.base },
                animation: 'slide_from_right',
            }}
        >
            <AuthStack.Screen name="Login" component={LoginScreen} />
            <AuthStack.Screen name="Signup" component={SignupScreen} />
            <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </AuthStack.Navigator>
    );
}

function AppNavigator() {
    return (
        <>
            <ActiveRideRestorationHandler />
            <AppStack.Navigator
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: SURFACE.base },
                    animation: 'slide_from_right',
                }}
            >
                <AppStack.Screen name="Home" component={HomeScreen} />
                <AppStack.Screen name="Profile" component={ProfileScreen} />
                <AppStack.Screen name="Subscription" component={SubscriptionScreen} />
                <AppStack.Screen name="Notifications" component={NotificationsScreen} />
                <AppStack.Screen name="DestinationSearch" component={DestinationSearchScreen} />
                <AppStack.Screen name="RideConfirmation" component={RideConfirmationScreen} />
                <AppStack.Screen name="RideReview" component={RideReviewScreen} />
                <AppStack.Screen name="SearchingDriver" component={SearchingDriverScreen} />
                <AppStack.Screen name="ActiveRide" component={ActiveRideScreen} />
                <AppStack.Screen name="Rating" component={RatingScreen} />
                <AppStack.Screen name="Trips" component={TripsScreen} />
                <AppStack.Screen name="EditProfile" component={EditProfileScreen} />
                <AppStack.Screen name="Settings" component={SettingsScreen} />
                <AppStack.Screen name="Payment" component={PaymentScreen} />
                <AppStack.Screen name="Wallet" component={WalletScreen} />
                <AppStack.Screen name="WalletTopUp" component={WalletTopUpScreen} />
                <AppStack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
                <AppStack.Screen name="Help" component={HelpScreen} />
                <AppStack.Screen name="ReportProblem" component={ReportProblemScreen} />
                <AppStack.Screen name="Receipt" component={ReceiptScreen} />
                <AppStack.Screen name="Promo" component={PromoScreen} />
                <AppStack.Screen name="Chat" component={ChatScreen} />
                <AppStack.Screen name="AISettings" component={AISettingsScreen} />
                <AppStack.Screen name="GroceryStorefront" component={GroceryStorefrontScreen} />
                <AppStack.Screen name="ProductListing" component={ProductListingScreen} />
                <AppStack.Screen name="ProductDetail" component={ProductDetailScreen} />
                <AppStack.Screen name="GroceryCart" component={GroceryCartScreen} />
                <AppStack.Screen name="GroceryOrderStatus" component={GroceryOrderStatusScreen} />
                <AppStack.Screen name="VisionScanner" component={VisionScannerScreen} />
                <AppStack.Screen name="LaundryLanding" component={LaundryLandingScreen} />
                <AppStack.Screen name="LaundryEstimator" component={LaundryEstimatorScreen} />
                <AppStack.Screen name="LaundryOrderStatus" component={LaundryOrderStatusScreen} />
                <AppStack.Screen name="DriverFound" component={DriverFoundScreen} />
                <AppStack.Screen name="NfcHandshake" component={NfcHandshakeScreen} />
                <AppStack.Screen name="NfcScan" component={NfcScanScreen} />
                <AppStack.Screen name="TagMarker" component={TagMarkerScreen} />
                <AppStack.Screen name="ServiceBooking" component={ServiceBookingScreen} />
                <AppStack.Screen name="Legal" component={LegalScreen} />
                <AppStack.Screen name="TravelStorefront" component={TravelStorefrontScreen} />
                <AppStack.Screen name="TravelPackageDetail" component={TravelPackageDetailScreen} />
                <AppStack.Screen name="TravelBookingConfirmation" component={TravelBookingConfirmationScreen} />
                <AppStack.Screen name="TravelMyBookings" component={TravelMyBookingsScreen} />
                <AppStack.Screen name="TravelWaitlist" component={TravelWaitlistScreen} />
                <AppStack.Screen name="Referral" component={ReferralScreen} />
                <AppStack.Screen name="FoodDelivery" component={FoodDeliveryScreen} />
                <AppStack.Screen name="EscapeStorefront" component={EscapeStorefrontScreen} />
                <AppStack.Screen name="EscapeCheckout" component={EscapeCheckoutScreen} />
                <AppStack.Screen name="ActivePass" component={ActivePassScreen} />
                <AppStack.Screen name="PassportSubmission" component={PassportSubmissionScreen} />
                <AppStack.Screen name="Carnival" component={CarnivalScreen} />
                <AppStack.Screen name="Events" component={EventsScreen} />
                <AppStack.Screen name="BecomeCommander" component={BecomeCommanderScreen} />
            </AppStack.Navigator>
        </>
    );
}

function RootNavigator() {
    const { user, loading } = useAuth();
    if (loading) return <AnimatedSplash onFinish={() => { }} />;
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
            TravelPackageDetail: 'travel/:packageId',
            BecomeCommander: 'become-commander',
        }
    }
};

function App() {
    useEffect(() => {
        installCrashReporter();
        OutboxService.getInstance().processQueue();
    }, []);

    const content = (
        <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ErrorBoundary>
                        <View style={{ flex: 1 }}>
                            <OfflineBanner />
                            <NavigationContainer linking={linking}>
                                <StatusBar style="light" />
                                <RootNavigator />
                            </NavigationContainer>
                        </View>
                    </ErrorBoundary>
                </AuthProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    );

    if (isExpoGo || isWeb) return content;

    return (
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ENV.STRIPE_PUBLISHABLE_KEY}>
            {content}
        </StripeProvider>
    );
}

export default (isExpoGo || isWeb) ? App : SentryMock.wrap(App);
