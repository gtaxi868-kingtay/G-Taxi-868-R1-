import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { AppScreenProps } from '../navigation/types';

const { supabase } = initializeSupabaseClient('native');

const ADDENDUM_VERSION = '1.0';

const ADDENDUM_TERMS = [
    {
        heading: 'Earnings Assignment',
        body: 'I hereby explicitly authorise and direct G-Taxi to automatically deduct the daily loan service amount from my gross platform earnings prior to wallet payout, and transfer said funds to the partner bank to service my vehicle financing agreement.',
    },
    {
        heading: 'Sole Liability',
        body: 'I acknowledge that I remain solely liable to the lender for the fulfillment of my loan terms. G-Taxi acts as a processing agent only and carries zero financial liability for loan defaults.',
    },
    {
        heading: 'Deduction Cap',
        body: 'Deductions are capped at 15% of gross ride fare per trip. On smaller rides the deduction scales down proportionally. I will always receive at least 85% of my gross driver payout.',
    },
    {
        heading: 'Bank Escrow Routing',
        body: 'The deducted installment is routed to a bank escrow sub-ledger and wired to the partner bank weekly. These funds are never credited to my general G-Taxi wallet.',
    },
    {
        heading: 'Termination',
        body: 'If I cease driving on the G-Taxi platform, this authorisation terminates. Outstanding loan obligations remain with the lender. G-Taxi will deactivate my driver profile and cease processing deductions.',
    },
    {
        heading: 'Amendment',
        body: 'G-Taxi may update these terms with 30 days written notice. Continued use of the platform after notice constitutes acceptance of the updated terms.',
    },
];

