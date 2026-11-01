import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black } from '@expo-google-fonts/nunito';
import { applyGlobalFont } from './src/theme/typography';
import { ToastHost } from './src/components/Toast';
import { MoodProvider, useTheme, Screen, EmptyState, Loading, Txt } from './src/ui/kit';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ErrorBoundary } from '@g868/shared';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TagMarkerScreen } from './src/screens/TagMarkerScreen';
import { RegisterPuckScreen } from './src/screens/RegisterPuckScreen';
import { RevshareSettlementScreen } from './src/screens/RevshareSettlementScreen';
import { CommanderManagementScreen } from './src/screens/CommanderManagementScreen';
import { IntelligenceScreen } from './src/screens/IntelligenceScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { GroundTransitScreen } from './src/screens/GroundTransitScreen';
import { ZoneRatesScreen } from './src/screens/ZoneRatesScreen';
import { PlatformControlScreen } from './src/screens/PlatformControlScreen';
import { IssueKeychainScreen } from './src/screens/IssueKeychainScreen';
import { SosScreen } from './src/screens/SosScreen';
import { registerGuardianPush, GUARDIAN_PUSH_MESSAGES, type GuardianPushResult } from './src/lib/guardianPush';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';

// Every Text/TextInput gets Manrope at the right weight (see typography.ts).
applyGlobalFont();

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const navigationRef = createNavigationContainerRef<AppStackParamList>();
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

function AuthNavigator({ initialRoute }: { initialRoute?: any } = {}) {
  return (
    <AuthStack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator({ initialRoute }: { initialRoute?: any } = {}) {
  const m = useTheme();
  return (
    <AppStack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: m.page }, animation: 'slide_from_right' }}>
      <AppStack.Screen name="Dashboard" component={DashboardScreen} />
      <AppStack.Screen name="Sos" component={SosScreen} />
      <AppStack.Screen name="TagMarker" component={TagMarkerScreen} />
      <AppStack.Screen name="RegisterPuck" component={RegisterPuckScreen} />
      <AppStack.Screen name="RevshareSettlement" component={RevshareSettlementScreen} />
      <AppStack.Screen name="CommanderManagement" component={CommanderManagementScreen} />
      <AppStack.Screen name="Intelligence" component={IntelligenceScreen} />
      <AppStack.Screen name="Approvals" component={ApprovalsScreen} />
      <AppStack.Screen name="PlatformControl" component={PlatformControlScreen} />
      <AppStack.Screen name="IssueKeychain" component={IssueKeychainScreen} />
      <AppStack.Screen name="GroundTransit" component={GroundTransitScreen} />
      <AppStack.Screen name="ZoneRates" component={ZoneRatesScreen} />
    </AppStack.Navigator>
  );
}

function UnauthorizedScreen() {
  return (
    <Screen>
      <EmptyState icon="lock-closed-outline" title="This account is not an admin" body="Sign in with an admin account to use G 868 HQ." />
    </Screen>
  );
}

// Tapping an SOS push opens the SOS desk.
function useOpenSosOnNotificationTap() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data: any = response.notification.request.content.data || {};
      if (data.ride_id || data.log_id || String(response.notification.request.content.title || '').includes('SOS')) {
        if (navigationRef.isReady()) navigationRef.navigate('Sos');
      }
    });
    return () => sub.remove();
  }, []);
}

