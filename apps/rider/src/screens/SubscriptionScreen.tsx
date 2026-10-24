import React, { useEffect, useState, useCallback } from 'react';
import { View, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { BrandBadge, Button, Card, Loading, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
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
                                toast(error.message, 'error');
                            } else {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                toast("You're on the G-Member list. We'll switch it on when billing starts.", 'success');
                            }
                        }
                    },
                ]
            );
        } catch (err: any) {
            toast(err.message || 'Something went wrong.', 'error');
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
                            // Riders cannot write subscription_tier directly
                            // (that would let anyone set a paid tier).
                            const { error } = await supabase.rpc('rider_cancel_g_membership');
                            if (error) {
                                toast(error.message, 'error');
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

    const m = useTheme();
    const perks = ['15% off your first 6 rides each month', 'Unlimited priority matching', '20 minutes free waiting', 'No G-Escape booking fees', 'Dedicated support'];

    return (
        <Screen
            title="G-Level"
            onBack={() => navigation.goBack()}
            hero={
                <View>
                    <Txt variant="hero">Ride more, save more</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Every ride moves you up. Better levels bring discounts and priority. No fee, no card.</Txt>
                </View>
            }
        >
            {loading ? <Loading /> : (
                <>
                    <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <BrandBadge icon={(LEVEL_META[currentLevel]?.icon || 'person-outline') as any} size={52} round />
                        <View style={{ flex: 1, marginLeft: SPACE.md }}>
                            <Txt variant="title">Level {currentLevel} · {LEVEL_META[currentLevel]?.label ?? 'Rider'}</Txt>
                            <Txt variant="caption" tone="dim">
                                {currentLevel >= 2 ? `${levels.find(l => l.level === currentLevel)?.discount_percent ?? 0}% off rides` : 'Take your first rides to start unlocking perks'}
                            </Txt>
                        </View>
                    </Card>

                    <Section title="Levels">
                        {[1, 2, 3, 4, 5].map((lvl) => {
                            const meta = LEVEL_META[lvl];
                            const cfg = levels.find(l => l.level === lvl);
                            const unlocked = lvl <= currentLevel;
                            const current = lvl === currentLevel;
                            const next = lvl === currentLevel + 1;
                            const progress = next && cfg ? getProgressCount(progression, lvl, cfg) : 0;
                            const required = cfg?.threshold_value ?? 0;
                            const pct = required > 0 ? Math.min(progress / required, 1) : 0;
                            return (
                                <Card key={lvl} style={{ marginBottom: SPACE.sm, borderColor: current ? m.accent : m.chipBorder, opacity: unlocked || next ? 1 : 0.6 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: unlocked ? '#8B7CFF' : m.field }}>
                                            <Ionicons name={(unlocked ? meta.icon : 'lock-closed-outline') as any} size={16} color={unlocked ? '#FFFFFF' : m.faint} />
                                        </View>
                                        <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                            <Txt variant="bodyStrong">Level {lvl} · {meta.label}</Txt>
                                            {cfg && (unlocked || next) ? (
                                                <Txt variant="caption" tone="dim">
                                                    {[(cfg.unlock_verticals ?? []).map(v => PERK_LABELS[v] ?? v.replace(/_/g, ' ')).join(' + '),
                                                      lvl > 1 ? `${cfg.discount_percent}% off` : null,
                                                      cfg.priority_matching ? 'priority' : null,
                                                      `${cfg.free_wait_minutes} min free waiting`].filter(Boolean).join(' · ')}
                                                </Txt>
                                            ) : <Txt variant="caption" tone="faint">Keep riding to unlock</Txt>}
                                        </View>
                                        {current && <Txt variant="label" tone="accent">You</Txt>}
                                    </View>
                                    {next && cfg && (
                                        <View style={{ marginTop: SPACE.md }}>
                                            <View style={{ height: 6, borderRadius: 3, backgroundColor: m.field, overflow: 'hidden' }}>
                                                <View style={{ height: 6, width: `${pct * 100}%` as any, backgroundColor: '#8B7CFF' }} />
                                            </View>
                                            <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>
                                                {Math.max(0, required - progress)} more {cfg.threshold_type.replace(/_/g, ' ')} to unlock
                                            </Txt>
                                        </View>
                                    )}
                                </Card>
                            );
                        })}
                    </Section>

                    <Section title="G-Member">
                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name={currentLevel >= 5 ? 'diamond' : 'lock-closed-outline'} size={22} color={m.accent} />
                                <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                    <Txt variant="title">G-Member</Txt>
                                    <Txt variant="caption" tone="dim">{currentLevel >= 5 ? `${fmtPrice(6000)} a month` : 'Unlocks at level 5'}</Txt>
                                </View>
                                {isGMember && <Txt variant="label" tone="success">Active</Txt>}
                            </View>
                            <View style={{ marginTop: SPACE.md }}>
                                {perks.map(p => (
                                    <View key={p} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                                        <Ionicons name="checkmark-circle" size={16} color={currentLevel >= 5 ? '#2FB57C' : m.faint} />
                                        <Txt variant="body" tone={currentLevel >= 5 ? 'ink' : 'dim'} style={{ marginLeft: SPACE.sm }}>{p}</Txt>
                                    </View>
                                ))}
                            </View>
                            {currentLevel >= 5 && (isGMember
                                ? <Button title="Cancel membership" variant="ghost" style={{ marginTop: SPACE.lg }} loading={activating} onPress={handleCancelGMember} />
                                : <Button title="Reserve my G-Member spot" style={{ marginTop: SPACE.lg }} loading={activating} onPress={handleJoinGMember} />)}
                        </Card>
                    </Section>
                </>
            )}
        </Screen>
    );
}
