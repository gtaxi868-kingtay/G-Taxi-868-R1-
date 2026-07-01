import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { AppScreenProps } from '../navigation/types';

const { supabase } = initializeSupabaseClient('native');

type LeaseStatus =
    | 'NOT_ELIGIBLE_YET'
    | 'NO_ACTIVE_LEASE'
    | 'LEASE_SUSPENDED'
    | 'DISPUTE_OPEN'
    | 'LEASE_ENDED'
    | 'ACTIVE';

interface LeaseData {
    status: LeaseStatus;
    active_days_count: number;
    days_needed?: number;
    progress_pct?: number;
    qualified: boolean;
    qualified_at?: string;
    lease?: {
        id: string;
        vehicle?: { make: string; model: string; year: number; license_plate: string };
        start_date?: string;
        end_date?: string;
        per_ride_installment_cents?: number;
        reserve_funded?: boolean;
        suspension_reason?: string;
    } | null;
    dispute?: {
        id: string;
        reason: string;
        disputed_at: string;
        amount_cents: number;
    } | null;
    installment_summary?: {
        rides_contributed: number;
        total_paid_cents: number;
    } | null;
}

export default function LeaseScreen({ navigation }: AppScreenProps<'Lease'>) {
    const insets = useSafeAreaInsets();
    const [data, setData] = useState<LeaseData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchLeaseStatus = useCallback(async () => {
        try {
            const { data: result, error } = await supabase.functions.invoke('driver_lease_status');
            if (!error && result?.success) {
                setData(result.data);
            }
        } catch (err) {
            console.warn('[LeaseScreen] fetch failed:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchLeaseStatus(); }, [fetchLeaseStatus]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchLeaseStatus();
    }, [fetchLeaseStatus]);

    const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;

    const renderContent = () => {
        if (!data) return null;

        switch (data.status) {
            case 'NOT_ELIGIBLE_YET':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(52,230,236,0.12)', 'rgba(52,230,236,0.03)']}
                            style={s.cardGradient}
                        >
                            <View style={s.cardIcon}>
                                <Ionicons name="car-sport-sharp" size={40} color="#34E6EC" />
                            </View>
                            <Text style={s.cardTitle}>BYD Lease Programme</Text>
                            <Text style={s.cardSubtitle}>Drive consistently and qualify for a G-Taxi BYD.</Text>

                            <View style={s.progressSection}>
                                <View style={s.progressHeader}>
                                    <Text style={s.progressLabel}>Active Driving Days</Text>
                                    <Text style={s.progressCount}>{data.active_days_count} / 90</Text>
                                </View>
                                <View style={s.progressTrack}>
                                    <View
                                        style={[
                                            s.progressFill,
                                            { width: `${data.progress_pct ?? 0}%` as any },
                                        ]}
                                    />
                                </View>
                                <Text style={s.progressHelp}>
                                    {data.days_needed === 0
                                        ? 'Qualification complete — admin review pending'
                                        : `${data.days_needed} more active days needed`}
                                </Text>
                            </View>

                            <View style={s.infoBlock}>
                                <Text style={s.infoTitle}>How it works</Text>
                                {[
                                    'Drive on 90 distinct days within any 6-month window',
                                    'G-Taxi covers the down payment — no cash upfront',
                                    'A small installment is deducted from each ride (≤ 15% of fare)',
                                    'Drive the car, earn through it, own it faster',
                                ].map((line, i) => (
                                    <View key={i} style={s.infoRow}>
                                        <View style={s.infoDot} />
                                        <Text style={s.infoText}>{line}</Text>
                                    </View>
                                ))}
                            </View>
                        </LinearGradient>
                    </View>
                );

            case 'NO_ACTIVE_LEASE':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(230,180,80,0.15)', 'rgba(230,180,80,0.03)']}
                            style={s.cardGradient}
                        >
                            <View style={[s.cardIcon, { backgroundColor: 'rgba(230,180,80,0.2)' }]}>
                                <Ionicons name="checkmark-circle-sharp" size={40} color="#E6B450" />
                            </View>
                            <Text style={[s.cardTitle, { color: '#E6B450' }]}>You Qualify</Text>
                            <Text style={s.cardSubtitle}>
                                You have {data.active_days_count} active driving days. You are now eligible for a BYD lease. Contact G-Taxi admin to activate.
                            </Text>

                            <TouchableOpacity
                                style={s.signAddendumCta}
                                onPress={() => navigation.navigate('LeaseConsent')}
                            >
                                <Ionicons name="document-text-sharp" size={16} color="#000" style={{ marginRight: 8 }} />
                                <Text style={s.signAddendumCtaText}>Review &amp; Sign Earnings Addendum</Text>
                            </TouchableOpacity>
                            <View style={s.ctaRow}>
                                <Ionicons name="information-circle-sharp" size={16} color="rgba(230,180,80,0.5)" />
                                <Text style={[s.ctaText, { color: 'rgba(230,180,80,0.5)' }]}>Admin activates your lease after you sign</Text>
                            </View>

                            <View style={s.infoBlock}>
                                <Text style={s.infoTitle}>BYD Benefits</Text>
                                {[
                                    'Electric — pay electricity, not petrol',
                                    'Branded G-Taxi wrap included',
                                    'Lease paid through ride earnings — no monthly bank payment',
                                    'Deductions capped at 15% per ride',
                                ].map((line, i) => (
                                    <View key={i} style={s.infoRow}>
                                        <View style={[s.infoDot, { backgroundColor: '#E6B450' }]} />
                                        <Text style={s.infoText}>{line}</Text>
                                    </View>
                                ))}
                            </View>
                        </LinearGradient>
                    </View>
                );

            case 'DISPUTE_OPEN':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(239,68,68,0.12)', 'rgba(239,68,68,0.03)']}
                            style={s.cardGradient}
                        >
                            <View style={[s.cardIcon, { backgroundColor: 'rgba(239,68,68,0.2)' }]}>
                                <Ionicons name="alert-circle-sharp" size={40} color="#EF4444" />
                            </View>
                            <Text style={[s.cardTitle, { color: '#EF4444' }]}>Dispute Open</Text>
                            <Text style={s.cardSubtitle}>
                                A deduction dispute is under review. Deductions are paused until resolved.
                            </Text>

                            {data.dispute && (
                                <View style={s.infoBlock}>
                                    <Text style={s.infoTitle}>Dispute Details</Text>
                                    <View style={s.detailRow}>
                                        <Text style={s.detailLabel}>Amount</Text>
                                        <Text style={s.detailValue}>{formatTTD(data.dispute.amount_cents)}</Text>
                                    </View>
                                    <View style={s.detailRow}>
                                        <Text style={s.detailLabel}>Reason</Text>
                                        <Text style={s.detailValue}>{data.dispute.reason}</Text>
                                    </View>
                                    <View style={s.detailRow}>
                                        <Text style={s.detailLabel}>Filed</Text>
                                        <Text style={s.detailValue}>
                                            {new Date(data.dispute.disputed_at).toLocaleDateString()}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            <TouchableOpacity
                                style={s.secondaryCta}
                                onPress={() => navigation.navigate('ReportIssue')}
                            >
                                <Text style={s.secondaryCtaText}>View in Help Centre</Text>
                            </TouchableOpacity>
                        </LinearGradient>
                    </View>
                );

            case 'LEASE_SUSPENDED':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(239,68,68,0.12)', 'rgba(239,68,68,0.03)']}
                            style={s.cardGradient}
                        >
                            <View style={[s.cardIcon, { backgroundColor: 'rgba(239,68,68,0.2)' }]}>
                                <Ionicons name="pause-circle-sharp" size={40} color="#EF4444" />
                            </View>
                            <Text style={[s.cardTitle, { color: '#EF4444' }]}>Lease Suspended</Text>
                            <Text style={s.cardSubtitle}>
                                {data.lease?.suspension_reason ?? 'Your lease has been suspended. Contact admin to resolve.'}
                            </Text>
                            <TouchableOpacity
                                style={s.secondaryCta}
                                onPress={() => navigation.navigate('ReportIssue')}
                            >
                                <Text style={s.secondaryCtaText}>Contact Admin</Text>
                            </TouchableOpacity>
                        </LinearGradient>
                    </View>
                );

            case 'LEASE_ENDED':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)']}
                            style={s.cardGradient}
                        >
                            <View style={s.cardIcon}>
                                <Ionicons name="flag-sharp" size={40} color="rgba(255,255,255,0.6)" />
                            </View>
                            <Text style={s.cardTitle}>Lease Completed</Text>
                            <Text style={s.cardSubtitle}>Your lease has ended. Contact admin to discuss renewal or a new vehicle.</Text>
                        </LinearGradient>
                    </View>
                );

            case 'ACTIVE':
                return (
                    <View style={s.card}>
                        <LinearGradient
                            colors={['rgba(52,230,236,0.12)', 'rgba(52,230,236,0.03)']}
                            style={s.cardGradient}
                        >
                            <View style={s.leaseBadge}>
                                <Ionicons name="car-sport-sharp" size={18} color="#000" />
                                <Text style={s.leaseBadgeText}>ACTIVE BYD LEASE</Text>
                            </View>

                            {data.lease?.vehicle && (
                                <Text style={s.vehicleName}>
                                    {data.lease.vehicle.year} BYD {data.lease.vehicle.make} {data.lease.vehicle.model}
                                </Text>
                            )}
                            {data.lease?.vehicle?.license_plate && (
                                <Text style={s.plateNumber}>{data.lease.vehicle.license_plate}</Text>
                            )}

                            <View style={s.statsRow}>
                                <View style={s.statBox}>
                                    <Text style={s.statValue}>
                                        {data.installment_summary?.rides_contributed ?? 0}
                                    </Text>
                                    <Text style={s.statLabel}>Rides Paid</Text>
                                </View>
                                <View style={s.statDivider} />
                                <View style={s.statBox}>
                                    <Text style={s.statValue}>
                                        {formatTTD(data.installment_summary?.total_paid_cents ?? 0)}
                                    </Text>
                                    <Text style={s.statLabel}>Total Contributed</Text>
                                </View>
                                <View style={s.statDivider} />
                                <View style={s.statBox}>
                                    <Text style={s.statValue}>
                                        {formatTTD(data.lease?.per_ride_installment_cents ?? 5000)}
                                    </Text>
                                    <Text style={s.statLabel}>Per Ride</Text>
                                </View>
                            </View>

                            <View style={s.infoBlock}>
                                <Text style={s.infoTitle}>Deduction Cap</Text>
                                <Text style={s.infoText}>
                                    Your installment is automatically deducted from each ride fare, capped at 15% of the gross fare. On small rides, the deduction scales down — you always keep at least 85%.
                                </Text>
                            </View>

                                            {/* Buffett fix: TTD $2,600/month net earnings estimate */}
                            <View style={s.earningsCard}>
                                <Text style={s.earningsTitle}>Your Estimated Monthly Take-Home</Text>
                                {[
                                    { label: 'Gross driver earnings (160 rides × ~TTD $38)', value: 'TTD $6,080', color: '#EAF3F6' },
                                    { label: 'BYD lease deductions (≤15% per ride, auto-deducted)', value: '− TTD $3,480', color: '#EF4444' },
                                    { label: 'Net earnings after lease', value: '≈ TTD $2,600', color: '#4ADE80' },
                                ].map((row, i) => (
                                    <View key={i} style={s.earningsRow}>
                                        <Text style={s.earningsLabel}>{row.label}</Text>
                                        <Text style={[s.earningsValue, { color: row.color }]}>{row.value}</Text>
                                    </View>
                                ))}
                                <Text style={s.earningsNote}>Estimates based on market-competitive T&T fares. Actual take-home depends on ride volume.</Text>
                            </View>

                            {!data.lease?.reserve_funded && (
                                <View style={s.ctaRow}>
                                    <Ionicons name="information-circle-sharp" size={16} color="rgba(255,255,255,0.5)" />
                                    <Text style={[s.ctaText, { color: 'rgba(255,255,255,0.5)' }]}>
                                        Reserve allocation pending admin approval
                                    </Text>
                                </View>
                            )}
                        </LinearGradient>
                    </View>
                );

            default:
                return null;
        }
    };

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Vehicle Lease</Text>
            </View>

            {loading ? (
                <View style={s.loadingWrap}>
                    <ActivityIndicator color="#34E6EC" size="large" />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={s.scroll}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#34E6EC" />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {renderContent()}
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#050505' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    backBtn: { marginRight: 16, padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6' },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, paddingBottom: 60 },
    card: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    cardGradient: { padding: 24 },
    cardIcon: {
        width: 72,
        height: 72,
        borderRadius: 22,
        backgroundColor: 'rgba(52,230,236,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    cardTitle: { fontSize: 26, fontWeight: '800', color: '#EAF3F6', marginBottom: 8 },
    cardSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 22, marginBottom: 24 },
    progressSection: { marginBottom: 24 },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    progressLabel: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
    progressCount: { fontSize: 14, color: '#34E6EC', fontWeight: '700' },
    progressTrack: {
        height: 6,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#34E6EC',
        borderRadius: 3,
    },
    progressHelp: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
    infoBlock: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        padding: 16,
        marginTop: 8,
    },
    infoTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    infoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34E6EC', marginTop: 6, marginRight: 10 },
    infoText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', flex: 1, lineHeight: 20 },
    ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
    ctaText: { fontSize: 13, fontWeight: '600', flex: 1 },
    leaseBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#34E6EC',
        alignSelf: 'flex-start',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginBottom: 20,
    },
    leaseBadgeText: { fontSize: 12, fontWeight: '800', color: '#000', letterSpacing: 1 },
    vehicleName: { fontSize: 28, fontWeight: '800', color: '#EAF3F6', marginBottom: 4 },
    plateNumber: { fontSize: 16, color: '#34E6EC', fontFamily: 'monospace', fontWeight: '700', marginBottom: 24 },
    statsRow: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
        alignItems: 'center',
    },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 16, fontWeight: '800', color: '#EAF3F6', marginBottom: 4 },
    statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
    statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.1)' },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    detailLabel: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
    detailValue: { fontSize: 14, color: '#EAF3F6', fontWeight: '600', flex: 1, textAlign: 'right' },
    secondaryCta: {
        marginTop: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
    },
    secondaryCtaText: { fontSize: 15, fontWeight: '700', color: '#EAF3F6' },
    earningsCard: {
        backgroundColor: 'rgba(74,222,128,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(74,222,128,0.15)',
        borderRadius: 16,
        padding: 16,
        marginTop: 20,
        marginBottom: 8,
    },
    earningsTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
    earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
    earningsLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1, lineHeight: 16 },
    earningsValue: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
    earningsNote: { fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8, lineHeight: 14 },
    signAddendumCta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E6B450',
        borderRadius: 14,
        paddingVertical: 14,
        marginTop: 20,
        marginBottom: 12,
    },
    signAddendumCtaText: { fontSize: 15, fontWeight: '800', color: '#000' },
});