// Shown on every screen while this phone is NOT registered for SOS alerts.
// A guardian must never believe they are covered when they are not.
function GuardianPushWarning({ result, retrying, onRetry }: {
  result: Extract<GuardianPushResult, { ok: false }>;
  retrying: boolean;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const needsSettings = result.reason === 'permission_denied';
  const canRetry = result.reason !== 'not_a_device';
  return (
    <View style={[styles.pushWarning, { paddingTop: insets.top + 10 }]} accessibilityRole="alert">
      <Text style={styles.pushWarningTitle}>This phone will NOT receive SOS alerts</Text>
      <Text style={styles.pushWarningBody}>{GUARDIAN_PUSH_MESSAGES[result.reason]}</Text>
      {canRetry && (
        <View style={styles.pushWarningActions}>
          {needsSettings && (
            <TouchableOpacity style={styles.pushWarningButton} onPress={() => Linking.openSettings()} accessibilityRole="button">
              <Text style={styles.pushWarningButtonText}>Open Settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.pushWarningButton} onPress={onRetry} disabled={retrying} accessibilityRole="button">
            <Text style={styles.pushWarningButtonText}>{retrying ? 'Trying...' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  useOpenSosOnNotificationTap();
  const [adminState, setAdminState] = useState<'checking' | 'authorized' | 'unauthorized'>('checking');
  const [pushResult, setPushResult] = useState<GuardianPushResult | null>(null);
  const [pushRetrying, setPushRetrying] = useState(false);

  // This phone is a G Guardian: SOS alerts are pushed to it. Registration
  // retries itself; if it still fails, the admin is told plainly, once with
  // an alert and then with a banner that stays until it works.
  const registerPush = useCallback(async (userId: string, announce: boolean) => {
    setPushRetrying(true);
    const result = await registerGuardianPush(userId);
    setPushRetrying(false);
    setPushResult(result);
    if (!result.ok && announce) {
      Alert.alert('SOS alerts are not reaching this phone', GUARDIAN_PUSH_MESSAGES[result.reason]);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setAdminState('unauthorized');
      return;
    }
    // functions.invoke() resolves with { data, error } on a non-2xx response —
    // it does not reject. Checking only .then()/.catch() let any signed-up
    // account (any role) through, since the 403 from a non-admin never
    // surfaced as a rejection.
    supabase.functions.invoke('admin', { body: { action: 'get_flags' } })
      .then(({ error }: { error: unknown }) => {
        if (error) throw error;
        setAdminState('authorized');
        registerPush(user.id, true);
      })
      .catch(() => setAdminState('unauthorized'));
  }, [user]);

  if (loading || (user && adminState === 'checking')) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Loading />
          <Txt variant="body" tone="dim">{!user ? 'Starting up…' : 'Checking your admin access…'}</Txt>
        </View>
      </Screen>
    );
  }
  if (!user) return <AuthNavigator />;
  if (adminState !== 'authorized') return <UnauthorizedScreen />;
  return (
    <View style={{ flex: 1 }}>
      {pushResult && !pushResult.ok && (
        <GuardianPushWarning result={pushResult} retrying={pushRetrying} onRetry={() => registerPush(user.id, false)} />
      )}
      <AppNavigator />
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
    Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black,
  });
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const t = setTimeout(() => setFontTimedOut(true), 2500);
    return () => clearTimeout(t);
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError && !fontTimedOut) return <View style={{ flex: 1, backgroundColor: '#0B0814' }} />;

  // Screen gallery for design review (web only): /design-preview/screens?s=Dashboard&mood=day|night
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname === '/design-preview/screens') {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('s') || 'Dashboard';
    const mq = q.get('mood');
    const isAuth = s === 'Login' || s === 'Signup';
    return (
      <SafeAreaProvider>
        <MoodProvider force={mq === 'day' || mq === 'night' ? mq : undefined}>
          <AuthProvider>
            <NavigationContainer>
              {isAuth ? <AuthNavigator initialRoute={s} /> : <AppNavigator initialRoute={s} />}
            </NavigationContainer>
            <ToastHost />
          </AuthProvider>
        </MoodProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <ErrorBoundary moduleName="AdminMobile">
      <SafeAreaProvider>
        <MoodProvider>
          <AuthProvider>
            <View style={{ flex: 1 }}>
              <NavigationContainer ref={navigationRef}>
                <RootNavigator />
              </NavigationContainer>
              <ToastHost />
            </View>
          </AuthProvider>
        </MoodProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  pushWarning: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  pushWarningTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  pushWarningBody: {
    color: '#FEE2E2',
    fontSize: 13,
    lineHeight: 18,
  },
  pushWarningActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  pushWarningButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  pushWarningButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.65)',
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
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
