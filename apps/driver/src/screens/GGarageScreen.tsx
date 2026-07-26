import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert, RefreshControl, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { AppScreenProps } from '../navigation/types';
import { LiquidGlassCard } from '../components/LiquidGlassCard';

const { supabase } = initializeSupabaseClient('native');

interface VehicleClass {
    key: string;
    label: string;
    description: string | null;
    category: string;
}

interface Eligibility {
    eligible: boolean;
    reason?: string;
    days_with_earnings?: number;
    days_required?: number;
    floor_daily_earnings_cents?: number;
    ceiling_daily_earnings_cents?: number;
    min_daily_contribution_cents?: number;
    max_daily_contribution_cents?: number;
}

interface GarageRequest {
    id: string;
    vehicle_class_key: string;
    source: 'local_dealer' | 'platform_import';
    requested_daily_contribution_cents: number;
    status: string;
    created_at: string;
    decision_reason: string | null;
}

const TIER_LABEL: Record<string, { label: string; color: string; icon: string }> = {
    entry: { label: 'Entry', color: 'rgba(255,255,255,0.5)', icon: 'ellipse-outline' },
    proven: { label: 'Proven', color: '#34E6EC', icon: 'checkmark-circle' },
    elite: { label: 'Elite', color: '#E6B450', icon: 'star' },
};

const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;

