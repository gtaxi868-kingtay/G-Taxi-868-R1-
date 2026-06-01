import React from 'react';
import { View, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TagMarkerScreen } from './src/screens/TagMarkerScreen';
import { RegisterPuckScreen } from './src/screens/RegisterPuckScreen';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={{ headerShown: false }}>
      <AppStack.Screen name="Dashboard" component={DashboardScreen} />
      <AppStack.Screen name="TagMarker" component={TagMarkerScreen} />
      <AppStack.Screen name="RegisterPuck" component={RegisterPuckScreen} />
    </AppStack.Navigator>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: SURFACE.base, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={VOICES.admin.accent} />
      </View>
    );
  }
  return user ? <AppNavigator /> : <AuthNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <View style={{ flex: 1 }}>
          <StatusBar barStyle="light-content" />
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
