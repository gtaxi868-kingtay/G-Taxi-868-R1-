import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';

// Auth Screens
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';

// App Screens
import { HomeScreen } from './src/screens/HomeScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { DestinationSearchScreen } from './src/screens/DestinationSearchScreen';
import { RideConfirmationScreen } from './src/screens/RideConfirmationScreen';
import { SearchingDriverScreen } from './src/screens/SearchingDriverScreen';
import { ActiveRideScreen } from './src/screens/ActiveRideScreen';
import { RatingScreen } from './src/screens/RatingScreen';

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
        </AppStack.Navigator>
    );
}

// Root navigator that switches between auth and app
function RootNavigator() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#00D084" />
            </View>
        );
    }

    return user ? <AppNavigator /> : <AuthNavigator />;
}

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <NavigationContainer>
                    <StatusBar style="light" />
                    <RootNavigator />
                </NavigationContainer>
            </AuthProvider>
        </QueryClientProvider>
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
