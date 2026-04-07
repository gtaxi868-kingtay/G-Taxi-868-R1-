import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl, Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, useAnimatedStyle,
    useDerivedValue, withSpring,
} from 'react-native-reanimated';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';
import { GlassCard, BRAND, VOICES, SEMANTIC, RADIUS, GRADIENTS } from '../design-system';
import { Ionicons } from '@expo/vector-icons';

const DRIVER_SHARE = 0.81;

// ── helpers ───────────────────────────────────────────────────────────────────
function paymentIcon(method: string | null): string {
    if (method === 'cash') return 'cash-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'card-outline';
}
function paymentColor(method: string | null): string {
    if (method === 'cash') return SEMANTIC.success;
    if (method === 'wallet') return BRAND.cyan;
    return SEMANTIC.warning;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function EarningsScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState({ today: 0, week: 0, month: 0, trips: 0 });
    const [recentTrips, setRecentTrips] = useState<any[]>([]);

    const earningsAnim = useSharedValue(0);
    const earningsDisplay = useDerivedValue(() =>
        `$${earningsAnim.value.toFixed(2)}`
    );

    const fetchEarnings = useCallback(async () => {
        if (!driver?.id) return;
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const startOfWeek = weekStart.toISOString();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data, error } = await supabase
            .from('rides')
            .select('id, created_at, total_fare_cents, payment_method, dropoff_address')
            .eq('driver_id', driver.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false });

        if (data && !error) {
            let todayCents = 0, weekCents = 0, monthCents = 0, tripsToday = 0;
            data.forEach(trip => {
                const fare = trip.total_fare_cents || 0;
                if (trip.created_at >= startOfDay) { todayCents += fare; tripsToday += 1; }
                if (trip.created_at >= startOfWeek) weekCents += fare;
                if (trip.created_at >= monthStart) monthCents += fare;
            });

            const todayVal = (todayCents * DRIVER_SHARE) / 100;
            setStats({
                today: todayVal,
                week: (weekCents * DRIVER_SHARE) / 100,
                month: (monthCents * DRIVER_SHARE) / 100,
                trips: tripsToday,
            });
            earningsAnim.value = 0;
            earningsAnim.value = withTiming(todayVal, { duration: 900 });
            setRecentTrips(data.slice(0, 20));
        }
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id]);

    useEffect(() => {
        fetchEarnings();
    }, [fetchEarnings]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchEarnings();
    };

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={BRAND.cyan} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <BlurView tint="dark" intensity={90} style={[s.headerBlur, { paddingTop: insets.top }]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.goBack();
                        }}
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Txt variant="headingM" weight="heavy" color="#FFF">Partner Hub</Txt>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 80 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND.cyan} colors={[BRAND.cyan]} />
                }
            >
                <GlassCard variant="driver" style={s.heroCard}>
                    <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ letterSpacing: 1.5, marginBottom: 12 }}>
                        TODAY'S EARNINGS (81% SHARE)
                    </Txt>

                    <Reanimated.Text style={s.earningsNum}>
                        {earningsDisplay.value}
                    </Reanimated.Text>
                    <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={{ marginTop: 4 }}>TTD TOTAL</Txt>

                    <View style={s.heroDivider} />

                    <View style={s.subRow}>
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="heavy" color="#FFF">{stats.trips}</Txt>
                            <Txt variant="caption" color={VOICES.driver.textMuted}>TRIPS</Txt>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="heavy" color="#FFF">${stats.week.toFixed(0)}</Txt>
                            <Txt variant="caption" color={VOICES.driver.textMuted}>WEEK</Txt>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="heavy" color="#FFF">${stats.month.toFixed(0)}</Txt>
                            <Txt variant="caption" color={VOICES.driver.textMuted}>MONTH</Txt>
                        </View>
                    </View>
                </GlassCard>

                <Txt variant="caption" weight="heavy" color={VOICES.driver.textMuted} style={[s.sectionLabel, { letterSpacing: 2 }]}>
                    RECENT LOGISTICS ACTIVITY
                </Txt>

                {recentTrips.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={48} color="rgba(255,255,255,0.1)" />
                        <Txt variant="bodyReg" color={VOICES.driver.textMuted} style={{ marginTop: 16, textAlign: 'center' }}>
                            No completed trips recorded in this session.
                        </Txt>
                    </View>
                ) : (
                    <View style={s.tripList}>
                        {recentTrips.map((trip, idx) => {
                            const date = new Date(trip.created_at);
                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            const earnings = ((trip.total_fare_cents || 0) * DRIVER_SHARE / 100).toFixed(2);
                            const isLast = idx === recentTrips.length - 1;

                            return (
                                <TouchableOpacity
                                    key={trip.id}
                                    style={[s.tripRow, isLast && { borderBottomWidth: 0 }]}
                                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                                >
                                    <View style={[s.iconBadge, { backgroundColor: `${paymentColor(trip.payment_method)}15` }]}>
                                        <Ionicons name={paymentIcon(trip.payment_method) as any} size={20} color={paymentColor(trip.payment_method)} />
                                    </View>

                                    <View style={{ flex: 1 }}>
                                        <Txt variant="bodyBold" weight="heavy" color="#FFF" numberOfLines={1}>
                                            {trip.dropoff_address || 'Logistics Completion'}
                                        </Txt>
                                        <Txt variant="caption" color={VOICES.driver.textMuted} style={{ marginTop: 4 }}>
                                            {dateStr} · {timeStr}
                                        </Txt>
                                    </View>

                                    <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.success}>+$${earnings}</Txt>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
    },
    headerInner: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16,
    },
    backBtn: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center',
    },

    heroCard: {
        padding: 24,
        marginBottom: 32,
        alignItems: 'center',
    },
    earningsNum: {
        fontSize: 56, fontWeight: '800',
        color: BRAND.cyan, letterSpacing: -2,
        marginVertical: 4,
    },
    heroDivider: {
        width: '100%', height: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
        marginVertical: 20,
    },
    subRow: {
        flexDirection: 'row', width: '100%',
        alignItems: 'center',
    },
    subItem: { flex: 1, alignItems: 'center', gap: 4 },
    subSep: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.08)' },

    sectionLabel: { marginBottom: 16 },

    tripList: {
        backgroundColor: 'rgba(255,255,255,0.02)',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
        overflow: 'hidden',
    },
    tripRow: {
        flexDirection: 'row', alignItems: 'center',
        gap: 16, paddingHorizontal: 16, paddingVertical: 18,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    iconBadge: {
        width: 44, height: 44, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
    },

    emptyWrap: {
        paddingVertical: 64, alignItems: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
        borderRadius: 24, borderStyle: 'dotted',
    },
});
