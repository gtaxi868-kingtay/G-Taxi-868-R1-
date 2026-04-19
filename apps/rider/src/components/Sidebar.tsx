import React, { useEffect, useRef } from 'react';
import {
    Image, View, StyleSheet, TouchableOpacity,
    Animated, Dimensions, Pressable, Alert
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { Logo } from '../design-system';

const { width, height } = Dimensions.get('window');
const SIDEBAR_WIDTH = width * 0.8;

// --- Blueberry Luxe Protocol ---

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
    const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.parallel([
                Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
                Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, { toValue: -SIDEBAR_WIDTH, duration: 250, useNativeDriver: true }),
                Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
            ]).start();
        }
    }, [visible]);

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
            <Animated.View style={[s.backdrop, { opacity: fadeAnim }]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>

            <Animated.View style={[s.panel, { transform: [{ translateX: slideAnim }] }]}>
                <BlurView tint="dark" intensity={100} style={s.blur}>

                    {/* Profile Header */}
                    <TouchableOpacity style={s.header} onPress={() => navigateTo('Profile')}>
                        <LinearGradient colors={[tokens.colors.primary.purple, '#7C3AED']} style={s.avatarBorder}>
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

                    {/* Navigation Menu */}
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
                            <Txt variant="small" color={tokens.colors.text.secondary} style={{ marginTop: 12 }}>
                                EMPIRE OS • V3.2 PREMIUM
                            </Txt>
                        </View>
                    </View>

                </BlurView>
            </Animated.View>
        </View>
    );
}

const MenuItem = ({ icon, label, onPress }: any) => (
    <TouchableOpacity style={s.menuItem} onPress={onPress}>
        <View style={s.menuIcon}>
            <Ionicons name={icon as any} size={22} color={tokens.colors.primary.purple} />
        </View>
        <Txt variant="bodyBold" color="#FFF" style={{ fontSize: 16 }}>{label.toUpperCase()}</Txt>
    </TouchableOpacity>
);

const s = StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    panel: { width: SIDEBAR_WIDTH, height: '100%', backgroundColor: 'transparent' },
    blur: { flex: 1, paddingHorizontal: 20 },

    header: { flexDirection: 'row', alignItems: 'center', marginTop: 80, marginBottom: 40, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    avatarBorder: { width: 62, height: 62, borderRadius: 31, padding: 2, alignItems: 'center', justifyContent: 'center' },
    avatarInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#1A1823', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    userInfo: { marginLeft: 16 },
    rating: { flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },

    menu: { flex: 1, gap: 4 },
    menuItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16 },
    menuIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(191, 64, 255, 0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },

    footer: { paddingVertical: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    logoutBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, backgroundColor: 'rgba(239,68,68,0.05)', marginBottom: 24 },
    footerLogo: { alignItems: 'center', opacity: 0.8 },
});
