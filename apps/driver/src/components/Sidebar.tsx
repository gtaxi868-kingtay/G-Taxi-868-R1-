import React, { useEffect, useRef } from 'react';
import {
    Image,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    useWindowDimensions,
    Pressable,
    SafeAreaView,
    Alert,
} from 'react-native';
import { supabase } from '@gtaxi/core';
import { Logo } from '@gtaxi/shared/design-system/components';
import { Ionicons } from '@expo/vector-icons';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
    user?: {
        name: string;
        rating: number;
        photo_url?: string;
    };
    navigation: { navigate: (screen: string) => void };
}

export function Sidebar({ visible, onClose, user, navigation }: SidebarProps) {
    const { width } = useWindowDimensions();
    const SIDEBAR_WIDTH = width * 0.75;
    const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    ...ANIMATION.spring,
                    useNativeDriver: true,
                }),
                Animated.spring(fadeAnim, {
                    toValue: 1,
                    ...ANIMATION.spring,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: -SIDEBAR_WIDTH,
                    ...ANIMATION.spring,
                    useNativeDriver: true,
                }),
                Animated.spring(fadeAnim, {
                    toValue: 0,
                    ...ANIMATION.spring,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    if (!visible) return null;

    const navItem = (label: string, iconName: string, screen?: string, isWarning: boolean = false) => (
        <TouchableOpacity
            style={styles.navItem}
            onPress={() => {
                onClose();
                if (screen) navigation.navigate(screen);
            }}
            activeOpacity={0.7}
        >
            <Ionicons name={iconName as any} size={22} color={isWarning ? 'rgba(239,68,68,0.35)' : VOICES.driver.gold} style={{ width: 32 }} />
            <Text style={{fontSize: 16, fontWeight: '700', color: isWarning ? 'rgba(239,68,68,0.35)' : '#FFF'}}>{label.toUpperCase()}</Text>
        </TouchableOpacity>
    );

    const handleLogout = () => {
        Alert.alert(
            'Log Out',
            'Are you sure you want to log out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Log Out',
                    style: 'destructive',
                    onPress: async () => {
                        onClose();
                        await supabase.auth.signOut();
                    },
                },
            ]
        );
    };

    return (
        <View style={styles.overlay}>
            <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>

            <Animated.View style={[styles.panel, { width: SIDEBAR_WIDTH, transform: [{ translateX: slideAnim }] }]}>
                <View style={{ flex: 1, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <SafeAreaView style={{ flex: 1 }}>
                        <TouchableOpacity
                            style={styles.header}
                            onPress={() => {
                                onClose();
                                navigation.navigate('Profile');
                            }}
                            activeOpacity={0.8}
                        >
                            <View style={styles.avatarRow}>
                                <View style={styles.avatarContainer}>
                                    <View style={styles.avatarPlaceholder} />
                                    {user?.photo_url ? (
                                        <Image source={{ uri: user.photo_url }} style={styles.avatarImage} />
                                    ) : (
                                        <Text style={{fontSize: 16, fontWeight: '700', color: VOICES.driver.gold}}>
                                            {user?.name?.charAt(0)?.toUpperCase() || 'D'}
                                        </Text>
                                    )}
                                </View>
                                <View style={styles.userInfo}>
                                    <Text style={{fontSize: 16, fontWeight: '700', color: '#FFF'}}>{user?.name || 'Driver'}</Text>
                                    <View style={styles.ratingBadge}>
                                        <Text style={{fontSize: 11, fontWeight: '600', color: '#FFF'}}>★ {user?.rating?.toFixed(2) || '5.00'}</Text>
                                    </View>
                                </View>
                            </View>
                        </TouchableOpacity>

                        <View style={styles.divider} />

                        <View style={styles.navSection}>
                            {navItem('Wallet', 'wallet-outline', 'Wallet')}
                            {navItem('Scheduled', 'calendar-outline', 'ScheduledRides')}
                            {navItem('Performance', 'bar-chart-outline', 'Profile')}
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.navSection}>
                            {navItem('Settings', 'settings-outline', 'Profile')}
                        </View>

                        <View style={{ flex: 1 }} />

                        <View style={styles.navSection}>
                            <TouchableOpacity
                                style={styles.navItem}
                                onPress={handleLogout}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="log-out-outline" size={22} color="rgba(239,68,68,0.35)" style={{ width: 32 }} />
                                <Text style={{fontSize: 16, fontWeight: '700', color: 'rgba(239,68,68,0.35)'}}>TERMINATE SESSION</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.footerLogo}>
                            <Logo size={24} variant="full" />
                            <Text style={{ marginTop: 12, fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.6)' }}>
                                EMPIRE OS • V3.2 PILOT
                            </Text>
                        </View>

                    </SafeAreaView>
                </View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 9999,
        elevation: 9999,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    panel: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        backgroundColor: SURFACE.base,
        ...elevationGlow(),
    },
    header: {
        padding: 24,
        paddingTop: 32,
    },
    avatarRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    avatarPlaceholder: {
        ...StyleSheet.absoluteFillObject,
    },
    avatarImage: {
        width: 56,
        height: 56,
        borderRadius: 28,
    },
    userInfo: {
        marginLeft: 16,
        justifyContent: 'center',
    },
    ratingBadge: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginHorizontal: 24,
    },
    navSection: {
        paddingVertical: 16,
    },
    navItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 24,
    },
    footerLogo: {
        alignItems: 'center',
        paddingVertical: 24,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
        opacity: 0.8
    },
});
