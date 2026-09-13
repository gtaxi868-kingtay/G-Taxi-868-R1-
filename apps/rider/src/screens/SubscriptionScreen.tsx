import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

interface LevelConfig {
    level: number;
    unlock_verticals: string[];
    threshold_type: string;
    threshold_value: number;
    discount_percent: number;
    priority_matching: boolean;
    free_wait_minutes: number;
}

interface ProgressionRow {
    level: number;
    total_rides: number;
    total_grocery_orders: number;
    total_laundry_orders: number;
    wallet_ever_funded: boolean;
    escape_ever_booked: boolean;
    unlocked_verticals: string[];
}

const LEVEL_META: Record<number, { label: string; icon: string; gradient: [string, string] }> = {
    1: { label: 'New Rider', icon: 'person-outline', gradient: ['#2A2F3A', '#1A1F27'] },
    2: { label: 'Regular', icon: 'bicycle-outline', gradient: ['#4A6741', '#2D4A26'] },
    3: { label: 'Loyal', icon: 'star-outline', gradient: ['#6B4E8A', '#3D2A5A'] },
    4: { label: 'Elite', icon: 'shield-checkmark-outline', gradient: ['#8A6E2A', '#5A4A1A'] },
    5: { label: 'G-Member Eligible', icon: 'diamond-outline', gradient: ['#CBD6DE', '#8A6E2A'] },
};

const PERK_ICONS: Record<string, string> = {
    grocery: 'cart-outline',
    food: 'fast-food-outline',
    laundry_nfc: 'shirt-outline',
    tap: 'radio-outline',
    gwallet_bonus: 'wallet-outline',
    g_escape: 'airplane-outline',
};

const PERK_LABELS: Record<string, string> = {
    grocery: 'Grocery',
    food: 'Food',
    laundry_nfc: 'Laundry NFC',
    tap: 'Tap to Pay',
    gwallet_bonus: 'G-Wallet',
    g_escape: 'G-Escape',
};

function fmtPrice(cents: number): string {
    return `TTD $${(cents / 100).toFixed(2)}`;
}

function getProgressCount(prog: ProgressionRow | null, level: number, cfg: LevelConfig): number {
    if (!prog) return 0;
    switch (cfg.threshold_type) {
        case 'rides': return prog.total_rides;
        case 'grocery_orders': return prog.total_grocery_orders;
        case 'laundry_orders': return prog.total_laundry_orders;
        case 'wallet_funded': return prog.wallet_ever_funded ? 1 : 0;
        case 'escape_booked': return prog.escape_ever_booked ? 1 : 0;
        default: return 0;
    }
}

