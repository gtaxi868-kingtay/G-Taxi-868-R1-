import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Share,
    ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import type { AppScreenProps } from '../navigation/types';

const CYAN = '#06B6D4';

function fmt(cents: number) {
    return `TTD $${(cents / 100).toFixed(2)}`;
}

export function ReferralScreen({ navigation }: AppScreenProps<'Referral'>) {
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
            const { data: existingCode } = await supabase
                .from('referral_codes')
                .select('code')
                .eq('user_id', user.id)
                .maybeSingle();

            if (existingCode?.code) {
                setCode(existingCode.code);
            } else {
                const { data: newCode, error } = await supabase
                    .rpc('generate_referral_code', { p_user_id: user.id, p_type: 'rider' });
                if (!error && newCode) setCode(newCode);
            }

            const { data: earningRows } = await supabase
                .from('referral_earnings')
                .select('*')
                .eq('referrer_id', user.id)
                .order('created_at', { ascending: false });

            if (earningRows) {
                setEarnings(earningRows);
                const total = earningRows
                    .filter((r: any) => r.status === 'paid')
                    .reduce((s: number, r: any) => s + r.amount_cents, 0);
                setTotalEarned(total);
            }
        } catch (e) {
            console.warn('Referral load error:', e);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const copyCode = async () => {
        if (!code) return;
        setCopying(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        try {
            const { setStringAsync } = await import('expo-clipboard');
            await setStringAsync(code);
        } catch {
            await Share.share({ message: code });
        }
        setTimeout(() => setCopying(false), 1500);
    };

    const shareCode = async () => {
        if (!code) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Share.share({
            message: `Use my G-Taxi code ${code} when signing up — you get TTD $15 in ride credits, and so do I! Download: https://gtaxi.tt`,
            title: 'Get TTD $15 on G-Taxi',
        });
    };

    const renderEarning = ({ item }: { item: any }) => {
        const isPaid = item.status === 'paid';
        return (
            <View style={st.earningRow}>
                <View style={[st.earningDot, { backgroundColor: isPaid ? '#22C55E' : 'rgba(255,255,255,0.2)' }]} />
                <View style={{ flex: 1 }}>
                    <Text style={st.earningLabel}>
                        {item.type === 'rider' ? 'Rider signup bonus' : 'Driver referral'}
                    </Text>
                    <Text style={st.earningDate}>
                        {new Date(item.created_at).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' })}
                    </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[st.earningAmount, { color: isPaid ? '#22C55E' : 'rgba(255,255,255,0.4)' }]}>
                        {fmt(item.amount_cents)}
                    </Text>
                    <Text style={[st.earningStatus, { color: isPaid ? '#22C55E' : 'rgba(255,255,255,0.3)' }]}>
                        {item.status}
                    </Text>
                </View>
            </View>
        );
    };

    return (
        <LinearGradient colors={['#07070F', '#07070F']} style={st.root}>
            <StatusBar style="light" />
            <View style={[st.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={st.headerTitle}>Refer & Earn</Text>
                <View style={{ width: 38 }} />
            </View>

            {loading ? (
                <View style={st.center}><ActivityIndicator size="large" color={CYAN} /></View>
            ) : (
                <FlatList
                    data={earnings}
                    keyExtractor={i => i.id}
                    renderItem={renderEarning}
                    contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 32 }]}
                    ListHeaderComponent={
                        <>
                            <View style={st.hero}>
                                <LinearGradient colors={[`${CYAN}33`, 'transparent']} style={st.heroGlow}>
                                    <Ionicons name="gift-outline" size={48} color={CYAN} />
                                </LinearGradient>
                                <Text style={st.heroTitle}>Give TTD $15, Get TTD $15</Text>
                                <Text style={st.heroSub}>
                                    Share your code. When a friend takes their first ride, you both earn TTD $15 in wallet credits.
                                </Text>
                            </View>

                            {code ? (
                                <BlurView intensity={60} tint="dark" style={st.codeCard}>
                                    <Text style={st.codeLabel}>YOUR CODE</Text>
                                    <Text style={st.codeText}>{code}</Text>
                                    <View style={st.codeActions}>
                                        <TouchableOpacity style={st.copyBtn} onPress={copyCode}>
                                            <Ionicons name={copying ? 'checkmark' : 'copy-outline'} size={18} color={CYAN} />
                                            <Text style={st.copyBtnText}>{copying ? 'Copied!' : 'Copy'}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={st.shareBtn} onPress={shareCode}>
                                            <Ionicons name="share-social-outline" size={18} color="#EAF3F6" />
                                            <Text style={st.shareBtnText}>Share</Text>
                                        </TouchableOpacity>
                                    </View>
                                </BlurView>
                            ) : (
                                <BlurView intensity={60} tint="dark" style={st.codeCard}>
                                    <Text style={st.codeLabel}>Generating your code...</Text>
                                    <ActivityIndicator size="small" color={CYAN} style={{ marginTop: 12 }} />
                                </BlurView>
                            )}

                            <View style={st.statsRow}>
                                <BlurView intensity={60} tint="dark" style={st.statBox}>
                                    <Text style={st.statNum}>{earnings.length}</Text>
                                    <Text style={st.statLabel}>Referrals</Text>
                                </BlurView>
                                <BlurView intensity={60} tint="dark" style={st.statBox}>
                                    <Text style={[st.statNum, { color: '#22C55E' }]}>{fmt(totalEarned)}</Text>
                                    <Text style={st.statLabel}>Total Earned</Text>
                                </BlurView>
                            </View>

                            <Text style={st.sectionTitle}>How It Works</Text>
                            {[
                                { icon: 'share-social', step: '1', text: 'Share your code with friends' },
                                { icon: 'person-add', step: '2', text: 'Friend signs up and enters your code' },
                                { icon: 'car', step: '3', text: 'They take their first ride' },
                                { icon: 'wallet', step: '4', text: 'You both get TTD $15 in your wallet' },
                            ].map(step => (
                                <View key={step.step} style={st.stepRow}>
                                    <View style={[st.stepNum, { backgroundColor: `${CYAN}33` }]}>
                                        <Text style={[st.stepNumText, { color: CYAN }]}>{step.step}</Text>
                                    </View>
                                    <Ionicons name={step.icon as any} size={18} color="rgba(255,255,255,0.5)" style={{ marginRight: 10 }} />
                                    <Text style={st.stepText}>{step.text}</Text>
                                </View>
                            ))}

                            {earnings.length > 0 && <Text style={[st.sectionTitle, { marginTop: 24 }]}>History</Text>}
                        </>
                    }
                    ListEmptyComponent={
                        <BlurView intensity={60} tint="dark" style={st.emptyCard}>
                            <Ionicons name="people-outline" size={32} color="rgba(255,255,255,0.2)" />
                            <Text style={st.emptyText}>No referrals yet — share your code to start earning.</Text>
                        </BlurView>
                    }
                />
            )}
        </LinearGradient>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
        ...elevationGlow(),
    },
    headerTitle: { color: '#EAF3F6', fontWeight: '800', fontSize: 20 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, gap: 16 },
    hero: { alignItems: 'center', paddingVertical: 16 },
    heroGlow: {
        width: 80, height: 80, borderRadius: 40,
        alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    heroTitle: { color: '#EAF3F6', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
    heroSub: { color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
    codeCard: {
        borderRadius: 24, padding: 24, alignItems: 'center', overflow: 'hidden',
        ...ghostBorder(0.2),
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    codeLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
    codeText: { color: '#EAF3F6', fontSize: 40, fontWeight: '900', letterSpacing: 6, marginBottom: 20 },
    codeActions: { flexDirection: 'row', gap: 12 },
    copyBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 12, borderRadius: 99,
        backgroundColor: `${CYAN}26`, borderWidth: 1, borderColor: `${CYAN}66`,
    },
    shareBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 12, borderRadius: 99,
        backgroundColor: CYAN,
    },
    copyBtnText: { color: CYAN, fontWeight: '700', fontSize: 14 },
    shareBtnText: { color: '#EAF3F6', fontWeight: '700', fontSize: 14 },
    statsRow: { flexDirection: 'row', gap: 12 },
    statBox: {
        flex: 1, borderRadius: 20, padding: 20, alignItems: 'center',
        overflow: 'hidden', ...ghostBorder(0.1),
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    statNum: { color: '#EAF3F6', fontSize: 24, fontWeight: '800' },
    statLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 },
    sectionTitle: { color: '#EAF3F6', fontSize: 16, fontWeight: '700' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10 },
    stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
    stepNumText: { fontWeight: '700', fontSize: 12 },
    stepText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, flex: 1 },
    earningRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    earningDot: { width: 10, height: 10, borderRadius: 5 },
    earningLabel: { color: '#EAF3F6', fontSize: 14, fontWeight: '600' },
    earningDate: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 },
    earningAmount: { fontSize: 15, fontWeight: '700' },
    earningStatus: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize', marginTop: 2 },
    emptyCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderRadius: 20, padding: 20,
        overflow: 'hidden', ...ghostBorder(0.1),
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, flex: 1 },
});
