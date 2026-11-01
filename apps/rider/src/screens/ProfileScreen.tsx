import React, { useEffect, useState, useCallback } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { BRAND_GRADIENT, Button, Card, Loading, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps, AppStackParamList } from '../navigation/types';

export function ProfileScreen({ navigation }: AppScreenProps<'Profile'>) {
    const { user, profile, signOut } = useAuth();

    const [stats, setStats] = useState({ totalTrips: 0, rating: '—', memberSince: '' });
    const [loading, setLoading] = useState(true);
    
    const [progression, setProgression] = useState({
        level: 1,
        label: 'New Rider' as string,
        discount_percent: 0,
        free_wait_minutes: 3,
        priority_matching: false,
        tier: 'free' as string,
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
                : '—'; // rides.rating is the stars this rider GAVE; never invent 5.0

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
            fetchProgressionPerks();
        } else {
            setLoading(false);
        }
    }, [user?.id, fetchProfileStats]);
    
    const fetchProgressionPerks = async () => {
        try {
            const [progRes, profileRes] = await Promise.all([
                supabase.from('rider_progression').select('*').eq('rider_id', user?.id).maybeSingle(),
                supabase.from('profiles').select('subscription_tier').eq('id', user?.id).single(),
            ]);

            const level = progRes.data?.level ?? 1;
            const tier = profileRes.data?.subscription_tier || 'free';
            const label = ['New Rider', 'Regular', 'Loyal', 'Elite', 'G-Member Eligible'][level - 1] ?? 'Rider';

            let discount = 0, wait = 3, priority = false;
            if (level >= 2) {
                const { data: cfg } = await supabase
                    .from('progression_config')
                    .select('discount_percent, free_wait_minutes, priority_matching')
                    .eq('level', level)
                    .single();
                if (cfg) {
                    discount = cfg.discount_percent;
                    wait = cfg.free_wait_minutes;
                    priority = cfg.priority_matching;
                }
            }
            if (tier === 'g_member') {
                discount = 15;
                wait = 20;
                priority = true;
            }

            setProgression({ level, label, discount_percent: discount, free_wait_minutes: wait, priority_matching: priority, tier });
        } catch (err) {
            console.warn('[ProfileScreen] Failed to fetch progression:', err);
        }
    };

    const displayName = profile?.full_name || (profile as any)?.name || user?.email?.split('@')[0] || 'Rider';
    const menuItems: { label: string; icon: any; nav: keyof AppStackParamList }[] = [
        { label: 'Edit profile', icon: 'person-outline', nav: 'EditProfile' },
        { label: 'G-Level', icon: 'diamond-outline', nav: 'Subscription' },
        { label: 'G assistant and safety', icon: 'sparkles-outline', nav: 'AISettings' },
        { label: 'Photo scanner', icon: 'scan-outline', nav: 'VisionScanner' },
        { label: 'Wallet and payment', icon: 'wallet-outline', nav: 'Wallet' },
        { label: 'Saved places', icon: 'location-outline', nav: 'SavedPlaces' },
        { label: 'G Spot', icon: 'wine-outline', nav: 'GSpot' },
        { label: 'Promotions', icon: 'gift-outline', nav: 'Promo' },
        { label: 'Help', icon: 'help-buoy-outline', nav: 'Help' },
        { label: 'Legal and privacy', icon: 'document-text-outline', nav: 'Legal' },
    ];

    // Deletion is the 30-day request/cancel flow, which lives in Settings.
    const handleDeleteAccount = () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        navigation.navigate('Settings');
    };

    const m = useTheme();
    const tierLabel = progression.tier === 'g_member' ? 'G-Member' : `Level ${progression.level} · ${progression.label}`;

    return (
        <Screen title="Profile" onBack={() => navigation.goBack()}>
            {loading ? <Loading /> : (
                <>
                    <View style={{ alignItems: 'center', marginTop: SPACE.sm }}>
                        <View style={{ width: 88, height: 88, borderRadius: 44, overflow: 'hidden' }}>
                            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <Txt variant="hero" tone="onBrand">{displayName.charAt(0).toUpperCase()}</Txt>
                            </LinearGradient>
                        </View>
                        <Txt variant="hero" style={{ marginTop: SPACE.md, textAlign: 'center' }}>{displayName}</Txt>
                        <Txt variant="body" tone="dim">{user?.email}</Txt>
                    </View>

                    <Card style={{ marginTop: SPACE.xl }} onPress={() => navigation.navigate('Subscription')}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name={progression.tier === 'g_member' ? 'diamond' : 'trending-up'} size={20} color={m.accent} />
                            <Txt variant="bodyStrong" style={{ marginLeft: SPACE.sm, flex: 1 }}>{tierLabel}</Txt>
                            <Ionicons name="chevron-forward" size={18} color={m.faint} />
                        </View>
                        <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                            {progression.discount_percent}% off rides · {progression.free_wait_minutes} min free waiting{progression.priority_matching ? ' · priority matching' : ''}
                        </Txt>
                    </Card>

                    <Card style={{ marginTop: SPACE.md, flexDirection: 'row' }}>
                        {[
                            { v: String(stats.totalTrips), l: 'Trips' },
                            { v: stats.rating === '—' ? '—' : `${stats.rating}★`, l: 'Stars you give' },
                            { v: stats.memberSince || '—', l: 'Member since' },
                        ].map((x, i) => (
                            <View key={x.l} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: m.chipBorder }}>
                                <Txt variant="headline">{x.v}</Txt>
                                <Txt variant="caption" tone="dim" style={{ textAlign: 'center' }}>{x.l}</Txt>
                            </View>
                        ))}
                    </Card>

                    <Section title="Account">
                        <Card style={{ paddingVertical: SPACE.xs }}>
                            {menuItems.map((item, idx) => (
                                <Row key={item.nav} icon={item.icon} title={item.label} last={idx === menuItems.length - 1}
                                    onPress={() => { Haptics.selectionAsync(); (navigation.navigate as any)(item.nav); }} />
                            ))}
                        </Card>
                    </Section>

                    <Button title="Sign out" variant="secondary" style={{ marginTop: SPACE.xl }} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); signOut(); }} />
                    <Button title="Delete account" variant="ghost" style={{ marginTop: SPACE.md }} onPress={handleDeleteAccount} />
                </>
            )}
        </Screen>
    );
}
