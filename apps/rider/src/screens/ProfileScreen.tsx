import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, Image, Dimensions } from 'react-native';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export function ProfileScreen({ navigation }: any) {
    const { user, profile, signOut } = useAuth();
    const [avgRating, setAvgRating] = useState<string | null>(null);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('rides')
            .select('rating')
            .eq('rider_id', user.id)
            .not('rating', 'is', null)
            .then(({ data }) => {
                if (data && data.length > 0) {
                    const avg = data.reduce((s: number, r: any) => s + r.rating, 0) / data.length;
                    setAvgRating(avg.toFixed(1));
                }
            });
    }, [user?.id]);

    // Safe Fallbacks
    const name = profile?.full_name || user?.email?.split('@')[0] || 'Rider';
    const phone = profile?.phone || 'No phone number';
    const email = user?.email || '';

    // Boring Actions
    const menuItems = [
        { label: 'Saved Places', icon: 'location-outline', nav: 'SavedPlaces' },
        { label: 'Edit Profile', icon: 'create-outline', nav: 'EditProfile' },
        { label: 'Settings', icon: 'settings-outline', nav: 'Settings' },
        { label: 'Support & Legal', icon: 'scale-outline', nav: 'Legal' },
    ];

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#121212']}
                style={StyleSheet.absoluteFill}
            />

            <SafeAreaView style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Account</Txt>
                </View>

                {/* 1. IDENTITY CARD (The "Boring" Anchor) */}
                <View style={styles.section}>
                    <View style={styles.identityRow}>
                        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,200,150,0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: tokens.colors.primary.purple }}>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.primary.purple}>
                                {user?.name?.charAt(0)?.toUpperCase() || 'R'}
                            </Txt>
                        </View>
                        <View style={{ marginLeft: 16 }}>
                            <Txt variant="headingM" weight="bold">{name}</Txt>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary}>{phone}</Txt>
                            <View style={styles.ratingBadge}>
                                <Txt variant="small" weight="bold">{avgRating ? `${avgRating} ★` : 'New rider'}</Txt>
                            </View>
                        </View>
                    </View>
                </View>

                {/* 2. MENU ACTIONS */}
                <View style={styles.menuSection}>
                    {menuItems.map((item, index) => (
                        <TouchableOpacity
                            key={index}
                            style={styles.menuItem}
                            onPress={() => navigation.navigate(item.nav === 'Legal' ? 'Help' : item.nav)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.menuIconInfo}>
                                <Ionicons name={item.icon as any} size={22} color={tokens.colors.text.secondary} />
                                <Txt variant="bodyReg" style={{ marginLeft: 16 }}>{item.label}</Txt>
                            </View>
                            <Txt variant="bodyReg" color={tokens.colors.text.tertiary}>›</Txt>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* 3. FOOTER ACTIONS */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={styles.logoutBtn}
                        onPress={signOut}
                    >
                        <Txt variant="bodyBold" style={{ color: tokens.colors.status.error }}>Log Out</Txt>
                    </TouchableOpacity>
                    <Txt variant="small" color={tokens.colors.text.tertiary} style={{ marginTop: 20 }}>
                        v1.0.0 • {email}
                    </Txt>
                </View>

            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    section: {
        paddingHorizontal: 20,
        marginBottom: 30,
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)'
    },
    ratingBadge: {
        marginTop: 8,
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        alignSelf: 'flex-start',
    },
    menuSection: {
        paddingHorizontal: 20,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    menuIconInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    footer: {
        marginTop: 'auto',
        padding: 20,
        alignItems: 'center',
        marginBottom: 20,
    },
    logoutBtn: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        backgroundColor: 'rgba(255, 77, 77, 0.1)',
        borderRadius: 100,
    }
});
