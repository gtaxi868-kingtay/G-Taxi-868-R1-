import React, { useEffect } from 'react';
import {
    Image, View, StyleSheet, TouchableOpacity,
    useWindowDimensions, Pressable, Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { Txt } from '@/design-system/primitives';
import { Logo } from '@gtaxi/design-system/native';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const CYAN = '#06B6D4';

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
    user?: {
        name: string;
        rating: number;
        photo_url?: string;
    };
    navigation: any;
}

export function Sidebar({ visible, onClose, user, navigation }: SidebarProps) {
    const { width } = useWindowDimensions();
    const SIDEBAR_WIDTH = width * 0.8;
    const slideAnim = useSharedValue(-SIDEBAR_WIDTH);
    const fadeAnim = useSharedValue(0);

    useEffect(() => {
        if (visible) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            slideAnim.value = withSpring(0, ANIMATION.spring);
            fadeAnim.value = withTiming(1, { duration: 300 });
        } else {
            slideAnim.value = withTiming(-SIDEBAR_WIDTH, { duration: 250 });
            fadeAnim.value = withTiming(0, { duration: 250 });
        }
    }, [visible]);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
    }));

    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: slideAnim.value }],
    }));

    if (!visible) return null;

    const navigateTo = (screen: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onClose();
        navigation.navigate(screen);
    };

    const handleLogout = () => {
        Alert.alert("Log Out", "Are you sure you want to log out?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Log Out",
                style: "destructive",
                onPress: async () => {
                    await supabase.auth.signOut();
                    onClose();
                }
            }
        ]);
    };

    return (
        <View style={s.overlay}>
            <Animated.View style={[s.backdrop, backdropStyle]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>

            <Animated.View style={[s.panel, { width: SIDEBAR_WIDTH }, panelStyle]}>
                <View style={[s.blur, glassSurface(100, 0.2)]}>

                    <TouchableOpacity style={s.header} onPress={() => navigateTo('Profile')}>
                        <LinearGradient colors={[VOICES.rider.accent, VOICES.rider.accentDark]} style={s.avatarBorder}>
                            <View style={s.avatarInner}>
                                {user?.photo_url ? (
                                    <Image source={{ uri: user.photo_url }} style={s.image} />
                                ) : (
                                    <Txt variant="headingM" weight="heavy" color="#FFF">{user?.name?.charAt(0) || 'R'}</Txt>
                                )}
                            </View>
                        </LinearGradient>
                        <View style={s.userInfo}>
                            <Txt variant="headingM" weight="heavy" color="#FFF">{user?.name || 'Rider'}</Txt>
                            <View style={s.rating}>
                                <Ionicons name="star" size={12} color="#FFD700" />
                                <Txt variant="caption" weight="heavy" color="#FFD700" style={{ marginLeft: 4 }}>
                                    {user?.rating?.toFixed(1) || '5.0'}
                                </Txt>
                            </View>
                        </View>
                    </TouchableOpacity>

                    <View style={s.menu}>
                        <MenuItem icon="car" label="Your Trips" onPress={() => navigateTo('Trips')} />
                        <MenuItem icon="wallet" label="Wallet" onPress={() => navigateTo('Wallet')} />
                        <MenuItem icon="gift" label="Promotions" onPress={() => navigateTo('Promo')} />
                        <MenuItem icon="bookmark" label="Saved Places" onPress={() => navigateTo('SavedPlaces')} />
                        <MenuItem icon="settings" label="Settings" onPress={() => navigateTo('Settings')} />
                        <MenuItem icon="help-circle" label="Help" onPress={() => navigateTo('Help')} />
                    </View>

                    <View style={s.footer}>
                        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
                            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                            <Txt variant="bodyBold" color="#EF4444" style={{ marginLeft: 12 }}>TERMINATE SESSION</Txt>
                        </TouchableOpacity>

                        <View style={s.footerLogo}>
                            <Logo size={24} variant="full" />
                            <Txt variant="small" color="#AEA9B5" style={{ marginTop: 12 }}>
                                EMPIRE OS • V3.2 PREMIUM
                            </Txt>
                        </View>
                    </View>

                </View>
            </Animated.View>
        </View>
    );
}

const MenuItem = ({ icon, label, onPress }: any) => (
    <TouchableOpacity style={s.menuItem} onPress={onPress}>
        <View style={s.menuIcon}>
            <Ionicons name={icon as any} size={22} color={VOICES.rider.accent} />
        </View>
        <Txt variant="bodyBold" color="#FFF" style={{ fontSize: 16 }}>{label.toUpperCase()}</Txt>
    </TouchableOpacity>
);

const s = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    panel: { height: '100%', backgroundColor: 'transparent' },
    blur: { flex: 1, paddingHorizontal: 20 },

    header: { flexDirection: 'row', alignItems: 'center', marginTop: 80, marginBottom: 40, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, ...ghostBorder(0.08) },
    avatarBorder: { width: 62, height: 62, borderRadius: 31, padding: 2, alignItems: 'center', justifyContent: 'center' },
    avatarInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#1A1823', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    userInfo: { marginLeft: 16 },
    rating: { flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },

    menu: { flex: 1, gap: 4 },
    menuItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16 },
    menuIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: `${VOICES.rider.accent}0D`, alignItems: 'center', justifyContent: 'center', marginRight: 16 },

    footer: { paddingVertical: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    logoutBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, backgroundColor: 'rgba(239,68,68,0.05)', marginBottom: 24 },
    footerLogo: { alignItems: 'center', opacity: 0.8 },
});
