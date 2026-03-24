import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, SafeAreaView,
    ScrollView, Dimensions, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function ProfileScreen({ navigation }: any) {
    const { user, profile, signOut } = useAuth();
    const insets = useSafeAreaInsets();

    const [stats, setStats] = useState({ totalTrips: 0, rating: '5.0', memberSince: '' });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user?.id) fetchProfileStats();
    }, [user?.id]);

    const fetchProfileStats = async () => {
        try {
            const { data: rides } = await supabase
                .from('rides')
                .select('rating')
                .eq('rider_id', user?.id)
                .not('rating', 'is', null);

            const { count } = await supabase
                .from('rides')
                .select('*', { count: 'exact', head: true })
                .eq('rider_id', user?.id);

            const joinDate = new Date(user?.created_at || '');
            const memberSince = joinDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

            const avg = rides && rides.length > 0
                ? (rides.reduce((s, r: any) => s + r.rating, 0) / rides.length).toFixed(1)
                : '5.0';

            setStats({ totalTrips: count || 0, rating: avg, memberSince });
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // BUG_FIX: Profile Name — use profile.full_name mapping
    const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Rider';

    const menuItems = [
        { label: 'Edit Profile', icon: 'person-outline', nav: 'EditProfile' },
        { label: 'AI Assistant & Safety', icon: 'sparkles-outline', nav: 'AISettings' },
        { label: 'Payment Methods', icon: 'card-outline', nav: 'Wallet' },
        { label: 'Saved Places', icon: 'location-outline', nav: 'DestinationSearch', params: { mode: 'save' } },
        { label: 'Promos', icon: 'gift-outline', nav: 'Promo' },
        { label: 'Support', icon: 'help-buoy-outline', nav: 'Help' },
    ];

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

                {/* Header: [← back circle] */}
                <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Profile</Txt>
                </View>

                {/* Avatar: 80x80 circle with purpleGradient */}
                <View style={s.hero}>
                    <LinearGradient colors={[R.purple, '#4C1D95']} style={s.avatarWrap}>
                        <Txt variant="headingL" weight="heavy" color="#FFF">{displayName.charAt(0)}</Txt>
                    </LinearGradient>
                    <Txt variant="bodyBold" color="#FFF" style={{ fontSize: 22, marginTop: 16 }}>{displayName}</Txt>
                    <Txt variant="small" color={R.muted} style={{ marginTop: 4 }}>{user?.email}</Txt>
                </View>

                {/* Metrics Grid */}
                <View style={s.grid}>
                    <View style={s.gridItem}>
                        <Txt variant="bodyBold" color="#FFF">{stats.totalTrips}</Txt>
                        <Txt variant="caption" color={R.muted}>TRIPS</Txt>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Txt variant="bodyBold" color={R.gold}>⭐ {stats.rating}</Txt>
                        <Txt variant="caption" color={R.muted}>RATING</Txt>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Txt variant="bodyBold" color="#FFF">{stats.memberSince}</Txt>
                        <Txt variant="caption" color={R.muted}>SINCE</Txt>
                    </View>
                </View>

                {/* Settings Menu */}
                <View style={s.menu}>
                    {menuItems.map((item, idx) => (
                        <TouchableOpacity
                            key={idx}
                            style={s.menuItem}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate(item.nav, item.params); }}
                        >
                            <View style={s.menuItemLeft}>
                                <View style={s.iconWrapper}>
                                    <Ionicons name={item.icon as any} size={20} color={R.purpleLight} />
                                </View>
                                <Txt variant="bodyReg" color="#FFF" style={{ marginLeft: 16 }}>{item.label}</Txt>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={R.muted} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Logout: Red ghost style */}
                <TouchableOpacity style={s.logoutBtn} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); signOut(); }}>
                    <Txt variant="bodyBold" color={R.red}>Log Out</Txt>
                </TouchableOpacity>

                <Txt variant="small" color={R.muted} style={{ textAlign: 'center', marginTop: 24 }}>G-Taxi Rider v1.4.2</Txt>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    hero: { alignItems: 'center', marginBottom: 40 },
    avatarWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', shadowColor: R.purple, shadowRadius: 15, shadowOpacity: 0.3 },

    grid: { flexDirection: 'row', backgroundColor: R.surface, marginHorizontal: 20, borderRadius: 24, paddingVertical: 20, borderWidth: 1, borderColor: R.border, marginBottom: 32 },
    gridItem: { flex: 1, alignItems: 'center' },
    gridDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.05)' },

    menu: { marginHorizontal: 20, backgroundColor: R.surface, borderRadius: 24, padding: 8, borderWidth: 1, borderColor: R.border },
    menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    iconWrapper: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(124,58,237,0.1)', alignItems: 'center', justifyContent: 'center' },

    logoutBtn: { marginHorizontal: 20, marginTop: 40, height: 56, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)', alignItems: 'center', justifyContent: 'center' },
});
