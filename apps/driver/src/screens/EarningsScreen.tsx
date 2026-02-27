import React, { useEffect, useState } from 'react';
import {
    View,
    StyleSheet,
    FlatList,
    ActivityIndicator,
    SafeAreaView,
    TouchableOpacity,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

// ── Locked business rule ────────────────────────────────────────────────────
// Driver keeps 81% of total_fare_cents on every ride (cash, wallet, or card).
// Platform takes 19% commission.
const DRIVER_SHARE = 0.81;

interface CompletedRide {
    id: string;
    created_at: string;
    pickup_address: string | null;
    total_fare_cents: number;
    payment_method: string | null;
}

interface PeriodStats {
    earnings: number;  // in cents, 81% of total fares
    trips: number;
}

function getStartOf(period: 'day' | 'week' | 'month'): Date {
    const d = new Date();
    if (period === 'day') {
        d.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
        // Monday-based week
        const day = d.getDay(); // 0 = Sunday
        const diff = (day === 0 ? -6 : 1 - day);
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
    } else {
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
    }
    return d;
}

function computeStats(rides: CompletedRide[], since: Date): PeriodStats {
    const filtered = rides.filter(r => new Date(r.created_at) >= since);
    const totalFareCents = filtered.reduce((sum, r) => sum + (r.total_fare_cents || 0), 0);
    return {
        earnings: Math.round(totalFareCents * DRIVER_SHARE),
        trips: filtered.length,
    };
}

function paymentIcon(method: string | null): string {
    if (method === 'card') return '💳';
    if (method === 'wallet') return '👛';
    return '💵';
}

function formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

function truncateAddress(addr: string | null, maxLen = 28): string {
    if (!addr) return 'Unknown location';
    if (addr.length <= maxLen) return addr;
    return addr.slice(0, maxLen - 1) + '…';
}

export function EarningsScreen({ navigation }: any) {
    const { driver } = useAuth();
    const [allRides, setAllRides] = useState<CompletedRide[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!driver?.id) return;

        const fetchRides = async () => {
            // Fetch all rides completed in the current month — covers day + week + month stats
            const monthStart = getStartOf('month');

            const { data, error } = await supabase
                .from('rides')
                .select('id, created_at, pickup_address, total_fare_cents, payment_method')
                .eq('driver_id', driver.id)
                .eq('status', 'completed')
                .gte('created_at', monthStart.toISOString())
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) {
                console.error('[EarningsScreen] fetch error:', error.message);
            } else {
                setAllRides(data || []);
            }
            setLoading(false);
        };

        fetchRides();
    }, [driver?.id]);

    // Period stats derived from in-memory data (avoids extra queries)
    const today = computeStats(allRides, getStartOf('day'));
    const week = computeStats(allRides, getStartOf('week'));
    const month = computeStats(allRides, getStartOf('month'));

    const renderRide = ({ item }: { item: CompletedRide }) => {
        const earned = Math.round((item.total_fare_cents || 0) * DRIVER_SHARE);
        const dateStr = new Date(item.created_at).toLocaleString([], {
            dateStyle: 'short',
            timeStyle: 'short',
        });

        return (
            <Surface style={styles.rideRow} intensity={20}>
                <View style={styles.rideIconBox}>
                    <Txt variant="headingM">{paymentIcon(item.payment_method)}</Txt>
                </View>
                <View style={styles.rideDetails}>
                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>
                        {truncateAddress(item.pickup_address)}
                    </Txt>
                    <Txt variant="caption" color={tokens.colors.text.tertiary}>{dateStr}</Txt>
                </View>
                <View style={styles.rideAmount}>
                    <Txt variant="headingM" weight="bold" color={tokens.colors.status.success}>
                        +{formatCents(earned)}
                    </Txt>
                    <Txt variant="small" color={tokens.colors.text.tertiary} style={{ textTransform: 'uppercase', marginTop: 2 }}>
                        earned
                    </Txt>
                </View>
            </Surface>
        );
    };

    const ListHeader = () => (
        <>
            {/* Page Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Surface style={styles.backSurface} intensity={40}>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary}>← Back</Txt>
                    </Surface>
                </TouchableOpacity>
                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary}>Earnings</Txt>
                <View style={{ width: 60 }} />
            </View>

            {/* Period Summary Cards */}
            <View style={styles.cardsRow}>
                <PeriodCard label="TODAY" stats={today} />
                <PeriodCard label="THIS WEEK" stats={week} />
                <PeriodCard label="THIS MONTH" stats={month} />
            </View>

            {/* Section heading */}
            <View style={styles.sectionHeader}>
                <Txt variant="bodyBold" color={tokens.colors.text.secondary}>Recent Trips (This Month)</Txt>
            </View>
        </>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="light" />

            {loading ? (
                <>
                    <ListHeader />
                    <View style={styles.loader}>
                        <ActivityIndicator size="large" color={tokens.colors.primary.purple} />
                    </View>
                </>
            ) : (
                <FlatList
                    data={allRides}
                    keyExtractor={r => r.id}
                    renderItem={renderRide}
                    ListHeaderComponent={<ListHeader />}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Txt variant="bodyReg" color={tokens.colors.text.tertiary}>
                                No completed rides this month.
                            </Txt>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}

// ── Period card sub-component ────────────────────────────────────────────
function PeriodCard({ label, stats }: { label: string; stats: PeriodStats }) {
    return (
        <Surface style={styles.periodCard} intensity={40}>
            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>{label}</Txt>
            <Txt
                variant="headingM"
                weight="bold"
                color={stats.earnings > 0 ? tokens.colors.status.success : tokens.colors.text.primary}
                style={{ marginTop: 6 }}
            >
                {formatCents(stats.earnings)}
            </Txt>
            <Txt variant="small" color={tokens.colors.text.tertiary} style={{ marginTop: 4 }}>
                {stats.trips} trip{stats.trips !== 1 ? 's' : ''}
            </Txt>
        </Surface>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    backBtn: {
        shadowColor: tokens.colors.primary.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
    },
    backSurface: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    cardsRow: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 20,
        paddingBottom: 16,
    },
    periodCard: {
        flex: 1,
        padding: 16,
        borderRadius: 18,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    sectionHeader: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 40,
        gap: 10,
    },
    rideRow: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.03)',
        marginTop: 10,
    },
    rideIconBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    rideDetails: {
        flex: 1,
        marginLeft: 16,
        gap: 4,
    },
    rideAmount: {
        alignItems: 'flex-end',
    },
    loader: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        padding: 40,
        alignItems: 'center',
    },
});
