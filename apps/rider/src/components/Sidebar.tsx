import React, { useEffect, useRef } from 'react';
import {
    Image,
    View,
    StyleSheet,
    TouchableOpacity,
    Animated,
    Dimensions,
    Pressable,
    SafeAreaView,
} from 'react-native';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';
import { supabase } from '../../../../shared/supabase'; // Import Supabase directly for logout
import { Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

    // Simplified render logic to avoid private property access
    if (!visible) return null;

    return (
        <View style={[styles.overlay, !visible && { pointerEvents: 'none' }]}>
            {/* Backdrop */}
            <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>

            {/* Sidebar Panel */}
            <Animated.View style={[styles.panel, { transform: [{ translateX: slideAnim }] }]}>
                <Surface style={{ flex: 1, overflow: 'hidden' }} intensity={10} noBorder>
                    <SafeAreaView style={{ flex: 1 }}>

                        {/* 1. Header: Profile */}
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
                                        <Image source={{ uri: user.photo_url }} style={{ width: 56, height: 56, borderRadius: 28 }} />
                                    ) : (
                                        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0, 200, 150, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: tokens.colors.primary.purple }}>
                                            <Txt variant="headingM" weight="bold" color={tokens.colors.primary.purple}>
                                                {user?.name?.charAt(0)?.toUpperCase() || 'R'}
                                            </Txt>
                                        </View>
                                    )}
                                </View>
                                <View>
                                    <Txt variant="headingM" weight="bold">{user?.name || 'Rider'}</Txt>
                                    <View style={styles.ratingPill}>
                                        <Txt variant="caption" color={tokens.colors.text.primary}>{user?.rating?.toFixed(1) || '5.0'} ★</Txt>
                                    </View>
                                </View>
                            </View>
                        </TouchableOpacity>

                        {/* 2. Menu Items */}
                        <View style={styles.menuItems}>
                            <MenuItem iconName="car-outline" label="Your Trips" onPress={() => {
                                onClose();
                                navigation.navigate('Trips');
                            }} />
                            <MenuItem iconName="wallet-outline" label="Wallet" onPress={() => {
                                onClose();
                                navigation.navigate('Wallet');
                            }} />
                            <MenuItem iconName="gift-outline" label="Promotions" onPress={() => {
                                onClose();
                                navigation.navigate('Promo');
                            }} />
                            <MenuItem iconName="settings-outline" label="Settings" onPress={() => {
                                onClose();
                                navigation.navigate('Settings');
                            }} />
                            <MenuItem iconName="help-circle-outline" label="Help" onPress={() => {
                                onClose();
                                navigation.navigate('Help');
                            }} />
                            {/* LOGOUT BUTTON */}
                            <MenuItem iconName="log-out-outline" iconColor={tokens.colors.status.error} label="Log Out" onPress={() => {
                                Alert.alert(
                                    "Log Out",
                                    "Are you sure you want to log out?",
                                    [
                                        { text: "Cancel", style: "cancel" },
                                        {
                                            text: "Log Out",
                                            style: "destructive",
                                            onPress: async () => {
                                                await supabase.auth.signOut();
                                                onClose(); // Close sidebar
                                                // AuthContext will handle state change -> navigation reset
                                            }
                                        }
                                    ]
                                );
                            }} />
                        </View>

                        {/* 3. Footer */}
                        <View style={styles.footer}>
                            <Card padding="md" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                                <Txt variant="bodyBold">Do more with your account</Txt>
                                <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                    Make money driving ➡️
                                </Txt>
                            </Card>
                            <Txt variant="caption" color={tokens.colors.primary.purple} style={{ marginTop: 20 }}>
                                G Taxi v1.0 • Dark Mode
                            </Txt>
                        </View>

                    </SafeAreaView>
                </Surface>
            </Animated.View>
        </View>
    );
}

const MenuItem = ({ iconName, iconColor, label, onPress }: any) => (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
        <Ionicons name={iconName} size={22} color={iconColor || tokens.colors.text.secondary} style={{ marginRight: 20 }} />
        <Txt variant="bodyReg" style={{ fontSize: 18 }}>{label}</Txt>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    panel: {
        width: SIDEBAR_WIDTH,
        height: '100%',
        backgroundColor: tokens.colors.background.base, // Fallback
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 20,
    },
    header: {
        padding: 24,
        paddingTop: 40,
        backgroundColor: '#000',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
        marginBottom: 20,
    },
    avatarRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#222',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)'
    },
    avatarPlaceholder: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 30,
        backgroundColor: tokens.colors.primary.purple,
        opacity: 0.1,
    },
    ratingPill: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    menuItems: {
        paddingHorizontal: 24,
        flex: 1,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
    },
    footer: {
        padding: 24,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
    },
});
