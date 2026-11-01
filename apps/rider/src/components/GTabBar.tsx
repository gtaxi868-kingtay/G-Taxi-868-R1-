import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CrystalFace, LIP, shade, SPACE, tick, Txt, useKeyPress, useTheme } from '../ui/kit';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// One look per tab. The active tab becomes a bright 3D key in its colour; the
// others sit quiet so the eye goes to where you are.
export const TAB_META: Record<string, { label: string; icon: IconName; color: string }> = {
    Map: { label: 'Home', icon: 'map', color: '#8B7CFF' },
    Services: { label: 'Services', icon: 'grid', color: '#FF8A3D' },
    Activity: { label: 'Activity', icon: 'receipt', color: '#4C9AFF' },
    WalletTab: { label: 'Wallet', icon: 'wallet', color: '#2FB57C' },
    You: { label: 'You', icon: 'person', color: '#FF5C8A' },
};

export function GTabBar({ state, navigation, insets }: BottomTabBarProps) {
    const m = useTheme();
    const night = m.key === 'night';
    return (
        <View
            style={{
                flexDirection: 'row',
                paddingTop: SPACE.sm,
                paddingBottom: Math.max(insets.bottom, SPACE.sm),
                paddingHorizontal: SPACE.sm,
                backgroundColor: m.sheet[1],
                borderTopWidth: 2,
                borderTopColor: night ? '#2E2640' : '#EEE8F4',
            }}
        >
            {state.routes.map((route, index) => {
                const meta = TAB_META[route.name] || { label: route.name, icon: 'ellipse' as IconName, color: m.accent };
                const focused = state.index === index;
                const onPress = () => {
                    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                    if (!focused && !event.defaultPrevented) {
                        tick();
                        navigation.navigate(route.name, route.params);
                    }
                };
                return <TabKey key={route.key} label={meta.label} icon={meta.icon} color={meta.color} focused={focused} onPress={onPress} />;
            })}
        </View>
    );
}

function TabKey({ label, icon, color, focused, onPress }: { label: string; icon: IconName; color: string; focused: boolean; onPress: () => void }) {
    const m = useTheme();
    const { translateY, onPressIn, onPressOut } = useKeyPress();
    // Springs up a touch when the tab becomes active.
    const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;
    useEffect(() => {
        Animated.spring(pop, { toValue: focused ? 1 : 0, speed: 16, bounciness: 10, useNativeDriver: true }).start();
    }, [focused]);
    const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            style={{ flex: 1, alignItems: 'center' }}
            hitSlop={4}
        >
            <Animated.View style={{ transform: [{ scale }] }}>
                <View style={{ borderRadius: 16, backgroundColor: focused ? shade(color) : 'transparent' }}>
                    <Animated.View style={{
                        width: 52, height: 38, borderRadius: 16,
                        backgroundColor: focused ? color : 'transparent',
                        alignItems: 'center', justifyContent: 'center',
                        marginBottom: focused ? LIP : 0,
                        transform: [{ translateY: focused ? translateY : 0 }],
                    }}>
                        {focused ? <CrystalFace color={color} radius={16} /> : null}
                        <Ionicons name={focused ? icon : (`${icon}-outline` as IconName)} size={22} color={focused ? '#FFFFFF' : m.faint} />
                    </Animated.View>
                </View>
            </Animated.View>
            <Txt variant="label" numberOfLines={1} style={{ marginTop: focused ? 2 : 2 + LIP, fontSize: 11, color: focused ? color : m.faint }}>{label}</Txt>
        </Pressable>
    );
}
