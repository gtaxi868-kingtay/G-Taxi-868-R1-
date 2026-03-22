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
import { Ionicons } from '@expo/vector-icons';

// ── BUG_FIX 2+3: Driver-only C tokens — NO tokens.* import ───────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(139,92,246,0.15)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    purpleDim: 'rgba(124,58,237,0.18)',
    gold: '#F59E0B',
    goldDim: 'rgba(245,158,11,0.12)',
    green: '#10B981',
    greenDim: 'rgba(16,185,129,0.12)',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
};

// BUG_FIX 1: navigation prop added
// WIRING_RULE: DO NOT remove fetchEarnings() or DRIVER_SHARE date calculations
const DRIVER_SHARE = 0.81; // keep exactly

// ── helpers ───────────────────────────────────────────────────────────────────
function paymentIcon(method: string | null): string {
    if (method === 'cash') return 'cash-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'card-outline';
}
function paymentColor(method: string | null): string {
    if (method === 'cash') return C.green;
    if (method === 'wallet') return C.purple;
    return C.gold;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function EarningsScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState({ today: 0, week: 0, month: 0, trips: 0 });
    const [recentTrips, setRecentTrips] = useState<any[]>([]);

    // Reanimated count-up for today's earnings
    const earningsAnim = useSharedValue(0);
    const earningsDisplay = useDerivedValue(() =>
        `$${earningsAnim.value.toFixed(2)}`
    );

    // ── WIRING: fetchEarnings — DO NOT REMOVE OR ALTER DRIVER_SHARE LOGIC ────
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
            // Count-up animation: 0 → todayVal over 900ms
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

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={C.purple} size="large" />
            </View>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <View style={s.root}>
            {/* ── HEADER — BlurView ────────────────────────────────────────── */}
            <BlurView tint="dark" intensity={80} style={[s.headerBlur, { paddingTop: insets.top + 8 }]}>
                <LinearGradient
                    colors={['rgba(17,14,34,0.95)', 'rgba(7,5,15,0.6)']}
                    style={s.headerInner}
                >
                    {/* Back */}
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.goBack();
                        }}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="chevron-back" size={22} color={C.white} />
                    </TouchableOpacity>

                    <Txt variant="headingM" weight="bold" color={C.white}>Earnings</Txt>

                    {/* Spacer — matches back button width for visual centering */}
                    <View style={s.backBtn} pointerEvents="none" />
                </LinearGradient>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={C.purple}
                        colors={[C.purple]}
                    />
                }
            >
                {/* ── HERO CARD ──────────────────────────────────────────── */}
                <LinearGradient
                    colors={['#2D1B69', '#1E1040', '#110E22']}
                    style={s.heroCard}
                >
                    <Txt variant="caption" weight="bold" color={C.purpleLight}
                        style={{ letterSpacing: 1, marginBottom: 6 }}>
                        TODAY'S EARNINGS · 81% SHARE
                    </Txt>

                    {/* Animated count-up number */}
                    <Reanimated.Text style={s.earningsNum}>
                        {earningsDisplay.value}
                    </Reanimated.Text>
                    <Txt variant="small" color={C.muted} style={{ marginTop: 2 }}>TTD</Txt>

                    {/* Divider */}
                    <View style={s.heroDivider} />

                    {/* Sub-stats row */}
                    <View style={s.subRow}>
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="bold" color={C.white}>{stats.trips}</Txt>
                            <Txt variant="small" color={C.muted}>Trips Today</Txt>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="bold" color={C.white}>
                                ${stats.week.toFixed(2)}
                            </Txt>
                            <Txt variant="small" color={C.muted}>This Week</Txt>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Txt variant="headingM" weight="bold" color={C.white}>
                                ${stats.month.toFixed(2)}
                            </Txt>
                            <Txt variant="small" color={C.muted}>This Month</Txt>
                        </View>
                    </View>
                </LinearGradient>

                {/* ── SECTION LABEL ─────────────────────────────────────── */}
                <Txt variant="caption" weight="bold" color={C.muted}
                    style={[s.sectionLabel, { letterSpacing: 1 }]}>
                    RECENT ACTIVITY
                </Txt>

                {/* ── TRIP LIST ─────────────────────────────────────────── */}
                {recentTrips.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={36} color={C.muted} />
                        <Txt variant="bodyReg" color={C.muted} style={{ marginTop: 12, textAlign: 'center' }}>
                            No completed trips yet.{'\n'}Pull down to refresh.
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
                                    onPress={() => {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        // display only for now — no navigation
                                    }}
                                    activeOpacity={0.75}
                                >
                                    {/* Payment icon badge */}
                                    <View style={[s.iconBadge, { backgroundColor: `${paymentColor(trip.payment_method)}18` }]}>
                                        <Ionicons
                                            name={paymentIcon(trip.payment_method) as any}
                                            size={18}
                                            color={paymentColor(trip.payment_method)}
                                        />
                                    </View>

                                    {/* Destination + timestamp */}
                                    <View style={{ flex: 1 }}>
                                        <Txt variant="bodyBold" color={C.white} numberOfLines={1}>
                                            {trip.dropoff_address || 'Completed Trip'}
                                        </Txt>
                                        <Txt variant="small" color={C.muted} style={{ marginTop: 3 }}>
                                            {dateStr} · {timeStr}
                                        </Txt>
                                    </View>

                                    {/* Earnings */}
                                    <Txt variant="bodyBold" color={C.green}>
                                        +${earnings}
                                    </Txt>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                <View style={{ height: insets.bottom + 24 }} />
            </ScrollView>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    // Header
    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, borderBottomWidth: 1, borderColor: C.border,
    },
    headerInner: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center', justifyContent: 'center',
    },

    // Hero card
    heroCard: {
        borderRadius: 24,
        padding: 24,
        marginBottom: 28,
        borderWidth: 1,
        borderColor: 'rgba(124,58,237,0.2)',
        alignItems: 'center',
    },
    earningsNum: {
        fontSize: 52, fontWeight: '800',
        color: C.gold, letterSpacing: -1,
        marginVertical: 4,
    },
    heroDivider: {
        width: '100%', height: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
        marginVertical: 18,
    },
    subRow: {
        flexDirection: 'row', width: '100%',
        alignItems: 'center',
    },
    subItem: { flex: 1, alignItems: 'center', gap: 4 },
    subSep: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.08)' },

    // Section label
    sectionLabel: { marginBottom: 12 },

    // Trip list
    tripList: {
        backgroundColor: C.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
    },
    tripRow: {
        flexDirection: 'row', alignItems: 'center',
        gap: 14, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.04)',
    },
    iconBadge: {
        width: 40, height: 40, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },

    // Empty
    emptyWrap: {
        paddingVertical: 48, alignItems: 'center',
        borderWidth: 1, borderColor: C.border,
        borderRadius: 20, borderStyle: 'dashed',
    },
});
