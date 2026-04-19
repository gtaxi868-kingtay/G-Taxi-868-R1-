import React, { useEffect, useRef } from 'react';
import {
    Image,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    Dimensions,
    Pressable,
    SafeAreaView,
    Alert,
} from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { Logo } from '../../../../shared/design-system/components';
import { Ionicons } from '@expo/vector-icons';

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    gold: '#FFD700',
    textSecondary: 'rgba(255,255,255,0.6)',
    error: '#EF4444',
};

const { width, height } = Dimensions.get('window');
const SIDEBAR_WIDTH = width * 0.75;

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
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: -SIDEBAR_WIDTH,
                    duration: 250,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 250,
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
            <Ionicons name={iconName as any} size={22} color={isWarning ? COLORS.error : COLORS.gold} style={{ width: 32 }} />
            <Text style={{fontSize: 16, fontWeight: '700', color: isWarning ? COLORS.error : '#FFF'}}>{label.toUpperCase()}</Text>
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
                        // AuthContext will handle state change -> navigation reset
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

            <Animated.View style={[styles.panel, { transform: [{ translateX: slideAnim }] }]}>
                <View style={{ flex: 1, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <SafeAreaView style={{ flex: 1 }}>
                        {/* Profile Header */}
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
                                        <Text style={{fontSize: 16, fontWeight: '700', color: COLORS.gold}}>
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

                        {/* Navigation Links */}
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

                        {/* Logout */}
                        <View style={styles.navSection}>
                            <TouchableOpacity
                                style={styles.navItem}
                                onPress={handleLogout}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="log-out-outline" size={22} color={COLORS.error} style={{ width: 32 }} />
                                <Text style={{fontSize: 16, fontWeight: '700', color: COLORS.error}}>TERMINATE SESSION</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.footerLogo}>
                            <Logo size={24} variant="full" />
                            <Text style={{ marginTop: 12, fontSize: 11, fontWeight: '500', color: COLORS.textSecondary }}>
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
        width: SIDEBAR_WIDTH,
        backgroundColor: COLORS.bgPrimary,
        shadowColor: '#000',
        shadowOffset: { width: 4, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 20,
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
