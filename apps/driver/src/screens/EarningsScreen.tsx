import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl, Text, Alert
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
import { Ionicons } from '@expo/vector-icons';

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

const DRIVER_SHARE = 0.81;

// ── helpers ───────────────────────────────────────────────────────────────────
function paymentIcon(method: string | null): string {
    if (method === 'cash') return 'cash-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'card-outline';
}
function paymentColor(method: string | null): string {
    if (method === 'cash') return COLORS.success;
    if (method === 'wallet') return COLORS.gold;
    return COLORS.warning;
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

        if (error) {
             Alert.alert("Sync Defect", "Could not fetch recent earnings. Swipe to try again.");
        } else if (data) {
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
                <ActivityIndicator color={COLORS.gold} size="large" />
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
                    <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>Partner Hub</Text>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 80 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
                }
            >
                <View style={[s.heroCard, {backgroundColor: COLORS.glassBg, borderColor: COLORS.glassBorder, borderWidth: 1, borderRadius: 24}]}>
                    <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.gold, letterSpacing: 1.5, marginBottom: 12 }}>
                        TODAY'S EARNINGS (81% SHARE)
                    </Text>

                    <Reanimated.Text style={s.earningsNum}>
                        {earningsDisplay.value}
                    </Reanimated.Text>
                    <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginTop: 4}}>TTD TOTAL</Text>

                    <View style={s.heroDivider} />

                    <View style={s.subRow}>
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>{stats.trips}</Text>
                            <Text style={{fontSize: 11, color: COLORS.textMuted}}>TRIPS</Text>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>${stats.week.toFixed(0)}</Text>
                            <Text style={{fontSize: 11, color: COLORS.textMuted}}>WEEK</Text>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>${stats.month.toFixed(0)}</Text>
                            <Text style={{fontSize: 11, color: COLORS.textMuted}}>MONTH</Text>
                        </View>
                    </View>
                </View>

                <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginBottom: 16, letterSpacing: 2}}>
                    RECENT LOGISTICS ACTIVITY
                </Text>

                {recentTrips.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={48} color="rgba(255,255,255,0.1)" />
                        <Text style={{fontSize: 14, color: COLORS.textMuted, marginTop: 16, textAlign: 'center'}}>
                            No completed trips recorded in this session.
                        </Text>
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
                                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}} numberOfLines={1}>
                                            {trip.dropoff_address || 'Logistics Completion'}
                                        </Text>
                                        <Text style={{fontSize: 11, color: COLORS.textMuted, marginTop: 4}}>
                                            {dateStr} · {timeStr}
                                        </Text>
                                    </View>

                                    <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.success}}>+${earnings}</Text>
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
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, borderBottomWidth: 1, borderColor: 'rgba(255,215,0,0.15)',
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
        color: COLORS.gold, letterSpacing: -2,
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
        borderColor: 'rgba(255,215,0,0.15)',
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
        borderWidth: 1, borderColor: 'rgba(255,215,0,0.15)',
        borderRadius: 24, borderStyle: 'dotted',
    },
});
