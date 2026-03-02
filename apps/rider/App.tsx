import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as Sentry from '@sentry/react-native';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RideProvider } from './src/context/RideContext';

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

import { ActiveRideRestorationHandler } from './src/components/ActiveRideRestorationHandler';
import { ErrorBoundary } from './src/components/ErrorBoundary';

const AuthStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();
const queryClient = new QueryClient();

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
                <AppStack.Screen name="ActiveRide" component={ActiveRideScreen} />
                <AppStack.Screen name="Rating" component={RatingScreen} />
                <AppStack.Screen name="Trips" component={TripsScreen} />
                <AppStack.Screen name="EditProfile" component={EditProfileScreen} />
                <AppStack.Screen name="Settings" component={SettingsScreen} />
                <AppStack.Screen name="Payment" component={PaymentScreen} />
                <AppStack.Screen name="Wallet" component={WalletScreen} />
                <AppStack.Screen name="SavedPlaces" component={SavedPlacesScreen} />
                <AppStack.Screen name="Help" component={HelpScreen} />
                <AppStack.Screen name="Receipt" component={ReceiptScreen} />
                <AppStack.Screen name="Promo" component={PromoScreen} />
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

Sentry.init({
    dsn: 'https://afd7d5ee7d0738270ee71a61c7890b01@o4510426117767168.ingest.us.sentry.io/4510969876447232',
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 0.0 : 0.2,
    enableNative: true,
    debug: __DEV__,
});

function App() {
    return (
        <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ErrorBoundary>
                        <NavigationContainer>
                            <StatusBar style="light" />
                            <RootNavigator />
                        </NavigationContainer>
                    </ErrorBoundary>
                </AuthProvider>
            </QueryClientProvider>
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

export default Sentry.wrap(App);
