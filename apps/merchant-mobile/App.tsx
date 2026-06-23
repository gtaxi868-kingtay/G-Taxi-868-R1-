import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ErrorBoundary } from '@gtaxi/shared';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { JoinWithCodeScreen } from './src/screens/JoinWithCodeScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { DispatchScreen } from './src/screens/DispatchScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { PropertyManagementScreen } from './src/screens/PropertyManagementScreen';
import { EquityProgressScreen } from './src/screens/EquityProgressScreen';
import { ProductCatalogScreen } from './src/screens/ProductCatalogScreen';
import { AppointmentsScreen } from './src/screens/AppointmentsScreen';
import type { AuthStackParamList, AppStackParamList } from './src/navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="JoinWithCode" component={JoinWithCodeScreen} />
    </AuthStack.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={{ headerShown: false }}>
      <AppStack.Screen name="Dashboard" component={DashboardScreen} />
      <AppStack.Screen name="Orders" component={OrdersScreen} />
      <AppStack.Screen name="Dispatch" component={DispatchScreen} />
      <AppStack.Screen name="Earnings" component={EarningsScreen} />
      <AppStack.Screen name="ProductCatalog" component={ProductCatalogScreen} />
      <AppStack.Screen name="Appointments" component={AppointmentsScreen} />
      <AppStack.Screen name="PropertyManagement" component={PropertyManagementScreen} />
      <AppStack.Screen name="EquityProgress" component={EquityProgressScreen} />
    </AppStack.Navigator>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: SURFACE.base, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={VOICES.merchant.accent} />
      </View>
    );
  }
  return user ? <AppNavigator /> : <AuthNavigator />;
}

export default function App() {
  return (
    <ErrorBoundary moduleName="MerchantMobile">
      <SafeAreaProvider>
        <AuthProvider>
          <View style={{ flex: 1 }}>
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </View>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
