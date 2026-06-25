import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
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
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

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
    <View style={styles.unauthorized}>
      <View style={styles.lockIcon}>
        <Text style={styles.lockEmoji}>🔐</Text>
      </View>
      <Text style={styles.deniedTitle}>Access Denied</Text>
      <Text style={styles.deniedDesc}>
        You do not have admin privileges. Sign in with an admin account.
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
    supabase.functions.invoke('admin', { body: { action: 'get_flags' } })
      .then(() => setAdminState('authorized'))
      .catch(() => setAdminState('unauthorized'));
  }, [user]);

  if (loading || (user && adminState === 'checking')) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>
          {!user ? 'Initializing...' : 'Verifying credentials...'}
        </Text>
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
          <View style={{ flex: 1, backgroundColor: BG }}>
            <StatusBar barStyle="light-content" backgroundColor={BG} />
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </View>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
  },
  unauthorized: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${ACCENT}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  lockEmoji: {
    fontSize: 32,
  },
  deniedTitle: {
    color: '#F1F5F9',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  deniedDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
