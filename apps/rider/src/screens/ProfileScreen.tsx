import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ScrollView, useWindowDimensions, ActivityIndicator, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps, AppStackParamList } from '../navigation/types';

export function ProfileScreen({ navigation }: AppScreenProps<'Profile'>) {
    const { width } = useWindowDimensions();
    const { user, profile, signOut } = useAuth();
    const insets = useSafeAreaInsets();

    const [stats, setStats] = useState({ totalTrips: 0, rating: '5.0', memberSince: '' });
    const [loading, setLoading] = useState(true);
    
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
    
    const fetchSubscriptionDetails = async () => {
        try {
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('subscription_tier, subscription_expires_at')
                .eq('id', user?.id)
                .single();
            if (profileError) console.error('[ProfileScreen] profiles query failed:', profileError.message);
            
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
    const menuItems: { label: string; icon: string; nav: keyof AppStackParamList; params?: any }[] = [
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
                <ActivityIndicator color={VOICES.rider.accent} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

                <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                    <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Text style={[s.headerTitle, { marginLeft: 16 }]}>Command Center</Text>
                </View>

                <View style={s.hero}>
                    <LinearGradient colors={[VOICES.rider.accent, VOICES.rider.accentDark]} style={s.avatarWrap}>
                        <Text style={s.avatarLetter}>{displayName.charAt(0)}</Text>
                    </LinearGradient>
                    <Text style={[s.displayName, { marginTop: 16 }]}>{displayName}</Text>
                    <Text style={[s.emailText, { marginTop: 4 }]}>{user?.email}</Text>
                </View>

                <View style={s.subscriptionCard}>
                    <LinearGradient 
                        colors={subscription.tier === 'pro' ? ['#FFD700', '#FFA500'] : 
                                subscription.tier === 'plus' ? ['#C0C0C0', '#808080'] : 
                                [VOICES.rider.accent, VOICES.rider.accentDark]}
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
                        </View>
                    </LinearGradient>
                </View>

                <View style={s.grid}>
                    <View style={s.gridItem}>
                        <Text style={s.gridValue}>{stats.totalTrips}</Text>
                        <Text style={s.gridLabel}>MISSIONS</Text>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Text style={[s.gridValue, { color: VOICES.rider.accent }]}>⭐ {stats.rating}</Text>
                        <Text style={s.gridLabel}>RANKING</Text>
                    </View>
                    <View style={s.gridDivider} />
                    <View style={s.gridItem}>
                        <Text style={s.gridValue}>{stats.memberSince}</Text>
                        <Text style={s.gridLabel}>ENLISTED</Text>
                    </View>
                </View>

                <View style={s.menu}>
                    {menuItems.map((item, idx) => (
                        <TouchableOpacity
                            key={idx}
                            style={s.menuItem}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); (navigation.navigate as any)(item.nav, item.params); }}
                        >
                            <View style={s.menuItemLeft}>
                                <View style={[s.iconWrapper, { backgroundColor: VOICES.rider.accent + '1A' }]}>
                                    <Ionicons name={item.icon as any} size={20} color={VOICES.rider.accent} />
                                </View>
                                <Text style={[s.menuLabel, { marginLeft: 16 }]}>{item.label}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
                        </TouchableOpacity>
                    ))}
                </View>

                <TouchableOpacity style={s.logoutBtn} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); signOut(); }}>
                    <Text style={s.logoutText}>TERMINATE SESSION</Text>
                </TouchableOpacity>

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
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 32 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.15) },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },

    hero: { alignItems: 'center', marginBottom: 40 },
    avatarWrap: { width: 100, height: 100, borderRadius: 32, alignItems: 'center', justifyContent: 'center', ...elevationGlow(0.12) },
    avatarLetter: { fontSize: 36, fontWeight: '900', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },
    displayName: { fontSize: 22, fontWeight: '700', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },
    emailText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.6)', fontFamily: 'Manrope-Medium' },

    grid: { flexDirection: 'row', backgroundColor: SURFACE.containerLow, marginHorizontal: 20, borderRadius: 32, paddingVertical: 24, ...elevationGlow(0.12), marginBottom: 32 },
    gridItem: { flex: 1, alignItems: 'center' },
    gridDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.08)' },
    gridValue: { fontSize: 18, fontWeight: '800', color: '#FFF', marginBottom: 4, fontFamily: 'SpaceGrotesk-Bold' },
    gridLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold' },

    menu: { marginHorizontal: 20, backgroundColor: SURFACE.containerLow, borderRadius: 32, padding: 12, ...elevationGlow(0.12) },
    menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
    menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
    iconWrapper: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    menuLabel: { fontSize: 17, fontWeight: '700', color: '#FFF', fontFamily: 'Manrope-Bold' },

    logoutBtn: { marginHorizontal: 20, marginTop: 40, height: 64, borderRadius: 24, ...ghostBorder(0.15), backgroundColor: 'rgba(239,68,68,0.08)', alignItems: 'center', justifyContent: 'center' },
    logoutText: { fontSize: 16, fontWeight: '800', color: '#FF4D4D', fontFamily: 'SpaceGrotesk-Bold' },
    footerBranding: { alignItems: 'center', marginTop: 32, opacity: 0.8 },
    logoText: { fontSize: 18, fontWeight: '900', color: VOICES.rider.accent, letterSpacing: 2, fontFamily: 'SpaceGrotesk-Bold' },
    footerText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5, fontFamily: 'Manrope-Medium' },
    
    subscriptionCard: { marginHorizontal: 20, marginBottom: 24, borderRadius: 24, overflow: 'hidden' },
    subscriptionGradient: { borderRadius: 24 },
    subscriptionContent: { padding: 20 },
    subscriptionBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    tierText: { fontSize: 16, fontWeight: '800', color: '#FFF', fontFamily: 'SpaceGrotesk-Bold' },
    subscriptionPerks: { marginTop: 4 },
    perksText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)', fontFamily: 'Manrope-Medium' },
    upgradeHint: { marginTop: 12, alignSelf: 'flex-end' },
    upgradeText: { fontSize: 13, fontWeight: '700', color: '#FFF', fontFamily: 'Manrope-Medium' },
});
