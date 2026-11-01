import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useMerchant } from '../context/MerchantContext';
import { HomeScreen } from '../screens/HomeScreen';
import { YouScreen } from '../screens/YouScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { AppointmentsScreen } from '../screens/AppointmentsScreen';
import { PropertyManagementScreen } from '../screens/PropertyManagementScreen';
import { ProductCatalogScreen } from '../screens/ProductCatalogScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { type as T, useMood } from '../ui/mood';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const WORK_SCREENS = { Orders: OrdersScreen, Appointments: AppointmentsScreen, PropertyManagement: PropertyManagementScreen };

type IconName = keyof typeof Ionicons.glyphMap;

function TabIcon({ name, focused, label }: { name: IconName; focused: boolean; label: string }) {
    const m = useMood();
    return (
        <View style={s.tab}>
            {focused ? (
                <LinearGradient colors={m.goldFace as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.iconWrap, { borderBottomWidth: 3, borderBottomColor: m.goldLip }]}>
                    <Ionicons name={name} size={20} color={m.onGold} />
                </LinearGradient>
            ) : (
                <View style={s.iconWrap}><Ionicons name={name} size={22} color={m.dim} /></View>
            )}
            <Text numberOfLines={1} style={[T.small, s.label, { color: focused ? m.ink : m.dim }]}>{label}</Text>
        </View>
    );
}

// The second and third tabs follow the business: a barber gets Bookings and
// Services, a hotel gets Rooms, a roti shop gets Orders and Menu.
export function MainTabs() {
    const insets = useSafeAreaInsets();
    const { type } = useMerchant();
    const m = useMood();
    const icon = (name: IconName, label: string) => ({
        tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} label={label} />,
        tabBarAccessibilityLabel: label,
    });

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarShowLabel: false,
                tabBarStyle: { backgroundColor: m.bar, borderTopWidth: 2, borderTopColor: m.line, paddingTop: 8, height: 68 + insets.bottom, paddingBottom: insets.bottom },
            }}
        >
            <Tab.Screen name="Home" component={HomeScreen} options={icon('storefront-outline', 'Home')} />
            {type && <Tab.Screen name="Work" component={WORK_SCREENS[type.work.route] as React.ComponentType<any>} options={icon(type.work.icon, type.work.label)} />}
            {type?.catalog && <Tab.Screen name="Catalog" component={ProductCatalogScreen as React.ComponentType<any>} options={icon(type.catalog.icon, type.catalog.label)} />}
            <Tab.Screen name="Money" component={EarningsScreen as React.ComponentType<any>} options={icon('wallet-outline', 'Money')} />
            <Tab.Screen name="You" component={YouScreen} options={icon('person-outline', 'You')} />
        </Tab.Navigator>
    );
}

const s = StyleSheet.create({
    tab: { alignItems: 'center', width: 72 },
    iconWrap: { width: 46, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    label: { marginTop: 3 },
});
