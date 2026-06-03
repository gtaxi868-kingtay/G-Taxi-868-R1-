import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { initializeSupabaseClient } from '@gtaxi/core';
const { supabase } = initializeSupabaseClient('native');
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ErrorBoundary } from '@gtaxi/shared';
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

function UnauthorizedScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: SURFACE.base, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Access Denied</Text>
      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginTop: 12 }}>
        You do not have admin privileges. Please sign in with an admin account.
      </Text>
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const [adminState, setAdminState] = useState<'checking' | 'authorized' | 'unauthorized'>('checking');

  useEffect(() => {
    if (!user) {
      setAdminState('unauthorized');
      return;
    }
    supabase.functions.invoke('admin_get_flags')
      .then(() => setAdminState('authorized'))
      .catch(() => setAdminState('unauthorized'));
  }, [user]);

  if (loading || (user && adminState === 'checking')) {
    return (
      <View style={{ flex: 1, backgroundColor: SURFACE.base, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={VOICES.admin.accent} />
      </View>
    );
  }
  if (!user) return <AuthNavigator />;
  if (adminState !== 'authorized') return <UnauthorizedScreen />;
  return <AppNavigator />;
}

export default function App() {
  return (
    <ErrorBoundary moduleName="AdminMobile">
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
    </ErrorBoundary>
  );
}
