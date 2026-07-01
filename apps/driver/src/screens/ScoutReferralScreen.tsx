import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';

const GOLD = '#E6B450';
const SURFACE = '#08090D';

export function ScoutReferralScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();

    const [propertyName, setPropertyName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [myReferrals, setMyReferrals] = useState<any[]>([]);
    const [loadingReferrals, setLoadingReferrals] = useState(true);

    useEffect(() => {
        if (!driver) return;
        supabase
            .from('driver_scout_referrals')
            .select('*')
            .eq('driver_id', driver.id)
            .order('created_at', { ascending: false })
            .then(({ data }) => {
                setMyReferrals(data || []);
                setLoadingReferrals(false);
            });
    }, [driver]);

    const handleSubmit = async () => {
        if (!propertyName.trim()) {
            Alert.alert('Required', 'Please enter the property name.');
            return;
        }
        if (!driver) return;

        setSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        const { error } = await supabase
            .from('driver_scout_referrals')
            .insert({
                driver_id: driver.id,
                property_name: propertyName.trim(),
                contact_phone: contactPhone.trim() || null,
                status: 'pending',
            });

        setSubmitting(false);
        if (error) {
            Alert.alert('Error', error.message || 'Could not submit referral.');
            return;
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
            'Referral Submitted!',
            'If this property signs with G-Taxi, you\'ll earn TTD $500 credited to your wallet automatically.',
            [{ text: 'Got it', onPress: () => { setPropertyName(''); setContactPhone(''); } }]
        );

        const { data: updated } = await supabase
            .from('driver_scout_referrals')
            .select('*')
            .eq('driver_id', driver.id)
            .order('created_at', { ascending: false });
        setMyReferrals(updated || []);
    };

    const totalEarned = myReferrals
        .filter(r => r.status === 'paid')
        .reduce((s, r) => s + r.payout_amount_cents, 0);

    const STATUS_COLORS: Record<string, string> = {
        pending: '#E6B450',
        qualified: '#3B82F6',
        paid: '#22C55E',
        expired: '#6B7280',
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Scout Referrals</Text>
            </View>

            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
                {/* Hero */}
                <LinearGradient
                    colors={['rgba(230,180,80,0.15)', 'rgba(230,180,80,0.04)']}
                    style={styles.hero}
                >
                    <Text style={styles.heroAmount}>TTD $500</Text>
                    <Text style={styles.heroLabel}>per hotel or villa you introduce to G-Taxi</Text>
                    <Text style={styles.heroSub}>
                        Drop off a guest at a hotel? Spot a villa cluster? Submit the lead. If they sign up, you get paid.
                    </Text>
                </LinearGradient>

                {/* Stats row */}
                <View style={styles.statsRow}>
                    <StatCard icon="paper-plane-outline" label="Submitted" value={myReferrals.length} />
                    <StatCard icon="checkmark-circle-outline" label="Qualified" value={myReferrals.filter(r => r.status === 'qualified' || r.status === 'paid').length} />
                    <StatCard icon="cash-outline" label="Earned" value={`$${totalEarned / 100}`} gold />
                </View>

                {/* Submit form */}
                <View style={styles.formCard}>
                    <Text style={styles.formTitle}>Submit a Lead</Text>
                    <Text style={styles.formHint}>
                        Tell us the property name and a contact number if you have one. Our team will reach out.
                    </Text>
                    <TextInput
                        style={styles.input}
                        value={propertyName}
                        onChangeText={setPropertyName}
                        placeholder="Property / hotel name"
                        placeholderTextColor="rgba(255,255,255,0.2)"
                    />
                    <TextInput
                        style={styles.input}
                        value={contactPhone}
                        onChangeText={setContactPhone}
                        placeholder="Contact phone (optional)"
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        keyboardType="phone-pad"
                    />
                    <TouchableOpacity
                        onPress={handleSubmit}
                        disabled={submitting}
                        style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                    >
                        {submitting
                            ? <ActivityIndicator size="small" color="#EAF3F6" />
                            : <Text style={styles.submitBtnText}>Submit Lead</Text>
                        }
                    </TouchableOpacity>
                </View>

                {/* My referrals */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>MY REFERRALS</Text>
                    {loadingReferrals ? (
                        <ActivityIndicator size="small" color={GOLD} />
                    ) : myReferrals.length === 0 ? (
                        <Text style={styles.emptyText}>No referrals submitted yet.</Text>
                    ) : (
                        myReferrals.map(r => (
                            <View key={r.id} style={styles.referralRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.refName}>{r.property_name}</Text>
                                    {r.contact_phone && <Text style={styles.refPhone}>{r.contact_phone}</Text>}
                                    <Text style={styles.refCode}>Code: {r.referral_code}</Text>
                                </View>
                                <View style={[styles.refBadge, { backgroundColor: (STATUS_COLORS[r.status] || '#6B7280') + '20' }]}>
                                    <Text style={[styles.refBadgeText, { color: STATUS_COLORS[r.status] || '#6B7280' }]}>{r.status}</Text>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                {/* How it works */}
                <View style={styles.howCard}>
                    <Text style={styles.howTitle}>How It Works</Text>
                    <HowStep num={1} text="You spot a hotel, B&B, or villa that might want guests." />
                    <HowStep num={2} text="Submit the lead with the property name and any contact info you have." />
                    <HowStep num={3} text="Our team contacts them and explains the Caribbean Escapes pipeline." />
                    <HowStep num={4} text="If they sign up and their first rooms are booked, TTD $500 hits your wallet." />
                </View>
            </ScrollView>
        </View>
    );
}

function StatCard({ icon, label, value, gold }: { icon: string; label: string; value: string | number; gold?: boolean }) {
    return (
        <View style={[styles.statCard, gold && { borderColor: 'rgba(230,180,80,0.2)' }]}>
            <Ionicons name={icon as any} size={20} color={gold ? GOLD : 'rgba(255,255,255,0.4)'} />
            <Text style={[styles.statValue, gold && { color: GOLD }]}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

function HowStep({ num, text }: { num: number; text: string }) {
    return (
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>{num}</Text></View>
            <Text style={styles.stepText}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#EAF3F6', fontWeight: '800', fontSize: 20 },
    scroll: { padding: 20, gap: 20 },
    hero: { borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(230,180,80,0.15)', alignItems: 'center' },
    heroAmount: { color: GOLD, fontWeight: '900', fontSize: 40 },
    heroLabel: { color: '#EAF3F6', fontWeight: '700', fontSize: 15, marginTop: 4, textAlign: 'center' },
    heroSub: { color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10 },
    statsRow: { flexDirection: 'row', gap: 10 },
    statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 18, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    statValue: { color: '#EAF3F6', fontWeight: '800', fontSize: 18 },
    statLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'center' },
    formCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 18, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    formTitle: { color: '#EAF3F6', fontWeight: '700', fontSize: 16 },
    formHint: { color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 18 },
    input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, color: '#EAF3F6', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    submitBtn: { backgroundColor: GOLD, borderRadius: 16, alignItems: 'center', paddingVertical: 14 },
    submitBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
    section: { gap: 8 },
    sectionTitle: { color: 'rgba(255,255,255,0.3)', fontWeight: '700', fontSize: 11, letterSpacing: 2 },
    emptyText: { color: 'rgba(255,255,255,0.25)', fontSize: 13 },
    referralRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 14, gap: 10 },
    refName: { color: '#EAF3F6', fontWeight: '600', fontSize: 14 },
    refPhone: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
    refCode: { color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
    refBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
    refBadgeText: { fontWeight: '700', fontSize: 11, textTransform: 'capitalize' },
    howCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    howTitle: { color: '#EAF3F6', fontWeight: '700', fontSize: 15, marginBottom: 14 },
    stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(230,180,80,0.15)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    stepNumText: { color: GOLD, fontWeight: '800', fontSize: 12 },
    stepText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 19, flex: 1 },
});
