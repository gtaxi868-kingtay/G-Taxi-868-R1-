import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TripRequestScreen } from './src/screens/TripRequestScreen';
import { ActiveTripScreen } from './src/screens/ActiveTripScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ScheduledRidesScreen } from './src/screens/ScheduledRidesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

const Stack = createNativeStackNavigator();

function AuthNavigator() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
    );
}

import { useEffect, useState } from 'react';
import { supabase } from '../../shared/supabase'; // We need supabase import
import { ActivityIndicator, View } from 'react-native';

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

export default function App() {
    return (
        <AuthProvider>
            <NavigationContainer>
                <StatusBar style="dark" />
                <RootNavigator />
            </NavigationContainer>
        </AuthProvider>
    );
}
