import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Share,
    ActivityIndicator, FlatList, Clipboard, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import type { AppScreenProps } from '../navigation/types';

const GREEN = '#22C55E';
const ACCENT = '#10B981';

function fmt(cents: number) {
    return `TTD $${(cents / 100).toFixed(2)}`;
}

export function DriverReferralScreen({ navigation }: AppScreenProps<'DriverReferral'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [code, setCode] = useState<string | null>(null);
    const [earnings, setEarnings] = useState<any[]>([]);
    const [totalEarned, setTotalEarned] = useState(0);
    const [loading, setLoading] = useState(true);
    const [copying, setCopying] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: existing } = await supabase
                .from('referral_codes')
                .select('code')
                .eq('user_id', user.id)
                .eq('type', 'driver')
                .maybeSingle();

            if (existing?.code) {
                setCode(existing.code);
            } else {
                const { data: newCode } = await supabase
                    .rpc('generate_referral_code', { p_user_id: user.id, p_type: 'driver' });
                if (newCode) setCode(newCode);
            }

            const { data: rows } = await supabase
                .from('referral_earnings')
                .select('*')
                .eq('referrer_id', user.id)
                .eq('type', 'driver')
                .order('created_at', { ascending: false });

            if (rows) {
                setEarnings(rows);
                const total = rows
                    .filter((r: any) => r.status === 'paid')
                    .reduce((s: number, r: any) => s + r.amount_cents, 0);
                setTotalEarned(total);
            }
        } catch (e) {
            console.warn('DriverReferral load error:', e);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const copyCode = async () => {
        if (!code) return;
        setCopying(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Clipboard.setString(code);
        setTimeout(() => setCopying(false), 1500);
    };

    const shareCode = async () => {
        if (!code) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Share.share({
            message: `Drive with G-Taxi! Use my driver referral code ${code} when you register — we both earn when you complete rides. Sign up: https://gtaxi.tt/driver`,
            title: 'Drive with G-Taxi',
        });
    };

    const renderEarning = ({ item }: { item: any }) => {
        const isPaid = item.status === 'paid';
        return (
            <View style={styles.earningRow}>
                <View style={[styles.earningDot, { backgroundColor: isPaid ? GREEN : '#F59E0B' }]} />
                <View style={{ flex: 1 }}>
                    <Text style={styles.earningLabel}>Driver commission (1%)</Text>
                    <Text style={styles.earningDate}>
                        {new Date(item.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' })}
                    </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.earningAmount, { color: isPaid ? GREEN : 'rgba(255,255,255,0.4)' }]}>
                        {fmt(item.amount_cents)}
                    </Text>
                    <Text style={[styles.earningStatus, { color: isPaid ? GREEN : '#F59E0B' }]}>
                        {item.status}
                    </Text>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Refer a Driver</Text>
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color={ACCENT} /></View>
            ) : (
                <FlatList
                    data={earnings}
                    keyExtractor={i => i.id}
                    renderItem={renderEarning}
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
                    ListHeaderComponent={
                        <>
                            <View style={styles.hero}>
                                <Ionicons name="car-sport-outline" size={48} color="#00FFFF" />
                                <Text style={styles.heroTitle}>Earn on Every Ride They Take</Text>
                                <Text style={styles.heroSub}>
                                    Refer a driver and earn 1% of their platform fee for 90 days.
                                    There's no cap — the more they drive, the more you earn.
                                </Text>
                            </View>

                            {code ? (
                                <View style={styles.codeCard}>
                                    <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
                                    <Text style={styles.codeText}>{code}</Text>
                                    <View style={styles.codeActions}>
                                        <TouchableOpacity style={styles.codeBtn} onPress={copyCode}>
                                            <Ionicons name={copying ? 'checkmark' : 'copy-outline'} size={18} color={ACCENT} />
                                            <Text style={styles.codeBtnText}>{copying ? 'Copied!' : 'Copy'}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={[styles.codeBtn, styles.shareBtn]} onPress={shareCode}>
                                            <Ionicons name="share-social-outline" size={18} color="#FFF" />
                                            <Text style={[styles.codeBtnText, { color: '#FFF' }]}>Share</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.codeCard}>
                                    <Text style={styles.codeLabel}>Generating your code...</Text>
                                    <ActivityIndicator size="small" color={ACCENT} style={{ marginTop: 12 }} />
                                </View>
                            )}

                            <View style={styles.statsRow}>
                                <View style={styles.statBox}>
                                    <Text style={styles.statNum}>{earnings.length}</Text>
                                    <Text style={styles.statLabel}>Referrals</Text>
                                </View>
                                <View style={styles.statBox}>
                                    <Text style={[styles.statNum, { color: GREEN }]}>{fmt(totalEarned)}</Text>
                                    <Text style={styles.statLabel}>Total Earned</Text>
                                </View>
                            </View>

                            <View style={styles.infoCard}>
                                <Text style={styles.infoTitle}>How the 1% works</Text>
                                <Text style={styles.infoText}>
                                    When your referred driver completes a ride, G-Taxi takes a platform fee. You receive 1% of that fee — deducted from platform revenue, not their payout.
                                    This runs for 90 days from when they activate.
                                </Text>
                            </View>

                            <Text style={styles.sectionTitle}>How It Works</Text>
                            {[
                                { icon: 'share-social', step: '1', text: 'Share your driver code with another driver' },
                                { icon: 'person-add', step: '2', text: 'They register and enter your code' },
                                { icon: 'car', step: '3', text: 'They start completing rides' },
                                { icon: 'wallet', step: '4', text: 'You earn 1% of their platform fee for 90 days' },
                            ].map(s => (
                                <View key={s.step} style={styles.stepRow}>
                                    <View style={styles.stepNum}>
                                        <Text style={styles.stepNumText}>{s.step}</Text>
                                    </View>
                                    <Ionicons name={s.icon as any} size={18} color="rgba(255,255,255,0.5)" style={{ marginRight: 10 }} />
                                    <Text style={styles.stepText}>{s.text}</Text>
                                </View>
                            ))}

                            {earnings.length > 0 && <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Earnings History</Text>}
                        </>
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyHistory}>
                            <Text style={styles.emptyHistoryText}>No referral earnings yet — share your code to start.</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 20 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, gap: 16 },
    hero: { alignItems: 'center', paddingVertical: 16 },
    heroEmoji: { fontSize: 48, marginBottom: 12 },
    heroTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
    heroSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
    codeCard: { backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', padding: 24, alignItems: 'center' },
    codeLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
    codeText: { color: '#FFF', fontSize: 40, fontWeight: '900', letterSpacing: 6, marginBottom: 20 },
    codeActions: { flexDirection: 'row', gap: 12 },
    codeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 99, backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)' },
    shareBtn: { backgroundColor: ACCENT, borderColor: ACCENT },
    codeBtnText: { color: ACCENT, fontWeight: '700', fontSize: 14 },
    statsRow: { flexDirection: 'row', gap: 12 },
    statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    statNum: { color: '#FFF', fontSize: 24, fontWeight: '800' },
    statLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 },
    infoCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    infoTitle: { color: '#FFF', fontWeight: '700', fontSize: 15, marginBottom: 8 },
    infoText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 20 },
    sectionTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10 },
    stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(16,185,129,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    stepNumText: { color: ACCENT, fontWeight: '700', fontSize: 12 },
    stepText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, flex: 1 },
    earningRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    earningDot: { width: 10, height: 10, borderRadius: 5 },
    earningLabel: { color: '#FFF', fontSize: 14, fontWeight: '600' },
    earningDate: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 },
    earningAmount: { fontSize: 15, fontWeight: '700' },
    earningStatus: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', marginTop: 2 },
    emptyHistory: { paddingTop: 8 },
    emptyHistoryText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center' },
});
