import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, RefreshControl, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Screen, Txt, Card, Section, Pop, EmptyState, Button, Loading, FONT, SPACE, useTheme, IconName } from '../ui/kit';
import { DRIVE_COLORS, ttd } from '../theme/drive';
import { summariseEarnings, payoutOf, computeStreak, streakLine, ttDay } from '../utils/driveStats';

// Earnings tab: today big, then week and month, a 7-day bar chart, and the
// trips that made it. All on Trinidad dates, by when each trip finished.

interface TripRow {
    id: string;
    created_at: string;
    completed_at: string | null;
    total_fare_cents: number | null;
    driver_payout_cents: number | null;
    payment_method: string | null;
    dropoff_address: string | null;
}

function payIcon(method: string | null): IconName {
    if (method === 'cash') return 'cash-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'card-outline';
}

export function EarningsScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
    const m = useTheme();
    const { driver } = useAuth();
    const [rows, setRows] = useState<TripRow[] | null>(null);
    const [error, setError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const fetchEarnings = useCallback(async () => {
        if (!driver?.id) return;
        // 35 days covers this month and a week that began last month.
        const { data, error: err } = await supabase
            .from('rides')
            .select('id, created_at, completed_at, total_fare_cents, driver_payout_cents, payment_method, dropoff_address')
            .eq('driver_id', driver.id)
            // finished rides move on to payment_confirmed / closed after settlement
            .in('status', ['completed', 'payment_confirmed', 'closed'])
            .gte('created_at', new Date(Date.now() - 35 * 86_400_000).toISOString())
            .order('created_at', { ascending: false });
        if (err) setError(true);
        else { setError(false); setRows((data as TripRow[]) ?? []); }
        setRefreshing(false);
    }, [driver?.id]);

    useEffect(() => {
        if (!driver?.id) return;
        fetchEarnings();
        const channel = supabase
            .channel(`driver_earnings:${driver.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `driver_id=eq.${driver.id}` }, (payload: any) => {
                if (['completed', 'payment_confirmed', 'closed'].includes(payload.new?.status)) fetchEarnings();
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [driver?.id, fetchEarnings]);

    const refresh = <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEarnings(); }} tintColor={m.accent} colors={[m.accent]} />;

    if (rows === null && !error) return <Screen title="Earnings"><Loading /></Screen>;
    if (rows === null) {
        return (
            <Screen title="Earnings" refreshControl={refresh}>
                <EmptyState icon="cloud-offline-outline" title="Couldn't load your earnings" body="Check your signal, then pull down or tap below to try again."
                    action={<Button title="Try again" variant="secondary" onPress={() => { setError(false); fetchEarnings(); }} />} />
            </Screen>
        );
    }

    const sum = summariseEarnings(rows);
    const streak = computeStreak(rows.map((r) => r.completed_at || ''));
    const maxBar = Math.max(1, ...sum.last7.map((b) => b.cents));
    const today = ttDay(new Date());

    return (
        <Screen title="Earnings" refreshControl={refresh}>
            {error ? <Txt variant="caption" tone="danger" style={{ marginBottom: SPACE.md }}>Couldn't refresh. Showing your last loaded numbers.</Txt> : null}

            <Pop>
                <Card>
                    <Txt variant="overline" tone="faint">TODAY</Txt>
                    <Text style={[st.big, { color: DRIVE_COLORS.money }]} numberOfLines={1} adjustsFontSizeToFit>{ttd(sum.todayCents)}</Text>
                    <View style={st.inline}>
                        <Txt tone="dim">{sum.todayTrips} {sum.todayTrips === 1 ? 'trip' : 'trips'}</Txt>
                        <View style={st.dotSep} />
                        <Ionicons name="flame" size={15} color={streak.days > 0 ? DRIVE_COLORS.streak : m.faint} />
                        <Txt tone="dim" style={{ marginLeft: 4 }}>{streakLine(streak.days, streak.todayDone)}</Txt>
                    </View>
                </Card>
            </Pop>

            <View style={st.pair}>
                <Pop delay={60} style={{ flex: 1 }}>
                    <Card>
                        <Txt variant="caption" tone="faint">This week</Txt>
                        <Txt variant="title" style={{ color: m.ink, marginTop: 2 }}>{ttd(sum.weekCents, 0)}</Txt>
                        <Txt variant="caption" tone="dim">{sum.weekTrips} trips since Monday</Txt>
                    </Card>
                </Pop>
                <Pop delay={120} style={{ flex: 1 }}>
                    <Card>
                        <Txt variant="caption" tone="faint">This month</Txt>
                        <Txt variant="title" style={{ color: m.ink, marginTop: 2 }}>{ttd(sum.monthCents, 0)}</Txt>
                        <Txt variant="caption" tone="dim">{sum.monthTrips} trips</Txt>
                    </Card>
                </Pop>
            </View>

            <Section title="Last 7 days">
                <Card>
                    <View style={st.chart}>
                        {sum.last7.map((b) => (
                            <View key={b.day} style={st.barCol} accessible accessibilityLabel={`${b.label}: ${ttd(b.cents)}, ${b.trips} trips`}>
                                <Txt variant="caption" tone="faint" style={{ fontSize: 10 }}>{b.cents > 0 ? `$${Math.round(b.cents / 100)}` : ''}</Txt>
                                <View style={[st.barTrack, { backgroundColor: m.field }]}>
                                    <View style={[st.bar, {
                                        height: `${Math.max(b.cents > 0 ? 6 : 0, (b.cents / maxBar) * 100)}%`,
                                        backgroundColor: b.day === today ? DRIVE_COLORS.money : DRIVE_COLORS.moneyDeep,
                                    }]} />
                                </View>
                                <Txt variant="caption" tone={b.day === today ? 'ink' : 'faint'} style={{ fontSize: 11 }}>{b.label}</Txt>
                            </View>
                        ))}
                    </View>
                </Card>
            </Section>

            <Section title="Recent trips">
                {rows.length === 0 ? (
                    <EmptyState icon="car-outline" title="No trips yet" body="Your finished trips and what you earned on each show up here."
                        action={<Button title="Go to Drive" icon="navigate" color={DRIVE_COLORS.online} onPress={() => navigation.navigate('Drive')} />} />
                ) : (
                    <Card style={{ paddingVertical: 0 }}>
                        {rows.slice(0, 20).map((t, i) => {
                            const when = new Date(t.completed_at || t.created_at);
                            const time = when.toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
                            return (
                                <View key={t.id} style={[st.trip, { borderBottomColor: m.chipBorder, borderBottomWidth: i === Math.min(rows.length, 20) - 1 ? 0 : 1 }]}>
                                    <View style={[st.tripIcon, { backgroundColor: m.field }]}>
                                        <Ionicons name={payIcon(t.payment_method)} size={18} color={t.payment_method === 'cash' ? DRIVE_COLORS.money : DRIVE_COLORS.cyan} />
                                    </View>
                                    <View style={{ flex: 1, marginHorizontal: SPACE.md }}>
                                        <Txt variant="bodyStrong" numberOfLines={1}>{t.dropoff_address || 'Trip'}</Txt>
                                        <Txt variant="caption" tone="faint">{time}{t.driver_payout_cents == null ? ' · estimate' : ''}</Txt>
                                    </View>
                                    <Txt variant="bodyStrong" style={{ color: DRIVE_COLORS.online }}>+{ttd(payoutOf(t))}</Txt>
                                </View>
                            );
                        })}
                    </Card>
                )}
            </Section>
        </Screen>
    );
}

const st = StyleSheet.create({
    big: { fontFamily: FONT.roundBlack, fontSize: 48, lineHeight: 56, fontVariant: ['tabular-nums'] },
    inline: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    dotSep: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 10 },
    pair: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.md },
    chart: { flexDirection: 'row', height: 150, alignItems: 'flex-end', gap: 6 },
    barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4 },
    barTrack: { width: '100%', flex: 1, borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' },
    bar: { width: '100%', borderRadius: 8 },
    trip: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.md },
    tripIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
