import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DashboardScreen } from '../screens/DashboardScreen';
import { EarningsScreen } from '../screens/EarningsScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { YouScreen } from '../screens/YouScreen';
import { FONT, tick, useTheme, IconName } from '../ui/kit';
import { DRIVE_COLORS } from '../theme/drive';

// Bottom tabs replace the hamburger menu (founder, 2026-10-27), the same
// pattern as the rider app: Drive · Earnings · Wallet · You.

export type DriverTabParamList = {
    Drive: undefined;
    Earnings: undefined;
    Wallet: undefined;
    You: undefined;
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

const TABS: Record<keyof DriverTabParamList, { label: string; icon: IconName; iconOn: IconName; color: string }> = {
    Drive: { label: 'Drive', icon: 'navigate-outline', iconOn: 'navigate', color: DRIVE_COLORS.online },
    Earnings: { label: 'Earnings', icon: 'trending-up-outline', iconOn: 'trending-up', color: DRIVE_COLORS.money },
    Wallet: { label: 'Wallet', icon: 'wallet-outline', iconOn: 'wallet', color: DRIVE_COLORS.cyan },
    You: { label: 'You', icon: 'person-outline', iconOn: 'person', color: DRIVE_COLORS.violet },
};

function TabBar({ state, navigation }: BottomTabBarProps) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: '#0E1117', borderTopColor: m.chipBorder }]}>
            {state.routes.map((route, index) => {
                const t = TABS[route.name as keyof DriverTabParamList];
                const focused = state.index === index;
                return (
                    <Pressable
                        key={route.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: focused }}
                        accessibilityLabel={t.label}
                        onPress={() => {
                            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                            if (!focused && !e.defaultPrevented) { tick(); navigation.navigate(route.name); }
                        }}
                        style={st.item}
                    >
                        <View style={[st.pill, focused && { backgroundColor: `${t.color}22`, borderColor: `${t.color}66` }]}>
                            <Ionicons name={focused ? t.iconOn : t.icon} size={22} color={focused ? t.color : m.faint} />
                        </View>
                        <Text style={[st.label, { color: focused ? m.ink : m.faint }]}>{t.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

export function DriverTabs() {
    return (
        <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />} backBehavior="firstRoute">
            <Tab.Screen name="Drive" component={DashboardScreen as any} />
            <Tab.Screen name="Earnings" component={EarningsScreen as any} />
            <Tab.Screen name="Wallet" component={WalletScreen as any} />
            <Tab.Screen name="You" component={YouScreen as any} />
        </Tab.Navigator>
    );
}

const st = StyleSheet.create({
    bar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8 },
    item: { flex: 1, alignItems: 'center' },
    pill: { width: 56, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
    label: { fontFamily: FONT.round, fontSize: 12, marginTop: 3 },
});