export default function GGarageScreen({ navigation }: AppScreenProps<'GGarage'>) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [tier, setTier] = useState<string>('entry');
    const [registrationClass, setRegistrationClass] = useState<string>('unverified');
    const [eligibility, setEligibility] = useState<Eligibility | null>(null);
    const [vehicleClasses, setVehicleClasses] = useState<VehicleClass[]>([]);
    const [requests, setRequests] = useState<GarageRequest[]>([]);

    const [selectedClass, setSelectedClass] = useState<string | null>(null);
    const [source, setSource] = useState<'local_dealer' | 'platform_import'>('local_dealer');
    const [contribution, setContribution] = useState(0);
    const [hOptIn, setHOptIn] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const { data: result, error } = await supabase.functions.invoke('g_garage', { body: { action: 'get_status' } });
            if (!error && result?.success) {
                setTier(result.tier);
                setRegistrationClass(result.registration_class);
                setEligibility(result.eligibility);
                setVehicleClasses(result.vehicle_classes || []);
                setRequests(result.requests || []);
                if (result.eligibility?.eligible && contribution === 0) {
                    setContribution(result.eligibility.min_daily_contribution_cents);
                }
                if (!selectedClass && result.vehicle_classes?.length) {
                    setSelectedClass(result.vehicle_classes[0].key);
                }
            } else if (error) {
                console.warn('[GGarageScreen] fetch failed:', error);
            }
        } catch (err) {
            console.warn('[GGarageScreen] fetch failed:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [contribution, selectedClass]);

    useEffect(() => { fetchStatus(); }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchStatus();
    }, [fetchStatus]);

    const submitRequest = async () => {
        if (!selectedClass) { Alert.alert('Choose a vehicle', 'Select a vehicle class first'); return; }
        setSubmitting(true);
        try {
            const { data: result, error } = await supabase.functions.invoke('g_garage', {
                body: {
                    action: 'submit_request',
                    vehicle_class_key: selectedClass,
                    source,
                    requested_daily_contribution_cents: Math.round(contribution),
                    h_registration_opt_in: hOptIn,
                },
            });
            if (error || !result?.success) {
                throw new Error(result?.error || error?.message || 'Request failed');
            }
            Alert.alert('Request Submitted', 'Your G Garage request is pending admin review. You will be notified when it is decided.');
            fetchStatus();
        } catch (err: any) {
            Alert.alert('Error', err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const openRequest = requests.find((r) => ['pending', 'approved', 'active'].includes(r.status));
    const tierInfo = TIER_LABEL[tier] ?? TIER_LABEL.entry;

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>G Garage</Text>
            </View>

            {loading ? (
                <View style={s.loadingWrap}>
                    <ActivityIndicator color="#34E6EC" size="large" />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={s.scroll}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#34E6EC" />}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Tier badge */}
                    <LiquidGlassCard accentColor={tierInfo.color} style={{ marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Ionicons name={tierInfo.icon as any} size={28} color={tierInfo.color} />
                            <View>
                                <Text style={[s.cardTitle, { fontSize: 20, marginBottom: 2 }]}>{tierInfo.label} Tier</Text>
                                <Text style={s.cardSubtitle}>Unlocks based on your real ride history and rank — not a purchase.</Text>
                            </View>
                        </View>
                    </LiquidGlassCard>

                    {/* Registration compliance warning */}
                    {registrationClass !== 'H' && (
                        <LiquidGlassCard accentColor="#EF4444" style={{ marginBottom: 16 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <Ionicons name="warning" size={22} color="#EF4444" />
                                <Text style={[s.infoText, { flex: 1, color: '#EF4444' }]}>
                                    {registrationClass === 'private'
                                        ? "Your vehicle is flagged as a private (non-for-hire) plate. You cannot receive a G Garage vehicle until this is resolved — a private plate isn't insured to carry paying passengers."
                                        : "Your vehicle registration ('H' for-hire plate) hasn't been verified yet. Upload proof from Profile → Documents to unlock G Garage."}
                                </Text>
                            </View>
                        </LiquidGlassCard>
                    )}

                    {/* Open request status */}
                    {openRequest && (
                        <LiquidGlassCard accentColor="#34E6EC" style={{ marginBottom: 16 }}>
                            <Text style={[s.sectionLabel, { color: '#34E6EC', marginBottom: 10 }]}>YOUR REQUEST</Text>
                            <Text style={s.vehicleName}>{vehicleClasses.find((c) => c.key === openRequest.vehicle_class_key)?.label ?? openRequest.vehicle_class_key}</Text>
                            <View style={s.statsRow}>
                                <View style={s.statBox}>
                                    <Text style={s.statValue}>{formatTTD(openRequest.requested_daily_contribution_cents)}</Text>
                                    <Text style={s.statLabel}>Per Day</Text>
                                </View>
                                <View style={s.statDivider} />
                                <View style={s.statBox}>
                                    <Text style={[s.statValue, { textTransform: 'uppercase' }]}>{openRequest.status}</Text>
                                    <Text style={s.statLabel}>Status</Text>
                                </View>
                            </View>
                            {openRequest.decision_reason && (
                                <Text style={[s.infoText, { marginTop: 12 }]}>{openRequest.decision_reason}</Text>
                            )}
                        </LiquidGlassCard>
                    )}

                    {/* New request form */}
                    {!openRequest && registrationClass !== 'private' && (
                        <>
                            {!eligibility?.eligible ? (
                                <LiquidGlassCard accentColor="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }}>
                                    <Text style={[s.cardTitle, { fontSize: 18 }]}>Not Yet Eligible</Text>
                                    <Text style={s.cardSubtitle}>
                                        G Garage sizes your contribution range from your own real earnings — drive at least{' '}
                                        {eligibility?.days_required ?? 14} distinct days with completed rides in the last 30 days.
                                        You currently have {eligibility?.days_with_earnings ?? 0}.
                                    </Text>
                                </LiquidGlassCard>
                            ) : (
                                <>
                                    <LiquidGlassCard accentColor="#E6B450" style={{ marginBottom: 16 }}>
                                        <Text style={[s.sectionLabel, { color: '#E6B450', marginBottom: 12 }]}>CHOOSE A VEHICLE</Text>
                                        {vehicleClasses.map((vc) => (
                                            <TouchableOpacity
                                                key={vc.key}
                                                onPress={() => setSelectedClass(vc.key)}
                                                style={[s.choiceRow, selectedClass === vc.key && s.choiceRowActive]}
                                            >
                                                <Ionicons
                                                    name={selectedClass === vc.key ? 'radio-button-on' : 'radio-button-off'}
                                                    size={20}
                                                    color={selectedClass === vc.key ? '#E6B450' : 'rgba(255,255,255,0.3)'}
                                                />
                                                <View style={{ marginLeft: 12, flex: 1 }}>
                                                    <Text style={s.choiceLabel}>{vc.label}</Text>
                                                    {vc.description && <Text style={s.choiceSubtext}>{vc.description}</Text>}
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                        {vehicleClasses.length === 0 && (
                                            <Text style={s.infoText}>No vehicle classes currently available — check back soon.</Text>
                                        )}
                                    </LiquidGlassCard>

                                    <LiquidGlassCard accentColor="#34E6EC" style={{ marginBottom: 16 }}>
                                        <Text style={[s.sectionLabel, { color: '#34E6EC', marginBottom: 12 }]}>SOURCE</Text>
                                        <View style={{ flexDirection: 'row', gap: 10 }}>
                                            <TouchableOpacity
                                                onPress={() => setSource('local_dealer')}
                                                style={[s.sourceBtn, source === 'local_dealer' && s.sourceBtnActive]}
                                            >
                                                <Text style={[s.sourceBtnText, source === 'local_dealer' && { color: '#000' }]}>Local Dealer</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                onPress={() => setSource('platform_import')}
                                                style={[s.sourceBtn, source === 'platform_import' && s.sourceBtnActive]}
                                            >
                                                <Text style={[s.sourceBtnText, source === 'platform_import' && { color: '#000' }]}>Platform Import</Text>
                                            </TouchableOpacity>
                                        </View>
                                        {source === 'platform_import' && (
                                            <Text style={[s.infoText, { marginTop: 10 }]}>
                                                Platform-facilitated import may be cheaper but depends on legal confirmation for your specific vehicle. The local dealer is always the safe fallback.
                                            </Text>
                                        )}
                                    </LiquidGlassCard>

                                    <LiquidGlassCard accentColor="#4ADE80" style={{ marginBottom: 16 }}>
                                        <Text style={[s.sectionLabel, { color: '#4ADE80', marginBottom: 4 }]}>YOUR DAILY CONTRIBUTION</Text>
                                        <Text style={s.infoText}>
                                            Computed from your real last-30-day earnings. Choose anywhere in your range — pay more to own it faster, or stay near the minimum.
                                        </Text>
                                        <Text style={s.contributionValue}>{formatTTD(contribution)}/day</Text>
                                        <View style={s.stepperRow}>
                                            <TouchableOpacity
                                                onPress={() => setContribution((c) => Math.max(eligibility.min_daily_contribution_cents!, c - 500))}
                                                style={s.stepperBtn}
                                            >
                                                <Ionicons name="remove" size={22} color="#4ADE80" />
                                            </TouchableOpacity>
                                            <View style={s.stepperTrack}>
                                                <View
                                                    style={[
                                                        s.stepperFill,
                                                        {
                                                            width: `${Math.min(100, Math.max(0,
                                                                ((contribution - eligibility.min_daily_contribution_cents!) /
                                                                    Math.max(1, eligibility.max_daily_contribution_cents! - eligibility.min_daily_contribution_cents!)) * 100
                                                            ))}%` as any,
                                                        },
                                                    ]}
                                                />
                                            </View>
                                            <TouchableOpacity
                                                onPress={() => setContribution((c) => Math.min(eligibility.max_daily_contribution_cents!, c + 500))}
                                                style={s.stepperBtn}
                                            >
                                                <Ionicons name="add" size={22} color="#4ADE80" />
                                            </TouchableOpacity>
                                        </View>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                            <Text style={s.rangeLabel}>Min {formatTTD(eligibility.min_daily_contribution_cents!)}</Text>
                                            <Text style={s.rangeLabel}>Max {formatTTD(eligibility.max_daily_contribution_cents!)}</Text>
                                        </View>
                                        <Text style={[s.infoText, { marginTop: 10 }]}>
                                            Platform matches a percentage of every dollar you commit, funded from the platform reserve — you never pay more than you chose.
                                        </Text>
                                    </LiquidGlassCard>

                                    <LiquidGlassCard accentColor="#60A5FA" style={{ marginBottom: 16 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <View style={{ flex: 1, marginRight: 12 }}>
                                                <Text style={s.choiceLabel}>Apply for 'H' registration through G Garage</Text>
                                                <Text style={s.choiceSubtext}>Optional, paid convenience service. Skip if your vehicle is already 'H' registered.</Text>
                                            </View>
                                            <Switch value={hOptIn} onValueChange={setHOptIn} trackColor={{ true: '#60A5FA' }} />
                                        </View>
                                    </LiquidGlassCard>

                                    <TouchableOpacity
                                        onPress={submitRequest}
                                        disabled={submitting || !selectedClass}
                                        style={[s.submitBtn, (submitting || !selectedClass) && { opacity: 0.5 }]}
                                    >
                                        {submitting ? (
                                            <ActivityIndicator color="#000" size="small" />
                                        ) : (
                                            <>
                                                <Ionicons name="construct-sharp" size={18} color="#000" style={{ marginRight: 8 }} />
                                                <Text style={s.submitBtnText}>SUBMIT REQUEST</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </>
                            )}
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#050505' },
    header: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16,
        borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    backBtn: { marginRight: 16, padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6' },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, paddingBottom: 60 },
    cardTitle: { fontSize: 26, fontWeight: '800', color: '#EAF3F6', marginBottom: 8 },
    cardSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 20 },
    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    infoText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 19 },
    vehicleName: { fontSize: 22, fontWeight: '800', color: '#EAF3F6', marginBottom: 12 },
    statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, alignItems: 'center' },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 16, fontWeight: '800', color: '#EAF3F6', marginBottom: 4 },
    statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
    statDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.1)' },
    choiceRow: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
        borderRadius: 14, marginBottom: 6, borderWidth: 1, borderColor: 'transparent',
    },
    choiceRowActive: { backgroundColor: 'rgba(230,180,80,0.1)', borderColor: 'rgba(230,180,80,0.3)' },
    choiceLabel: { fontSize: 15, fontWeight: '700', color: '#EAF3F6' },
    choiceSubtext: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
    sourceBtn: {
        flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center',
    },
    sourceBtnActive: { backgroundColor: '#34E6EC', borderColor: '#34E6EC' },
    sourceBtnText: { fontSize: 13, fontWeight: '700', color: '#EAF3F6' },
    contributionValue: { fontSize: 28, fontWeight: '800', color: '#4ADE80', marginTop: 8 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, marginBottom: 8 },
    stepperBtn: {
        width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(74,222,128,0.12)',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)',
    },
    stepperTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
    stepperFill: { height: '100%', backgroundColor: '#4ADE80', borderRadius: 3 },
    rangeLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
    submitBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#E6B450', borderRadius: 14, paddingVertical: 16, marginTop: 8,
    },
    submitBtnText: { fontSize: 15, fontWeight: '800', color: '#000' },
});
