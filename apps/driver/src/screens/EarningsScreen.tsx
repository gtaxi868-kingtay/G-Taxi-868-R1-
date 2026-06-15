import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl, Text, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming,
    useDerivedValue,
} from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const DRIVER_SHARE = 0.81;

interface TripData {
    id: string;
    created_at: string;
    total_fare_cents: number;
    driver_payout_cents: number;
    payment_method: string | null;
    dropoff_address: string | null;
    status?: string;
}

interface NavigationProp {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
}

function paymentIcon(method: string | null): string {
    if (method === 'cash') return 'cash-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'card-outline';
}
function paymentColor(method: string | null): string {
    if (method === 'cash') return '#10B981';
    if (method === 'wallet') return VOICES.driver.accent;
    return VOICES.driver.accent;
}

export function EarningsScreen({ navigation }: { navigation: NavigationProp }) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState({ today: 0, week: 0, month: 0, trips: 0 });
    const [recentTrips, setRecentTrips] = useState<TripData[]>([]);

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
            .select('id, created_at, total_fare_cents, driver_payout_cents, payment_method, dropoff_address')
            .eq('driver_id', driver.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false });

        if (error) {
             Alert.alert("Sync Defect", "Could not fetch recent earnings. Swipe to try again.");
        } else if (data) {
            let todayCents = 0, weekCents = 0, monthCents = 0, tripsToday = 0;
            data.forEach(trip => {
                const payout = trip.driver_payout_cents || Math.round((trip.total_fare_cents || 0) * DRIVER_SHARE);
                if (trip.created_at >= startOfDay) { todayCents += payout; tripsToday += 1; }
                if (trip.created_at >= startOfWeek) weekCents += payout;
                if (trip.created_at >= monthStart) monthCents += payout;
            });

            setStats({
                today: todayCents / 100,
                week: weekCents / 100,
                month: monthCents / 100,
                trips: tripsToday,
            });
            earningsAnim.value = 0;
            earningsAnim.value = withTiming(todayCents, { duration: 900 });
            setRecentTrips(data.slice(0, 20));
        }
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id]);

    useEffect(() => {
        if (!driver?.id) return;

        fetchEarnings();

        const channel = supabase
            .channel(`driver_earnings:${driver.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'rides',
                    filter: `driver_id=eq.${driver.id}`,
                },
                (payload) => {
                    const ride = payload.new as TripData | null;
                    if (ride?.status === 'completed' || ride?.status === 'cancelled') {
                        fetchEarnings();
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [driver?.id, fetchEarnings]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchEarnings();
    };

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={VOICES.driver.accent} size="large" />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <BlurView tint="dark" intensity={90} style={[s.headerBlur, { paddingTop: insets.top }, glassSurface(90, 0.2)]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.goBack();
                        }}
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
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
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.driver.accent} colors={[VOICES.driver.accent]} />
                }
            >
                <View style={[s.heroCard, glassSurface(0.15)]}>
                    <Text style={{fontSize: 11, fontWeight: '700', color: VOICES.driver.accent, letterSpacing: 1.5, marginBottom: 12 }}>
                        Today's earnings
                    </Text>

                    <Reanimated.Text style={s.earningsNum}>
                        {earningsDisplay.value}
                    </Reanimated.Text>
                    <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginTop: 4}}>TTD total</Text>

                    <View style={s.heroDivider} />

                    <View style={s.subRow}>
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>{stats.trips}</Text>
                            <Text style={{fontSize: 11, color: 'rgba(255,255,255,0.6)'}}>Trips</Text>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>${stats.week.toFixed(0)}</Text>
                            <Text style={{fontSize: 11, color: 'rgba(255,255,255,0.6)'}}>Week</Text>
                        </View>
                        <View style={s.subSep} />
                        <View style={s.subItem}>
                            <Text style={{fontSize: 20, fontWeight: '800', color: '#FFF'}}>${stats.month.toFixed(0)}</Text>
                            <Text style={{fontSize: 11, color: 'rgba(255,255,255,0.6)'}}>Month</Text>
                        </View>
                    </View>
                </View>

                <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginBottom: 16, letterSpacing: 2}}>
                    Recent trips
                </Text>

                {recentTrips.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={48} color="rgba(255,255,255,0.1)" />
                        <Text style={{fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 16, textAlign: 'center'}}>
                            No completed trips recorded in this session.
                        </Text>
                    </View>
                ) : (
                    <View style={s.tripList}>
                        {recentTrips.map((trip, idx) => {
                            const date = new Date(trip.created_at);
                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            const payoutCents = trip.driver_payout_cents || Math.round((trip.total_fare_cents || 0) * DRIVER_SHARE);
                            const earnings = (payoutCents / 100).toFixed(2);
                            const isLast = idx === recentTrips.length - 1;

                            return (
                                <TouchableOpacity
                                    key={trip.id}
                                    style={[s.tripRow, isLast && { borderBottomWidth: 0 }]}
                                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                                    accessibilityLabel={`Trip to ${trip.dropoff_address || 'destination'}: $${earnings}`}
                                    accessibilityRole="button"
                                >
                                    <View style={[s.iconBadge, { backgroundColor: `${paymentColor(trip.payment_method)}15` }]}>
                                        <Ionicons name={paymentIcon(trip.payment_method) as 'cash-outline' | 'wallet-outline' | 'card-outline'} size={20} color={paymentColor(trip.payment_method)} />
                                    </View>

                                    <View style={{ flex: 1 }}>
                                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}} numberOfLines={1}>
                                            {trip.dropoff_address || 'Logistics Completion'}
                                        </Text>
                                        <Text style={{fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4}}>
                                            {dateStr} · {timeStr}
                                        </Text>
                                    </View>

                                    <Text style={{fontSize: 14, fontWeight: '700', color: '#10B981'}}>+${earnings}</Text>
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

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, ...ghostBorder(0.15),
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
        borderRadius: 24,
    },
    earningsNum: {
        fontSize: 56, fontWeight: '800',
        color: VOICES.driver.accent, letterSpacing: -2,
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
        ...ghostBorder(0.15),
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
        ...ghostBorder(0.15),
        borderRadius: 24, borderStyle: 'dotted',
    },
});
