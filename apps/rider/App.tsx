import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ENV } from '../../shared/env';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RideProvider } from './src/context/RideContext';
import { OutboxService } from '../../shared/OutboxService';
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Auth Screens
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';

// App Screens
import { HomeScreen } from './src/screens/HomeScreen';
import { AnimatedSplash } from './src/components/AnimatedSplash';
import { ProfileScreen } from './src/screens/ProfileScreen';
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
import { VisionScannerScreen } from './src/screens/VisionScannerScreen';
import { LaundryLandingScreen } from './src/screens/LaundryLandingScreen';
import { LaundryEstimatorScreen } from './src/screens/LaundryEstimatorScreen';
import { LaundryOrderStatusScreen } from './src/screens/LaundryOrderStatusScreen';
import { DriverFoundScreen } from './src/screens/DriverFoundScreen';
import { NfcHandshakeScreen } from './src/screens/NfcHandshakeScreen';
import { ServiceBookingScreen } from './src/screens/ServiceBookingScreen';
import { LegalScreen } from './src/screens/LegalScreen';
import { ActiveRideRestorationHandler } from './src/components/ActiveRideRestorationHandler';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OfflineBanner } from './src/components/OfflineBanner';

const AuthStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();
const queryClient = new QueryClient();

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const isWeb = Platform.OS === 'web';

// Safe dynamic providers - DISABLED in release builds to prevent Metro bundler issues
// Sentry and Stripe will be enabled in Phase 10
const StripeProvider: any = ({ children }: any) => <>{children}</>;
const Sentry: any = { wrap: (comp: any) => comp, init: () => { } };

// Auth screens (for logged-out users)
function AuthNavigator() {
    return (
        <AuthStack.Navigator
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#000' },
                animation: 'slide_from_right',
            }}
        >
            <AuthStack.Screen name="Login" component={LoginScreen} />
            <AuthStack.Screen name="Signup" component={SignupScreen} />
        </AuthStack.Navigator>
    );
}

// Main app screens (for logged-in users)
function AppNavigator() {
    return (
        <>
            <ActiveRideRestorationHandler />
            <AppStack.Navigator
                screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: '#000' },
                    animation: 'slide_from_right',
                }}
            >
                <AppStack.Screen name="Home" component={HomeScreen} />
                <AppStack.Screen name="Profile" component={ProfileScreen} />
                <AppStack.Screen name="DestinationSearch" component={DestinationSearchScreen} />
                <AppStack.Screen name="RideConfirmation" component={RideConfirmationScreen} />
                <AppStack.Screen name="SearchingDriver" component={SearchingDriverScreen} />
                <AppStack.Screen name="ActiveRide" component={ActiveRideScreen as any} />
                <AppStack.Screen name="Rating" component={RatingScreen} />
                <AppStack.Screen name="Trips" component={TripsScreen} />
                <AppStack.Screen name="EditProfile" component={EditProfileScreen} />
                <AppStack.Screen name="Settings" component={SettingsScreen} />
                <AppStack.Screen name="Payment" component={PaymentScreen} />
                <AppStack.Screen name="Wallet" component={WalletScreen} />
                <AppStack.Screen name="WalletTopUp" component={WalletTopUpScreen} />
                <AppStack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
                <AppStack.Screen name="Help" component={HelpScreen} />
                <AppStack.Screen name="Receipt" component={ReceiptScreen} />
                <AppStack.Screen name="Promo" component={PromoScreen} />
                <AppStack.Screen name="Chat" component={ChatScreen} />
                <AppStack.Screen name="AISettings" component={AISettingsScreen} />
                {/* Grocery Vertical */}
                <AppStack.Screen name="GroceryStorefront" component={GroceryStorefrontScreen} />
                <AppStack.Screen name="ProductListing" component={ProductListingScreen} />
                <AppStack.Screen name="ProductDetail" component={ProductDetailScreen} />
                <AppStack.Screen name="GroceryCart" component={GroceryCartScreen} />
                <AppStack.Screen name="VisionScanner" component={VisionScannerScreen} />
                {/* Laundry Vertical */}
                <AppStack.Screen name="LaundryLanding" component={LaundryLandingScreen} />
                <AppStack.Screen name="LaundryEstimator" component={LaundryEstimatorScreen} />
                <AppStack.Screen name="LaundryOrderStatus" component={LaundryOrderStatusScreen} />
                {/* Driver Found Confirmation */}
                <AppStack.Screen name="DriverFound" component={DriverFoundScreen} />
                <AppStack.Screen name="NfcHandshake" component={NfcHandshakeScreen} />
                <AppStack.Screen name="ServiceBooking" component={ServiceBookingScreen} />
                <AppStack.Screen name="Legal" component={LegalScreen} />
            </AppStack.Navigator>
        </>
    );
}

// Root navigator that switches between auth and app
function RootNavigator() {
    const { user, loading } = useAuth();

    if (loading) {
        return <AnimatedSplash onFinish={() => { }} />;
    }

    return user ? <RideProvider><AppNavigator /></RideProvider> : <AuthNavigator />;
}

// FIX 5: Deep link handling for QR codes
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
      }
    }
  }
};

function App() {
    React.useEffect(() => {
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

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000',
    },
});

export default (isExpoGo || isWeb) ? App : Sentry.wrap(App);