export function SubscriptionScreen({ navigation }: AppScreenProps<'Subscription'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [levels, setLevels] = useState<LevelConfig[]>([]);
    const [progression, setProgression] = useState<ProgressionRow | null>(null);
    const [currentTier, setCurrentTier] = useState<string>('free');
    const [loading, setLoading] = useState(true);
    const [activating, setActivating] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [levelsRes, progRes, profileRes] = await Promise.all([
                supabase.from('progression_config').select('*').order('level', { ascending: true }),
                supabase.from('rider_progression').select('*').eq('rider_id', user?.id).maybeSingle(),
                supabase.from('profiles').select('subscription_tier').eq('id', user?.id).single(),
            ]);
            if (levelsRes.data) setLevels(levelsRes.data as LevelConfig[]);
            if (progRes.data) setProgression(progRes.data as ProgressionRow);
            if (profileRes.data) setCurrentTier(profileRes.data.subscription_tier || 'free');
        } catch (err) {
            console.warn('[Subscription] fetch failed:', err);
        } finally {
            setLoading(false);
        }
    }, [user?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const currentLevel = progression?.level ?? 1;
    const isGMember = currentTier === 'g_member';

    const handleJoinGMember = async () => {
        if (currentLevel < 5) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setActivating(true);
        try {
            // Billing is not live yet — activating the paid tier here would
            // hand out 15%-off perks with no payment collected (a real
            // revenue leak, not a demo nicety). Join requests go on a
            // waitlist; the tier flips on server-side once billing charges.
            Alert.alert(
                'Join G-Member',
                `TTD $60.00/mo — unlimited priority, 15% off your first 6 rides each month (then your Level 5 rate), 20-minute wait grace, no booking fees.\n\nBilling is launching soon. Reserve your spot and you'll be activated the moment payments go live.`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Reserve My Spot',
                        onPress: async () => {
                            const { error } = await supabase
                                .from('user_events')
                                .insert({
                                    user_id: user?.id,
                                    event_type: 'g_member_waitlist',
                                    payload: { level: currentLevel, requested_at: new Date().toISOString() },
                                });
                            if (error) {
                                Alert.alert('Error', error.message);
                            } else {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                Alert.alert('Spot Reserved', "You're on the G-Member list. We'll activate your perks the moment billing goes live — no action needed.");
                            }
                        }
                    },
                ]
            );
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed');
        } finally {
            setActivating(false);
        }
    };

    const handleCancelGMember = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setActivating(true);
        try {
            Alert.alert(
                'Cancel G-Member',
                'Your perks will revert to your Level 5 free benefits (12% off, 12min wait). You can rejoin anytime.',
                [
                    { text: 'Keep G-Member', style: 'cancel' },
                    {
                        text: 'Cancel Membership',
                        style: 'destructive',
                        onPress: async () => {
                            const { error } = await supabase
                                .from('profiles')
                                .update({ subscription_tier: 'free' })
                                .eq('id', user?.id);
                            if (error) {
                                Alert.alert('Error', error.message);
                            } else {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                setCurrentTier('free');
                            }
                        }
                    },
                ]
            );
        } finally {
            setActivating(false);
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>G-Level</Text>
                <View style={{ width: 44 }} />
            </View>

            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color={VOICES.rider.accent} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
                    <Text style={s.heading}>Ride. Unlock. Save.</Text>
                    <Text style={s.subheading}>
                        Every ride earns you better perks — discounts, priority matching, and more.
                        No monthly fee, no credit card. Just ride.
                    </Text>

                    <View style={s.levelBadge}>
                        <Text style={s.levelBadgeNum}>{currentLevel}</Text>
                        <View style={s.levelBadgeTextWrap}>
                            <Text style={s.levelBadgeLabel}>{LEVEL_META[currentLevel]?.label ?? 'Rider'}</Text>
                            <Text style={s.levelBadgePerks}>
                                {currentLevel >= 2
                                    ? `${levels.find(l => l.level === currentLevel)?.discount_percent ?? 0}% off rides`
                                    : 'Start riding to unlock perks'}
                            </Text>
                        </View>
                    </View>

                    <View style={s.ladder}>
                        {[1, 2, 3, 4, 5].map((lvl) => {
                            const meta = LEVEL_META[lvl];
                            const cfg = levels.find(l => l.level === lvl);
                            const isUnlocked = lvl <= currentLevel;
                            const isCurrent = lvl === currentLevel;
                            const isNext = lvl === currentLevel + 1;

                            const progress = isNext && cfg ? getProgressCount(progression, lvl, cfg) : 0;
                            const required = cfg?.threshold_value ?? 0;
                            const progressPct = required > 0 ? Math.min(progress / required, 1) : 0;

                            return (
                                <View
                                    key={lvl}
                                    style={[
                                        s.ladderStep,
                                        isCurrent && s.ladderStepActive,
                                        !isUnlocked && !isNext && s.ladderStepLocked,
                                    ]}
                                >
                                    <LinearGradient
                                        colors={isUnlocked ? meta.gradient : ['#1A1F27', '#0D1117']}
                                        style={StyleSheet.absoluteFillObject}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    />
                                    <View style={s.stepHead}>
                                        <View style={[s.stepIcon, isUnlocked && { backgroundColor: '#EAF3F6' }]}>
                                            <Ionicons
                                                name={(isUnlocked ? PERK_ICONS[cfg?.unlock_verticals?.[0] ?? ''] : 'lock-closed') as any}
                                                size={18}
                                                color={isUnlocked ? '#000' : 'rgba(255,255,255,0.3)'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[s.stepLvl, isUnlocked && s.stepLvlUnlocked]}>
                                                Level {lvl} — {meta.label}
                                            </Text>
                                            {isUnlocked && cfg && (
                                                <Text style={s.stepUnlock}>
                                                    {(cfg.unlock_verticals ?? []).map(v => PERK_LABELS[v] ?? v.replace(/_/g, ' ')).join(' + ')}
                                                    {lvl > 1 && ` • ${cfg.discount_percent}% off`}
                                                    {cfg.priority_matching && ' • Priority'}
                                                    {` • ${cfg.free_wait_minutes}min grace`}
                                                </Text>
                                            )}
                                            {!isUnlocked && !isNext && (
                                                <Text style={s.stepLockedText}>Keep riding to unlock</Text>
                                            )}
                                        </View>
                                        {isCurrent && (
                                            <View style={s.currentDot}>
                                                <Text style={s.currentDotText}>YOU</Text>
                                            </View>
                                        )}
                                    </View>

                                    {isNext && (
                                        <View style={s.progressWrap}>
                                            <View style={s.progressBar}>
                                                <View style={[s.progressFill, { width: `${(progressPct * 100)}%` as any }]} />
                                            </View>
                                            <Text style={s.progressText}>
                                                {cfg
                                                    ? `${required - progress} more ${cfg.threshold_type.replace('_', ' ')} to unlock`
                                                    : ''}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>

                    {currentLevel >= 5 && (
                        <View style={s.gMemberCard}>
                            <LinearGradient
                                colors={isGMember ? ['#CBD6DE', '#8A6E2A'] : ['#2A2F3A', '#1A1F27']}
                                style={StyleSheet.absoluteFillObject}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            />
                            <View style={s.gMemberContent}>
                                <View style={s.gMemberHead}>
                                    <Ionicons name="diamond" size={28} color={isGMember ? '#EAF3F6' : '#CBD6DE'} />
                                    <View style={{ flex: 1, marginLeft: 14 }}>
                                        <Text style={s.gMemberTitle}>G-Member</Text>
                                        <Text style={s.gMemberPrice}>{fmtPrice(6000)}/mo</Text>
                                    </View>
                                </View>

                                <Text style={s.gMemberDesc}>
                                    {isGMember
                                        ? 'You are a G-Member. Enjoy unlimited priority, 15% off your first 6 rides each month, and no booking fees.'
                                        : 'You\'ve earned Level 5 — now go further with unlimited priority matching, 15% off your first 6 rides each month, and 20-minute wait grace.'}
                                </Text>

                                <View style={s.featureList}>
                                    {[
                                        '15% off your first 6 rides/mo',
                                        'Unlimited priority matching',
                                        '20-minute wait grace',
                                        'No G-Escape booking fees',
                                        'Dedicated support',
                                    ].map((f, i) => (
                                        <View key={i} style={s.featureRow}>
                                            <Ionicons name="checkmark-circle" size={18} color={isGMember ? '#EAF3F6' : '#CBD6DE'} />
                                            <Text style={[s.featureText, isGMember && { color: '#EAF3F6' }]}>{f}</Text>
                                        </View>
                                    ))}
                                </View>

                                {isGMember ? (
                                    <TouchableOpacity
                                        style={[s.gMemberBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
                                        onPress={handleCancelGMember}
                                        disabled={activating}
                                    >
                                        {activating ? (
                                            <ActivityIndicator size="small" color="#EAF3F6" />
                                        ) : (
                                            <Text style={[s.gMemberBtnText, { color: '#EAF3F6' }]}>Cancel Membership</Text>
                                        )}
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity
                                        style={[s.gMemberBtn, { backgroundColor: '#CBD6DE' }]}
                                        onPress={handleJoinGMember}
                                        disabled={activating}
                                    >
                                        {activating ? (
                                            <ActivityIndicator size="small" color="#000" />
                                        ) : (
                                            <Text style={[s.gMemberBtnText, { color: '#000' }]}>Join G-Member</Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    )}

                    {currentLevel < 5 && (
                        <View style={[s.gMemberCard, s.gMemberLocked]}>
                            <View style={s.gMemberContent}>
                                <View style={s.gMemberHead}>
                                    <Ionicons name="lock-closed" size={24} color="rgba(255,255,255,0.3)" />
                                    <View style={{ flex: 1, marginLeft: 14 }}>
                                        <Text style={[s.gMemberTitle, { color: 'rgba(255,255,255,0.4)' }]}>G-Member</Text>
                                        <Text style={[s.gMemberPrice, { color: 'rgba(255,255,255,0.3)' }]}>
                                            Unlocks at Level 5
                                        </Text>
                                    </View>
                                </View>
                                <Text style={[s.gMemberDesc, { color: 'rgba(255,255,255,0.35)' }]}>
                                    Unlimited priority matching, 15% off your first 6 rides each month, 20-minute wait grace — all for TTD $60/mo.
                                    Keep riding to unlock.
                                </Text>
                            </View>
                        </View>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 24, marginBottom: 16,
    },
    backBtn: {
        width: 44, height: 44, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center',
        ...ghostBorder(0.15),
    },
    headerTitle: {
        fontSize: 20, fontWeight: '800', color: '#EAF3F6',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingHorizontal: 20, paddingTop: 8 },
    heading: {
        fontSize: 26, fontWeight: '900', color: '#EAF3F6',
        fontFamily: 'SpaceGrotesk-Bold', marginBottom: 8,
    },
    subheading: {
        fontSize: 14, color: 'rgba(242,245,248,0.6)',
        fontFamily: 'Manrope-Regular', lineHeight: 20, marginBottom: 24,
    },

    levelBadge: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: SURFACE.containerLow, borderRadius: 20,
        padding: 16, marginBottom: 28,
        ...elevationGlow(0.12),
    },
    levelBadgeNum: {
        fontSize: 40, fontWeight: '900', color: VOICES.rider.accent,
        fontFamily: 'SpaceGrotesk-Bold', width: 56, textAlign: 'center',
    },
    levelBadgeTextWrap: { flex: 1, marginLeft: 12 },
    levelBadgeLabel: {
        fontSize: 18, fontWeight: '800', color: '#EAF3F6',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    levelBadgePerks: {
        fontSize: 13, fontWeight: '600', color: 'rgba(242,245,248,0.6)',
        fontFamily: 'Manrope-Medium', marginTop: 2,
    },

    ladder: { gap: 12, marginBottom: 28 },
    ladderStep: {
        borderRadius: 20, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        padding: 18,
    },
    ladderStepActive: {
        borderColor: VOICES.rider.accent + '44',
        ...elevationGlow(0.15),
    },
    ladderStepLocked: { opacity: 0.5 },
    stepHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stepIcon: {
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    stepLvl: {
        fontSize: 15, fontWeight: '800', color: 'rgba(255,255,255,0.5)',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    stepLvlUnlocked: { color: '#EAF3F6' },
    stepUnlock: {
        fontSize: 12, fontWeight: '600', color: 'rgba(242,245,248,0.6)',
        fontFamily: 'Manrope-Medium', marginTop: 2,
    },
    stepLockedText: {
        fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.3)',
        fontFamily: 'Manrope-Medium', marginTop: 2,
    },
    currentDot: {
        paddingHorizontal: 10, paddingVertical: 4,
        borderRadius: 999, backgroundColor: VOICES.rider.accent + '22',
        borderWidth: 1, borderColor: VOICES.rider.accent + '44',
    },
    currentDotText: {
        fontSize: 9, fontWeight: '800', color: VOICES.rider.accent,
        fontFamily: 'SpaceGrotesk-Bold', letterSpacing: 0.5,
    },

    progressWrap: { marginTop: 14 },
    progressBar: {
        height: 6, borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
    },
    progressFill: {
        height: '100%', borderRadius: 3,
        backgroundColor: VOICES.rider.accent,
    },
    progressText: {
        fontSize: 12, fontWeight: '600', color: 'rgba(242,245,248,0.5)',
        fontFamily: 'Manrope-Medium', marginTop: 6,
    },

    gMemberCard: {
        borderRadius: 24, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(203,214,222,0.3)',
        marginBottom: 20,
    },
    gMemberLocked: {
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: SURFACE.containerLow,
    },
    gMemberContent: { padding: 24 },
    gMemberHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    gMemberTitle: {
        fontSize: 22, fontWeight: '900', color: '#EAF3F6',
        fontFamily: 'SpaceGrotesk-Bold',
    },
    gMemberPrice: {
        fontSize: 15, fontWeight: '700', color: '#CBD6DE',
        fontFamily: 'SpaceGrotesk-Bold', marginTop: 2,
    },
    gMemberDesc: {
        fontSize: 14, color: 'rgba(242,245,248,0.7)',
        fontFamily: 'Manrope-Regular', lineHeight: 20, marginBottom: 18,
    },
    featureList: { gap: 10, marginBottom: 24 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    featureText: {
        fontSize: 14, color: 'rgba(242,245,248,0.75)',
        fontFamily: 'Manrope-Medium', flex: 1,
    },
    gMemberBtn: {
        paddingVertical: 16, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center',
    },
    gMemberBtnText: {
        fontSize: 16, fontWeight: '800',
        fontFamily: 'SpaceGrotesk-Bold',
    },
});
