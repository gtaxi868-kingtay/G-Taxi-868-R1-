import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
    ScrollView, Dimensions, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

const { width } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    cyanSoft: 'rgba(0,229,255,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

export function ProfileScreen({ navigation }: any) {
    const { user, profile, signOut } = useAuth();
    const insets = useSafeAreaInsets();

    const [stats, setStats] = useState({ totalTrips: 0, rating: '5.0', memberSince: '' });
    const [loading, setLoading] = useState(true);
    
    // FIX #2: Subscription tier state
    const [subscription, setSubscription] = useState({
        tier: 'free',
        benefits: { discount_percent: 0, free_wait_minutes: 3, priority_matching: false },
        expires_at: null as string | null
    });

    const fetchProfileStats = useCallback(async () => {
        try {
            const { data: rides, error: ridesError } = await supabase
                .from('rides')
                .select('rating')
                .eq('rider_id', user?.id)
                .not('rating', 'is', null);
            if (ridesError) console.error('[ProfileScreen] rides rating query failed:', ridesError.message);

            const { count, error: countError } = await supabase
                .from('rides')
                .select('*', { count: 'exact', head: true })
                .eq('rider_id', user?.id);
            if (countError) console.error('[ProfileScreen] rides count query failed:', countError.message);

            const joinDate = new Date(user?.created_at || '');
            const memberSince = joinDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

            const avg = rides && rides.length > 0
                ? (rides.reduce((s, r: any) => s + r.rating, 0) / rides.length).toFixed(1)
                : '5.0';

            setStats({ totalTrips: count || 0, rating: avg, memberSince });
        } catch (err) {
            console.error('[ProfileScreen] fetchProfileStats error:', err);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (user?.id) {
            fetchProfileStats();
            fetchSubscriptionDetails();
        }
    }, [user?.id, fetchProfileStats]);
    
    // FIX #2: Fetch subscription details
    const fetchSubscriptionDetails = async () => {
        try {
            // Get user's tier
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('subscription_tier, subscription_expires_at')
                .eq('id', user?.id)
                .single();
            if (profileError) console.error('[ProfileScreen] profiles query failed:', profileError.message);
            
            // Get tier benefits
            const { data: benefits, error: benefitsError } = await supabase
                .from('subscription_benefits')
                .select('*')
                .eq('tier', profileData?.subscription_tier || 'free')
                .single();
            if (benefitsError) console.error('[ProfileScreen] subscription_benefits query failed:', benefitsError.message);
            
            setSubscription({
                tier: profileData?.subscription_tier || 'free',
                benefits: benefits || { discount_percent: 0, free_wait_minutes: 3, priority_matching: false },
                expires_at: profileData?.subscription_expires_at
            });
        } catch (err) {
            console.warn('[ProfileScreen] Failed to fetch subscription:', err);
        }
    };

    const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Rider';
    const menuItems = [
        { label: 'Edit Profile', icon: 'person-outline', nav: 'EditProfile' },
        { label: 'AI Assistant & Safety', icon: 'sparkles-outline', nav: 'AISettings' },
        { label: 'Payment Methods', icon: 'card-outline', nav: 'Wallet' },
        { label: 'Saved Places', icon: 'location-outline', nav: 'DestinationSearch', params: { mode: 'save' } },
        { label: 'Promos', icon: 'gift-outline', nav: 'Promo' },
        { label: 'Support', icon: 'help-buoy-outline', nav: 'Help' },
        { label: 'Legal & Privacy', icon: 'document-text-outline', nav: 'Legal' },
    ];

    const handleDeleteAccount = () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        import('react-native').then(({ Alert }) => {
            Alert.alert(
                'Delete Account & Data',
                'This action is irreversible and will purge all your history, wallet, and profile data per GDPR compliance. Are you absolutely sure?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                        text: 'Permanently Delete', 
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                await supabase.functions.invoke('delete_account');
                                await signOut();
                            } catch (e) {
                                Alert.alert('Error', 'Failed to delete account.');
                            }
                        }
                    }
                ]
            );
        });
    };

    if (loading) {
        return (
            <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color={COLORS.purple} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

                {/* Header: [← back circle] */}
                <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color={COLORS.white} />
                    </TouchableOpacity>
                    <Text style={[s.headerTitle, { marginLeft: 16 }]}>Command Center</Text>
                </View>

                {/* Avatar: 80x80 circle with gradient */}
                <View style={s.hero}>
                    <LinearGradient colors={[COLORS.purple, COLORS.purpleLight]} style={s.avatarWrap}>
                        <Text style={s.avatarLetter}>{displayName.charAt(0)}</Text>
                    </LinearGradient>
                    <Text style={[s.displayName, { marginTop: 16 }]}>{displayName}</Text>
                    <Text style={[s.emailText, { marginTop: 4 }]}>{user?.email}</Text>
                </View>

                {/* FIX #2: Subscription Tier Card */}
                <TouchableOpacity
                    style={s.subscriptionCard}
                    onPress={() => navigation.navigate('Subscription')}
                    activeOpacity={0.8}
                >
                    <LinearGradient 
                        colors={subscription.tier === 'pro' ? ['#FFD700', '#FFA500'] : 
                                subscription.tier === 'plus' ? ['#C0C0C0', '#808080'] : 
                                ['#7C3AED', '#4C1D95']}
                        style={s.subscriptionGradient}
                    >
                        <View style={s.subscriptionContent}>
                            <View style={s.subscriptionBadge}>
                                <Ionicons 
                                    name={subscription.tier === 'pro' ? 'shield' : 
                                          subscription.tier === 'plus' ? 'star' : 'person'} 
                                    size={20} 
                                    color="#FFF" 
                                />
                                <Text style={[s.tierText, { marginLeft: 8 }]}>
                                    {subscription.tier.toUpperCase()}
                                </Text>
                            </View>
                            <View style={s.subscriptionPerks}>
                                <Text style={s.perksText}>
                                    {subscription.benefits.discount_percent}% off rides • {subscription.benefits.free_wait_minutes}min grace
                                    {subscription.benefits.priority_matching ? ' • Priority' : ''}
                                </Text>
                            </View>
                            {subscription.tier === 'free' && (
                                <View style={s.upgradeHint}>
                                    <Text style={s.upgradeText}>Tap to upgrade →</Text>
                                </View>
                            )}
                        </View>
                    </LinearGradient>
                </TouchableOpacity>

                {/* Metrics Grid */}
                <View style={s.grid}>
                    <View style={s.gridItem}>
                        <Text style={s.gridValue}>{stats.totalTrips}</Text>
                        <Text style={s.gridLabel}>MISSIONS</Text>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Text style={[s.gridValue, { color: COLORS.purple }]}>⭐ {stats.rating}</Text>
                        <Text style={s.gridLabel}>RANKING</Text>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Text style={s.gridValue}>{stats.memberSince}</Text>
                        <Text style={s.gridLabel}>ENLISTED</Text>
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
                                    <Ionicons name={item.icon as any} size={20} color={COLORS.purple} />
                                </View>
                                <Text style={[s.menuLabel, { marginLeft: 16 }]}>{item.label}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Logout */}
                <TouchableOpacity style={s.logoutBtn} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); signOut(); }}>
                    <Text style={s.logoutText}>TERMINATE SESSION</Text>
                </TouchableOpacity>

                {/* GDPR Delete Account */}
                <TouchableOpacity style={[s.logoutBtn, { marginTop: 16, borderColor: 'transparent', backgroundColor: 'rgba(239,68,68,0.15)' }]} onPress={handleDeleteAccount}>
                    <Text style={s.logoutText}>PURGE DATA & IDENTITY</Text>
                </TouchableOpacity>

                <View style={s.footerBranding}>
                    <Text style={s.logoText}>G-TAXI</Text>
                    <Text style={[s.footerText, { marginTop: 12 }]}>RIDER COMMAND V3.2 • EMPIRE OS</Text>
                </View>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: COLORS.glassBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.glassBorder },
    headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.white },

    hero: { alignItems: 'center', marginBottom: 40 },
    avatarWrap: { width: 100, height: 100, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.purple, shadowRadius: 20, shadowOpacity: 0.4 },
    avatarLetter: { fontSize: 36, fontWeight: '900', color: COLORS.white },
    displayName: { fontSize: 22, fontWeight: '700', color: COLORS.white },
    emailText: { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },

    grid: { flexDirection: 'row', backgroundColor: COLORS.glassBg, marginHorizontal: 20, borderRadius: 32, paddingVertical: 24, borderWidth: 1, borderColor: COLORS.glassBorder, marginBottom: 32 },
    gridItem: { flex: 1, alignItems: 'center' },
    gridDivider: { width: 1, height: 32, backgroundColor: COLORS.glassBorder },
    gridValue: { fontSize: 18, fontWeight: '800', color: COLORS.white, marginBottom: 4 },
    gridLabel: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, letterSpacing: 1 },

    menu: { marginHorizontal: 20, backgroundColor: COLORS.glassBg, borderRadius: 32, padding: 12, borderWidth: 1, borderColor: COLORS.glassBorder },
    menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    iconWrapper: { width: 44, height: 44, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(123,92,240,0.1)' },
    menuLabel: { fontSize: 17, fontWeight: '700', color: COLORS.white },

    logoutBtn: { marginHorizontal: 20, marginTop: 40, height: 64, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.08)', alignItems: 'center', justifyContent: 'center' },
    logoutText: { fontSize: 16, fontWeight: '800', color: COLORS.error },
    footerBranding: { alignItems: 'center', marginTop: 32, opacity: 0.8 },
    logoText: { fontSize: 18, fontWeight: '900', color: COLORS.cyan, letterSpacing: 2 },
    footerText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, letterSpacing: 0.5 },
    
    // Subscription card styles
    subscriptionCard: { marginHorizontal: 20, marginBottom: 24, borderRadius: 24, overflow: 'hidden' },
    subscriptionGradient: { borderRadius: 24 },
    subscriptionContent: { padding: 20 },
    subscriptionBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    tierText: { fontSize: 16, fontWeight: '800', color: COLORS.white },
    subscriptionPerks: { marginTop: 4 },
    perksText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
    upgradeHint: { marginTop: 12, alignSelf: 'flex-end' },
    upgradeText: { fontSize: 13, fontWeight: '700', color: COLORS.white },
});
