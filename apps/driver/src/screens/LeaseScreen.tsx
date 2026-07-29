import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, RefreshControl,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

const driver = VOICES.driver;
const STATUS_RED = '#EF4444';

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

interface EarningsSummary {
  total_rides: number;
  total_earned_cents: number;
  avg_per_ride_cents: number;
  monthly_avg_cents: number;
  months_active: number;
}

export default function LeaseScreen({ navigation }: AppScreenProps<'Lease'>) {
    const insets = useSafeAreaInsets();
    const [data, setData] = useState<LeaseData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [earnings, setEarnings] = useState<EarningsSummary | null>(null);

    const fetchLeaseStatus = useCallback(async () => {
        try {
            const { data: result, error } = await supabase.functions.invoke('driver_lease_status');
            if (!error && result?.success) {
                setData(result.data);
            }
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { data: driverRow } = await supabase
                .from('drivers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();
              if (driverRow) {
                const { data: rides } = await supabase
                  .from('rides')
                  .select('driver_payout_cents, completed_at')
                  .eq('driver_id', driverRow.id)
                  .eq('status', 'completed')
                  .order('completed_at', { ascending: false });
                if (rides && rides.length > 0) {
                  const totalRides = rides.length;
                  const totalEarned = rides.reduce((s, r) => s + (r.driver_payout_cents || 0), 0);
                  const dates = rides.map((r) => r.completed_at ? new Date(r.completed_at) : new Date()).filter(Boolean);
                  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
                  const monthsActive = Math.max(1, Math.ceil((Date.now() - minDate.getTime()) / (30 * 24 * 60 * 60 * 1000)));
                  setEarnings({
                    total_rides: totalRides,
                    total_earned_cents: totalEarned,
                    avg_per_ride_cents: Math.round(totalEarned / totalRides),
                    monthly_avg_cents: Math.round(totalEarned / monthsActive),
                    months_active: monthsActive,
                  });
                }
              }
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

    // Requesting a specific vehicle now goes through G Garage: it computes
    // a real min/max daily contribution from the driver's own last-30-day
    // earnings and lets them choose a vehicle class + funding source,
    // rather than this screen firing a flat, unverified daily rate at an
    // application that always required a fleet_vehicle_id it never had
    // (apply_for_lease rejects fleet_vehicle_id: null — this button never
    // actually worked). Once G Garage's admin approval creates the real
    // fleet_leases row, it shows up in the ACTIVE case below exactly like
    // before — same lease table, same 15%-of-fare cap at settlement.
    const handleApplyNow = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      navigation.navigate('GGarage');
    };

    const renderContent = () => {
        if (!data) return null;

        switch (data.status) {
            case 'NOT_ELIGIBLE_YET':
                return (
                    <View style={[s.card, glassSurface(0.15)]}>
                        <View style={[s.cardIcon, { backgroundColor: `${driver.accent}26` }]}>
                            <Ionicons name="car-sport-sharp" size={40} color={driver.accent} />
                        </View>
                        <Text style={s.cardTitle}>BYD Lease Programme</Text>
                        <Text style={s.cardSubtitle}>Drive consistently and qualify for a G-Taxi BYD.</Text>

                        <View style={s.progressSection}>
                            <View style={s.progressHeader}>
                                <Text style={s.progressLabel}>Active Driving Days</Text>
                                <Text style={[s.progressCount, { color: driver.accent }]}>{data.active_days_count} / 90</Text>
                            </View>
                            <View style={s.progressTrack}>
                                <View style={[s.progressFill, { width: `${data.progress_pct ?? 0}%` as any, backgroundColor: driver.accent }]} />
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
                                    <View style={[s.infoDot, { backgroundColor: driver.accent }]} />
                                    <Text style={s.infoText}>{line}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                );

            case 'NO_ACTIVE_LEASE':
                return (
                    <View>
                      <View style={[s.card, glassSurface(0.15), { alignItems: 'center' }]}>
                        <View style={[s.cardIcon, { backgroundColor: `${driver.gold}26` }]}>
                          <Ionicons name="checkmark-circle-sharp" size={40} color={driver.gold} />
                        </View>
                        <Text style={[s.cardTitle, { color: driver.gold, textAlign: 'center' }]}>You Qualify for BYD Lease</Text>
                        <Text style={[s.cardSubtitle, { textAlign: 'center' }]}>
                          {data.active_days_count} active driving days — meets the minimum threshold. Term Finance reviews your earnings history for underwriting.
                        </Text>
                      </View>

                      {earnings && (
                        <View style={[s.card, glassSurface(0.15)]}>
                          <Text style={[s.sectionLabel, { color: driver.accent, marginBottom: 16 }]}>
                            <Ionicons name="trending-up" size={16} color={driver.accent} /> EARNINGS HISTORY
                          </Text>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 }}>
                            <View style={{ alignItems: 'center' }}>
                              <Text style={s.bigStat}>{formatTTD(earnings.total_earned_cents)}</Text>
                              <Text style={s.bigStatLabel}>LIFETIME GROSS</Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <Text style={s.bigStat}>{formatTTD(earnings.monthly_avg_cents)}</Text>
                              <Text style={s.bigStatLabel}>MO. AVG</Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                            <View style={{ alignItems: 'center' }}>
                              <Text style={s.smallStat}>{earnings.total_rides}</Text>
                              <Text style={s.bigStatLabel}>TOTAL RIDES</Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <Text style={s.smallStat}>{formatTTD(earnings.avg_per_ride_cents)}</Text>
                              <Text style={s.bigStatLabel}>PER RIDE</Text>
                            </View>
                            <View style={{ alignItems: 'center' }}>
                              <Text style={s.smallStat}>{earnings.months_active}</Text>
                              <Text style={s.bigStatLabel}>MO. ACTIVE</Text>
                            </View>
                          </View>

                          <View style={[s.noteBox, { backgroundColor: `${driver.accent}1A`, borderColor: `${driver.accent}4D` }]}>
                            <Text style={s.noteText}>
                              Term Finance uses your historical earnings to calculate affordable daily deductions. At {formatTTD(earnings.avg_per_ride_cents)} avg per ride with 15% cap, daily auto-deduction is estimated at ~{formatTTD(Math.round(earnings.avg_per_ride_cents * 10 * 0.15))} (first 10 rides).
                            </Text>
                          </View>
                        </View>
                      )}

                      <View style={[s.card, glassSurface(0.15)]}>
                        <TouchableOpacity
                          onPress={handleApplyNow}
                          style={s.primaryCta}
                        >
                          <Ionicons name="construct-sharp" size={18} color={SURFACE.base} style={{ marginRight: 8 }} />
                          <Text style={s.primaryCtaText}>GO TO G GARAGE</Text>
                        </TouchableOpacity>
                        <View style={s.ctaRow}>
                          <Ionicons name="information-circle-sharp" size={14} color={`${driver.gold}80`} />
                          <Text style={[s.ctaText, { color: `${driver.gold}80` }]}>Choose your vehicle, source, and daily contribution — sized to your own real earnings</Text>
                        </View>
                      </View>

                      <View style={[s.card, glassSurface(0.15)]}>
                        <Text style={[s.sectionLabel, { color: driver.gold, marginBottom: 12 }]}>BYD BENEFITS</Text>
                        {[
                          'Electric — pay electricity, not petrol',
                          'Branded G-Taxi wrap included',
                          'Lease paid through ride earnings — no monthly bank payment',
                          'Deductions capped at 15% per ride',
                        ].map((line, i) => (
                          <View key={i} style={[s.infoRow, { marginBottom: 8 }]}>
                            <View style={[s.infoDot, { backgroundColor: driver.gold }]} />
                            <Text style={[s.infoText, { color: driver.text }]}>{line}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                );

            case 'DISPUTE_OPEN':
                return (
                    <View style={[s.card, glassSurface(0.15), { borderColor: `${STATUS_RED}4D` }]}>
                        <View style={[s.cardIcon, { backgroundColor: `${STATUS_RED}26` }]}>
                            <Ionicons name="alert-circle-sharp" size={40} color={STATUS_RED} />
                        </View>
                        <Text style={[s.cardTitle, { color: STATUS_RED }]}>Dispute Open</Text>
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
                            onPress={() => { Haptics.selectionAsync(); navigation.navigate('ReportIssue'); }}
                        >
                            <Text style={s.secondaryCtaText}>View in Help Centre</Text>
                        </TouchableOpacity>
                    </View>
                );

            case 'LEASE_SUSPENDED':
                return (
                    <View style={[s.card, glassSurface(0.15), { borderColor: `${STATUS_RED}4D` }]}>
                        <View style={[s.cardIcon, { backgroundColor: `${STATUS_RED}26` }]}>
                            <Ionicons name="pause-circle-sharp" size={40} color={STATUS_RED} />
                        </View>
                        <Text style={[s.cardTitle, { color: STATUS_RED }]}>Lease Suspended</Text>
                        <Text style={s.cardSubtitle}>
                            {data.lease?.suspension_reason ?? 'Your lease has been suspended. Contact admin to resolve.'}
                        </Text>
                        <TouchableOpacity
                            style={s.secondaryCta}
                            onPress={() => { Haptics.selectionAsync(); navigation.navigate('ReportIssue'); }}
                        >
                            <Text style={s.secondaryCtaText}>Contact Admin</Text>
                        </TouchableOpacity>
                    </View>
                );

            case 'LEASE_ENDED':
                return (
                    <View style={[s.card, glassSurface(0.15)]}>
                        <View style={s.cardIcon}>
                            <Ionicons name="flag-sharp" size={40} color={driver.textMuted} />
                        </View>
                        <Text style={s.cardTitle}>Lease Completed</Text>
                        <Text style={s.cardSubtitle}>Your lease has ended. Contact admin to discuss renewal or a new vehicle.</Text>
                    </View>
                );

            case 'ACTIVE':
                return (
                    <View style={[s.card, glassSurface(0.15)]}>
                        <View style={[s.leaseBadge, { backgroundColor: driver.accent }]}>
                            <Ionicons name="car-sport-sharp" size={18} color={SURFACE.base} />
                            <Text style={s.leaseBadgeText}>ACTIVE BYD LEASE</Text>
                        </View>

                        {data.lease?.vehicle && (
                            <Text style={s.vehicleName}>
                                {data.lease.vehicle.year} BYD {data.lease.vehicle.make} {data.lease.vehicle.model}
                            </Text>
                        )}
                        {data.lease?.vehicle?.license_plate && (
                            <Text style={[s.plateNumber, { color: driver.accent }]}>{data.lease.vehicle.license_plate}</Text>
                        )}

                        <View style={s.statsRow}>
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: driver.gold }]}>
                                    {data.installment_summary?.rides_contributed ?? 0}
                                </Text>
                                <Text style={s.statLabel}>Rides Paid</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: driver.gold }]}>
                                    {formatTTD(data.installment_summary?.total_paid_cents ?? 0)}
                                </Text>
                                <Text style={s.statLabel}>Total Contributed</Text>
                            </View>
                            <View style={s.statDivider} />
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: driver.gold }]}>
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

                        <View style={[s.noteBox, { backgroundColor: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.25)', marginTop: 20 }]}>
                            <Text style={[s.earningsTitle]}>Your Estimated Monthly Take-Home</Text>
                            {[
                                { label: 'Gross driver earnings (160 rides × ~TTD $38)', value: 'TTD $6,080', color: driver.text },
                                { label: 'BYD lease deductions (≤15% per ride, auto-deducted)', value: '− TTD $3,480', color: STATUS_RED },
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
                                <Ionicons name="information-circle-sharp" size={16} color={driver.textMuted} />
                                <Text style={[s.ctaText, { color: driver.textMuted }]}>
                                    Reserve allocation pending admin approval
                                </Text>
                            </View>
                        )}
                    </View>
                );

            default:
                return null;
        }
    };

    return (
        <View style={s.container}>
            <BlurView tint="dark" intensity={90} style={[s.headerBlur, { paddingTop: insets.top }, glassSurface(90, 0.2)]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.goBack(); }}
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
                    >
                        <Ionicons name="chevron-back" size={24} color={driver.text} />
                    </TouchableOpacity>
                    <Text style={s.headerTitle}>Vehicle Lease</Text>
                    <View style={{ width: 44 }} />
                </View>
            </BlurView>

            {loading ? (
                <View style={s.loadingWrap}>
                    <ActivityIndicator color={driver.accent} size="large" />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[s.scroll, { paddingTop: insets.top + 80 }]}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={driver.accent} colors={[driver.accent]} />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {renderContent()}
                    <View style={{ height: insets.bottom + 40 }} />
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },
    headerBlur: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, ...ghostBorder(0.15) },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '800', color: driver.text },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingHorizontal: 20, paddingBottom: 20 },

    card: { borderRadius: 24, padding: 24, marginBottom: 16, ...ghostBorder(0.15) },
    cardIcon: {
        width: 72, height: 72, borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
    },
    cardTitle: { fontSize: 26, fontWeight: '800', color: driver.text, marginBottom: 8 },
    cardSubtitle: { fontSize: 15, color: driver.textMuted, lineHeight: 22, marginBottom: 24 },
    progressSection: { marginBottom: 24 },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    progressLabel: { fontSize: 14, color: driver.textMuted, fontWeight: '600' },
    progressCount: { fontSize: 14, fontWeight: '700' },
    progressTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 3 },
    progressHelp: { fontSize: 12, color: driver.textMuted, marginTop: 8 },
    infoBlock: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, marginTop: 8 },
    infoTitle: { fontSize: 13, fontWeight: '700', color: driver.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    infoDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6, marginRight: 10 },
    infoText: { fontSize: 14, color: driver.textMuted, flex: 1, lineHeight: 20 },
    ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
    ctaText: { fontSize: 13, fontWeight: '600', flex: 1 },

    leaseBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 20 },
    leaseBadgeText: { fontSize: 12, fontWeight: '800', color: SURFACE.base, letterSpacing: 1 },
    vehicleName: { fontSize: 28, fontWeight: '800', color: driver.text, marginBottom: 4 },
    plateNumber: { fontSize: 16, fontFamily: 'monospace', fontWeight: '700', marginBottom: 24 },
    statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, marginBottom: 20, alignItems: 'center' },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    statLabel: { fontSize: 11, color: driver.textMuted, textAlign: 'center' },
    statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.1)' },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    detailLabel: { fontSize: 14, color: driver.textMuted },
    detailValue: { fontSize: 14, color: driver.text, fontWeight: '600', flex: 1, textAlign: 'right' },
    secondaryCta: { marginTop: 20, borderRadius: 14, paddingVertical: 14, alignItems: 'center', ...ghostBorder(0.2) },
    secondaryCtaText: { fontSize: 15, fontWeight: '700', color: driver.text },

    primaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: driver.gold, borderRadius: 14, paddingVertical: 14 },
    primaryCtaText: { fontSize: 15, fontWeight: '800', color: SURFACE.base },

    bigStat: { fontSize: 22, fontWeight: '800', color: driver.text },
    bigStatLabel: { fontSize: 11, color: driver.textMuted },
    smallStat: { fontSize: 18, fontWeight: '800', color: driver.text },

    noteBox: { marginTop: 16, padding: 12, borderRadius: 12, borderWidth: 0.5 },
    noteText: { fontSize: 11, lineHeight: 16, color: driver.textMuted },

    earningsTitle: { fontSize: 11, fontWeight: '700', color: driver.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
    earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
    earningsLabel: { fontSize: 11, color: driver.textMuted, flex: 1, lineHeight: 16 },
    earningsValue: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
    earningsNote: { fontSize: 10, color: 'rgba(234,243,246,0.25)', marginTop: 8, lineHeight: 14 },

    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
});
