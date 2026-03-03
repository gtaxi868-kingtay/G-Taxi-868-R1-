import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';

const DRIVER_SHARE = 0.81;

export function EarningsScreen() {
    const { driver } = useAuth();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        today: 0,
        week: 0,
        trips: 0
    });
    const [recentTrips, setRecentTrips] = useState<any[]>([]);

    useEffect(() => {
        if (!driver?.id) return;

        const fetchEarnings = async () => {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

            // Use a separate Date object for week start to avoid mutating `now`
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);
            const startOfWeek = weekStart.toISOString();

            const { data, error } = await supabase
                .from('rides')
                .select('id, created_at, total_fare_cents, payment_method, dropoff_address')
                .eq('driver_id', driver.id)
                .eq('status', 'completed')
                .order('created_at', { ascending: false });

            if (data && !error) {
                let todayCents = 0;
                let weekCents = 0;
                let tripsToday = 0;

                data.forEach(trip => {
                    const fare = trip.total_fare_cents || 0;
                    if (trip.created_at >= startOfWeek) weekCents += fare;
                    if (trip.created_at >= startOfDay) {
                        todayCents += fare;
                        tripsToday += 1;
                    }
                });

                setStats({
                    today: (todayCents * DRIVER_SHARE) / 100,
                    week: (weekCents * DRIVER_SHARE) / 100,
                    trips: tripsToday
                });

                setRecentTrips(data.slice(0, 15));
            }
            setLoading(false);
        };

        fetchEarnings();
    }, [driver?.id]);

    if (loading) {
        return (
            <View style={[styles.container, styles.center]}>
                <ActivityIndicator color={tokens.colors.primary.purple} size="large" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll}>

                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={styles.header}>
                    Your Earnings
                </Txt>

                {/* Hero Stat */}
                <Card padding="xl" elevation="level3" radius="xl" style={styles.heroCard}>
                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>TODAY (81% SHARE)</Txt>
                    <Txt variant="displayXL" weight="bold" color={tokens.colors.status.success} style={{ marginVertical: 8 }}>
                        ${stats.today.toFixed(2)}
                    </Txt>
                    <View style={styles.heroSubRow}>
                        <View style={styles.heroSubItem}>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>{stats.trips}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>Completed Trips</Txt>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.heroSubItem}>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>${stats.week.toFixed(2)}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>This Week</Txt>
                        </View>
                    </View>
                </Card>

                <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} style={styles.sectionTitle}>
                    Recent Activity
                </Txt>

                {recentTrips.length === 0 ? (
                    <Surface intensity={30} style={styles.emptyState}>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary}>No recent trips.</Txt>
                    </Surface>
                ) : (
                    recentTrips.map(trip => {
                        const date = new Date(trip.created_at);
                        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const earnings = ((trip.total_fare_cents || 0) * DRIVER_SHARE / 100).toFixed(2);

                        return (
                            <Surface key={trip.id} intensity={40} style={styles.tripItem}>
                                <View style={styles.tripIcon}>
                                    <Txt style={{ fontSize: 20 }}>
                                        {trip.payment_method === 'cash' ? '💵' : trip.payment_method === 'wallet' ? '👛' : '💳'}
                                    </Txt>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={1}>
                                        {trip.dropoff_address || 'Completed Trip'}
                                    </Txt>
                                    <Txt variant="caption" color={tokens.colors.text.secondary} style={{ marginTop: 4 }}>
                                        {date.toLocaleDateString()} • {timeStr}
                                    </Txt>
                                </View>
                                <Txt variant="bodyBold" color={tokens.colors.status.success}>+${earnings}</Txt>
                            </Surface>
                        );
                    })
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { padding: 20 },
    header: { marginBottom: 24, marginTop: 10 },
    heroCard: { alignItems: 'center', marginBottom: 32 },
    heroSubRow: { flexDirection: 'row', width: '100%', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: tokens.colors.border.subtle },
    heroSubItem: { flex: 1, alignItems: 'center' },
    divider: { width: 1, height: '100%', backgroundColor: tokens.colors.border.subtle },
    sectionTitle: { marginBottom: 16 },
    tripItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    tripIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    emptyState: { padding: 32, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: tokens.colors.border.subtle, borderStyle: 'dashed' },
});
