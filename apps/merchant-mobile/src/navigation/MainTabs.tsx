import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CrystalFace, RaisedIcon } from '@gtaxi/design-system-native/src/crystal';
import { VOICES } from '@gtaxi/design-system';
import { useMerchant } from '../context/MerchantContext';
import { HomeScreen } from '../screens/HomeScreen';
import { YouScreen } from '../screens/YouScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { AppointmentsScreen } from '../screens/AppointmentsScreen';
import { PropertyManagementScreen } from '../screens/PropertyManagementScreen';
import { ProductCatalogScreen } from '../screens/ProductCatalogScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const WORK_SCREENS = { Orders: OrdersScreen, Appointments: AppointmentsScreen, PropertyManagement: PropertyManagementScreen };

type IconName = keyof typeof Ionicons.glyphMap;

function TabIcon({ name, focused, label }: { name: IconName; focused: boolean; label: string }) {
    return (
        <View style={s.tab}>
            <View style={s.iconWrap}>
                {focused ? <CrystalFace color={VOICES.merchant.accent} radius={14} /> : null}
                {focused ? <RaisedIcon name={name} size={20} /> : <Ionicons name={name} size={20} color={VOICES.merchant.textMuted} />}
            </View>
            <Text numberOfLines={1} style={[s.label, focused && s.labelOn]}>{label}</Text>
        </View>
    );
}

// The second and third tabs follow the business: a barber gets Bookings and
// Services, a hotel gets Rooms, a roti shop gets Orders and Menu.
export function MainTabs() {
    const insets = useSafeAreaInsets();
    const { type } = useMerchant();
    const icon = (name: IconName, label: string) => ({
        tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} label={label} />,
        tabBarAccessibilityLabel: label,
    });

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarShowLabel: false,
                tabBarStyle: [s.bar, { height: 66 + insets.bottom, paddingBottom: insets.bottom }],
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
    bar: { backgroundColor: '#0B1311', borderTopWidth: 1, borderTopColor: 'rgba(233,245,243,0.08)', paddingTop: 8 },
    tab: { alignItems: 'center', width: 72 },
    iconWrap: { width: 44, height: 30, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    label: { marginTop: 3, fontSize: 11, fontWeight: '600', color: VOICES.merchant.textMuted },
    labelOn: { color: VOICES.merchant.text },
});