export default function LeaseConsentScreen({ navigation }: AppScreenProps<'LeaseConsent'>) {
    const insets = useSafeAreaInsets();
    const [driverId, setDriverId] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data: driver } = await supabase
                .from('drivers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();
            if (driver?.id) setDriverId(driver.id);
        })();
    }, []);

    const [applyResult, setApplyResult] = useState<{
        success: boolean;
        leaseId?: string;
        message?: string;
        earnings_payload?: { total_rides: number; total_earned_cents: number; avg_per_ride_cents: number };
    } | null>(null);

    const handleSign = async () => {
        if (!agreed || !driverId) return;
        setSubmitting(true);
        try {
            const { data: consentData, error: consentError } = await supabase.rpc('record_driver_lease_consent', {
                p_driver_id: driverId,
                p_version: ADDENDUM_VERSION,
                p_device_info: {},
            });

            if (consentError || !consentData?.success) {
                Alert.alert(
                    'Could not record consent',
                    consentData?.error ?? consentError?.message ?? 'Unknown error. Please try again.',
                );
                return;
            }

            const { data: { user } } = await supabase.auth.getUser();
            const { data: earningsPayload } = user ? await supabase
                .from('drivers')
                .select(`
                    id,
                    rides!inner(driver_payout_cents, completed_at)
                `)
                .eq('user_id', user.id)
                .single() : { data: null };

            const payload: any = {
                fleet_vehicle_id: null,
                daily_deduction_cents: 15000,
                total_lease_cents: null,
            };

            if (earningsPayload?.rides) {
                const rides = Array.isArray(earningsPayload.rides) ? earningsPayload.rides : [earningsPayload.rides];
                const totalRides = rides.length;
                const totalEarned = rides.reduce((s: number, r: any) => s + (r.driver_payout_cents || 0), 0);
                payload.proof_of_income = {
                    total_rides: totalRides,
                    total_earned_cents: totalEarned,
                    avg_per_ride_cents: totalRides > 0 ? Math.round(totalEarned / totalRides) : 0,
                };
            }

            const { data: leaseResult, error: leaseError } = await supabase.functions.invoke('apply_for_lease', {
                body: payload,
            });

            if (leaseError || !leaseResult?.success) {
                setApplyResult({
                    success: false,
                    message: leaseResult?.error || leaseError?.message || 'Lease application submission failed. Admin has been notified.',
                });
                setSubmitted(true);
                return;
            }

            setApplyResult({
                success: true,
                leaseId: leaseResult.data?.lease_id,
                earnings_payload: payload.proof_of_income,
            });
            setSubmitted(true);
        } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Something went wrong.');
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;
        return (
            <View style={[s.container, { paddingTop: insets.top }]}>
                <View style={s.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                        <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                    </TouchableOpacity>
                    <Text style={s.headerTitle}>Earnings Addendum</Text>
                </View>
                <ScrollView contentContainerStyle={s.scroll}>
                    {applyResult?.success ? (
                        <>
                            <View style={s.successIcon}>
                                <Ionicons name="checkmark-circle-sharp" size={64} color="#4ADE80" />
                            </View>
                            <Text style={s.successTitle}>Lease Application Submitted</Text>
                            <Text style={s.successBody}>
                                Your earnings addendum has been signed and your BYD lease application is now under review by Term Finance. You will receive a push notification when approved.
                            </Text>

                            {applyResult.earnings_payload && (
                                <View style={s.earningsCard}>
                                    <Text style={s.earningsCardTitle}>PROOF OF INCOME SUBMITTED</Text>
                                    <View style={s.earningsRow}>
                                        <Text style={s.earningsLabel}>Total Rides</Text>
                                        <Text style={s.earningsValue}>{applyResult.earnings_payload.total_rides}</Text>
                                    </View>
                                    <View style={s.earningsRow}>
                                        <Text style={s.earningsLabel}>Lifetime Gross</Text>
                                        <Text style={s.earningsValue}>{formatTTD(applyResult.earnings_payload.total_earned_cents)}</Text>
                                    </View>
                                    <View style={s.earningsRow}>
                                        <Text style={s.earningsLabel}>Avg Per Ride</Text>
                                        <Text style={s.earningsValue}>{formatTTD(applyResult.earnings_payload.avg_per_ride_cents)}</Text>
                                    </View>
                                    {applyResult.leaseId && (
                                        <Text style={s.refText}>Ref: {applyResult.leaseId}</Text>
                                    )}
                                </View>
                            )}

                            <TouchableOpacity style={s.doneCta} onPress={() => navigation.navigate('Lease')}>
                                <Text style={s.doneCtaText}>Back to Lease Status</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <View style={s.successIcon}>
                                <Ionicons name="alert-circle-sharp" size={64} color="#F59E0B" />
                            </View>
                            <Text style={[s.successTitle, { color: '#F59E0B' }]}>Consent Recorded</Text>
                            <Text style={s.successBody}>
                                Your addendum has been signed but the lease application encountered an issue. G-Taxi admin has been notified and will follow up.
                            </Text>
                            <Text style={s.successBody}>
                                {applyResult?.message || 'No additional details available.'}
                            </Text>
                            <TouchableOpacity style={s.doneCta} onPress={() => navigation.navigate('Lease')}>
                                <Text style={s.doneCtaText}>Back to Lease Status</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={[s.container, { paddingTop: insets.top }]}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Earnings Addendum</Text>
            </View>

            <ScrollView
                contentContainerStyle={s.scroll}
                showsVerticalScrollIndicator={false}
            >
                <View style={s.introCard}>
                    <LinearGradient
                        colors={['rgba(230,180,80,0.15)', 'rgba(230,180,80,0.04)']}
                        style={s.introGradient}
                    >
                        <View style={s.introIcon}>
                            <Ionicons name="document-text-sharp" size={32} color="#E6B450" />
                        </View>
                        <Text style={s.introTitle}>Earnings Assignment Addendum</Text>
                        <Text style={s.introSubtitle}>
                            This document authorises G-Taxi to deduct BYD lease installments from your ride earnings at source, before your wallet is credited. Read every clause before signing.
                        </Text>
                        <View style={s.versionRow}>
                            <Text style={s.versionLabel}>Version</Text>
                            <Text style={s.versionValue}>{ADDENDUM_VERSION}</Text>
                        </View>
                    </LinearGradient>
                </View>

                {ADDENDUM_TERMS.map((clause, i) => (
                    <View key={i} style={s.clause}>
                        <Text style={s.clauseNumber}>{String(i + 1).padStart(2, '0')}</Text>
                        <View style={s.clauseBody}>
                            <Text style={s.clauseHeading}>{clause.heading}</Text>
                            <Text style={s.clauseText}>{clause.body}</Text>
                        </View>
                    </View>
                ))}

                <TouchableOpacity
                    style={s.checkRow}
                    onPress={() => setAgreed(v => !v)}
                    activeOpacity={0.7}
                >
                    <View style={[s.checkbox, agreed && s.checkboxChecked]}>
                        {agreed && <Ionicons name="checkmark-sharp" size={14} color="#000" />}
                    </View>
                    <Text style={s.checkLabel}>
                        I have read and understood every clause above. I authorise G-Taxi to deduct my BYD lease installments from my earnings at source as described.
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.signCta, (!agreed || submitting || !driverId) && s.signCtaDisabled]}
                    onPress={handleSign}
                    disabled={!agreed || submitting || !driverId}
                    activeOpacity={0.85}
                >
                    {submitting ? (
                        <ActivityIndicator color="#000" />
                    ) : (
                        <>
                            <Ionicons name="pencil-sharp" size={18} color="#000" style={{ marginRight: 8 }} />
                            <Text style={s.signCtaText}>Sign &amp; Authorise Deductions</Text>
                        </>
                    )}
                </TouchableOpacity>

                <Text style={s.legalNote}>
                    By signing you confirm you are the registered G-Taxi driver account holder. This addendum forms part of your Independent Contractor Agreement with G-Taxi Operations Ltd.
                </Text>
            </ScrollView>
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
    scroll: { padding: 20, paddingBottom: 60 },

    introCard: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(230,180,80,0.2)', marginBottom: 28 },
    introGradient: { padding: 24 },
    introIcon: {
        width: 60, height: 60, borderRadius: 18,
        backgroundColor: 'rgba(230,180,80,0.15)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    },
    introTitle: { fontSize: 20, fontWeight: '800', color: '#E6B450', marginBottom: 10 },
    introSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 22, marginBottom: 16 },
    versionRow: { flexDirection: 'row', gap: 8 },
    versionLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
    versionValue: { fontSize: 12, color: '#E6B450', fontWeight: '700' },

    clause: {
        flexDirection: 'row',
        gap: 14,
        marginBottom: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    clauseNumber: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.2)', marginTop: 2, minWidth: 22 },
    clauseBody: { flex: 1 },
    clauseHeading: { fontSize: 14, fontWeight: '700', color: '#EAF3F6', marginBottom: 6 },
    clauseText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 20 },

    checkRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    checkbox: {
        width: 22, height: 22, borderRadius: 6,
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
        alignItems: 'center', justifyContent: 'center',
        marginTop: 1, flexShrink: 0,
    },
    checkboxChecked: { backgroundColor: '#E6B450', borderColor: '#E6B450' },
    checkLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1, lineHeight: 20 },

    signCta: {
        backgroundColor: '#E6B450',
        borderRadius: 16,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    signCtaDisabled: { opacity: 0.35 },
    signCtaText: { fontSize: 16, fontWeight: '800', color: '#000' },

    legalNote: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.25)',
        textAlign: 'center',
        lineHeight: 17,
        marginBottom: 20,
    },

    successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    successIcon: { marginBottom: 24 },
    successTitle: { fontSize: 28, fontWeight: '800', color: '#4ADE80', marginBottom: 16, textAlign: 'center' },
    successBody: { fontSize: 15, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
    doneCta: {
        backgroundColor: 'rgba(74,222,128,0.15)',
        borderWidth: 1,
        borderColor: 'rgba(74,222,128,0.4)',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 32,
    },
    doneCtaText: { fontSize: 15, fontWeight: '700', color: '#4ADE80' },
    earningsCard: {
        backgroundColor: 'rgba(74,222,128,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(74,222,128,0.2)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        alignSelf: 'stretch',
    },
    earningsCardTitle: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 12 },
    earningsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    earningsLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
    earningsValue: { fontSize: 14, fontWeight: '800', color: '#4ADE80' },
    refText: { fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 12, fontFamily: 'monospace' },
});
