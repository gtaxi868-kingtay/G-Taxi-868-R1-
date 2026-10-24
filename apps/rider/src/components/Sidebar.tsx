import React, { useEffect } from 'react';
import { Alert, Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { BRAND_GRADIENT, GUTTER, Row, SPACE, Txt, useTheme } from '../ui/kit';

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
    user?: {
        name: string;
        rating?: number;
        photo_url?: string;
    };
    navigation: any;
}

const EASE = Easing.bezier(0.23, 1, 0.32, 1);

export function Sidebar({ visible, onClose, user, navigation }: SidebarProps) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const PANEL_W = Math.min(width * 0.84, 360);
    const slide = useSharedValue(-PANEL_W);
    const fade = useSharedValue(0);

    useEffect(() => {
        if (visible) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            slide.value = withTiming(0, { duration: 280, easing: EASE });
            fade.value = withTiming(1, { duration: 220 });
        } else {
            slide.value = withTiming(-PANEL_W, { duration: 220, easing: EASE });
            fade.value = withTiming(0, { duration: 200 });
        }
    }, [visible]);

    const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
    const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));

    if (!visible) return null;

    const go = (screen: string) => {
        Haptics.selectionAsync();
        onClose();
        navigation.navigate(screen);
    };

    const handleLogout = () => {
        Alert.alert('Sign out?', 'You can sign back in any time.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: async () => { await supabase.auth.signOut(); onClose(); } },
        ]);
    };

    return (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }}>
            <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,6,20,0.5)' }, backdropStyle]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
            </Animated.View>

            <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: PANEL_W, backgroundColor: m.sheet[1], borderTopRightRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' }, panelStyle]}>
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + SPACE.xl, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.lg, paddingHorizontal: GUTTER }}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go('Profile')}
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.8 : 1 })}>
                        <View style={{ width: 56, height: 56, borderRadius: 28, overflow: 'hidden' }}>
                            {user?.photo_url ? (
                                <Image source={{ uri: user.photo_url }} style={{ width: 56, height: 56 }} />
                            ) : (
                                <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                    <Txt variant="title" tone="onBrand">{user?.name?.charAt(0) || 'G'}</Txt>
                                </LinearGradient>
                            )}
                        </View>
                        <View style={{ flex: 1, marginLeft: SPACE.md }}>
                            <Txt variant="title" numberOfLines={1}>{user?.name || 'Rider'}</Txt>
                            <Txt variant="caption" tone="accent">View your profile</Txt>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={m.faint} />
                    </Pressable>

                    <View style={{ marginTop: SPACE.xl }}>
                        <Row icon="car-outline" title="Your trips" onPress={() => go('Trips')} />
                        <Row icon="wallet-outline" title="Wallet" onPress={() => go('Wallet')} />
                        <Row icon="bookmark-outline" title="Saved places" onPress={() => go('SavedPlaces')} />
                        <Row icon="notifications-outline" title="Notifications" onPress={() => go('Notifications')} />
                        <Row icon="gift-outline" title="Promotions" onPress={() => go('Promo')} />
                        <Row icon="people-outline" title="Invite friends" onPress={() => go('Referral')} />
                        <Row icon="settings-outline" title="Settings" onPress={() => go('Settings')} />
                        <Row icon="help-buoy-outline" title="Help" onPress={() => go('Help')} last />
                    </View>

                    <Row icon="log-out-outline" title="Sign out" danger onPress={handleLogout} right={<View />} last />

                    <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.xl }}>G 868 · version {Constants.expoConfig?.version || '1.0'}</Txt>
                </ScrollView>
            </Animated.View>
        </View>
    );
}
