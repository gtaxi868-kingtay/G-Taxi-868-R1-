import React, { useEffect, useState } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Linking, Text, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, useDerivedValue, withSpring, withSequence,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

// ── Driver-only tokens — never import rider tokens ────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(139,92,246,0.15)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    purpleDim: 'rgba(124,58,237,0.18)',
    gold: '#F59E0B',
    goldDim: 'rgba(245,158,11,0.12)',
    green: '#10B981',
    greenDim: 'rgba(16,185,129,0.12)',
    red: '#EF4444',
    redDim: 'rgba(239,68,68,0.12)',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.06)',
};

// ── "How It Works" info rows config ──────────────────────────────────────────
const INFO_ROWS = [
    {
        icon: 'cash-outline' as const,
        color: '#10B981',
        title: 'Cash Trips',
        body: 'You collect & keep all cash. G-Taxi debits our 19% cut from this ledger.',
    },
    {
        icon: 'card-outline' as const,
        color: '#7C3AED',
        title: 'Card / Wallet Trips',
        body: 'We collect the payment. Your 81% share is credited to this ledger.',
    },
    {
        icon: 'lock-closed-outline' as const,
        color: '#EF4444',
        title: 'The $600 Cap',
        body: 'If your balance hits -$600 TTD you cannot accept new rides until you settle.',
    },
];

// ── Component ─────────────────────────────────────────────────────────────────
export function WalletScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { driver } = useAuth();

    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Reanimated count-up for balance display
    const balanceAnim = useSharedValue(0);
    const balanceDisplay = useDerivedValue(() =>
        `$${Math.abs(balanceAnim.value).toFixed(2)}`
    );

    // ── Supabase queries (DO NOT REMOVE) ────────────────────────────────────
    useEffect(() => {
        if (!driver?.id) return;

        // Balance via RPC
        supabase.rpc('get_wallet_balance', { p_user_id: driver.id })
            .then(({ data, error }) => {
                const cents = (!error && data !== null) ? data : 0;
                const dollars = Number(cents) / 100;
                setBalance(dollars);
                // Count-up: 0 → |balance| in 900ms
                balanceAnim.value = 0;
                balanceAnim.value = withTiming(dollars, { duration: 900 });
                setLoading(false);
            });

        // Transaction ledger rows from payment_ledger table
        supabase
            .from('payment_ledger')
            .select('id, created_at, amount_cents, type, description, ride_id')
            .eq('user_id', driver.id)
            .order('created_at', { ascending: false })
            .limit(30)
            .then(({ data }) => {
                if (data) setTransactions(data);
            });
    }, [driver?.id]);

    const handlePayoutRequest = async () => {
        if (!balance || balance <= 0) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        Alert.alert(
            "Request Payout",
            `Would you like to request a payout of $${balance.toFixed(2)} TTD?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Request",
                    onPress: async () => {
                        const { error } = await supabase
                            .from('payout_requests')
                            .insert({
                                driver_id: driver?.id,
                                amount_cents: Math.round(balance * 100),
                                status: 'pending'
                            });

                        if (error) {
                            Alert.alert("Error", "Could not submit payout request. Please try again.");
                        } else {
                            Alert.alert("Success", "Payout request submitted! Admin will process this within 24-48 hours.");
                        }
                    }
                }
            ]
        );
    };

    const handleDeposit = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Linking.openURL('https://wa.me/18685550100?text=I need to settle my G-Taxi commission balance.');
    };

    const isOwed = balance !== null && balance < 0;
    const isGood = balance !== null && balance >= 0;

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={C.purple} size="large" />
            </View>
        );
    }

    // Color scheme based on balance direction
    const heroGradient: readonly [string, string] = isOwed
        ? ['#3B0A0A', '#1A0505']
        : ['#0D3320', '#052010'];
    const heroBorderColor = isOwed
        ? 'rgba(239,68,68,0.25)'
        : 'rgba(16,185,129,0.25)';
    const heroStatusColor = isOwed ? C.red : C.green;
    const heroStatusLabel = isOwed
        ? `You owe the platform TTD ${(Math.abs(balance || 0) * 0.19 / 0.81).toFixed(0)} (19% cut)`
        : 'Balance all clear ✓';

    return (
        <View style={s.root}>
            {/* ── HEADER — BlurView ─────────────────────────────────────── */}
            <BlurView tint="dark" intensity={80} style={[s.headerBlur, { paddingTop: insets.top + 8 }]}>
                <LinearGradient
                    colors={['rgba(17,14,34,0.95)', 'rgba(7,5,15,0.6)']}
                    style={s.headerInner}
                >
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.goBack();
                        }}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="chevron-back" size={22} color={C.white} />
                    </TouchableOpacity>

                    <Txt variant="headingM" weight="bold" color={C.white}>Wallet</Txt>

                    {/* Spacer — same width as back button for visual centering */}
                    <View style={s.backBtn} pointerEvents="none" />
                </LinearGradient>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* ── HERO BALANCE CARD ─────────────────────────────────── */}
                <LinearGradient
                    colors={heroGradient}
                    style={[s.heroCard, { borderColor: heroBorderColor }]}
                >
                    <Txt variant="caption" weight="bold" color={C.muted} style={{ letterSpacing: 1, marginBottom: 6 }}>
                        TTD COMMISSION BALANCE
                    </Txt>

                    {/* Animated balance — 48px gold */}
                    <Reanimated.Text style={[s.balanceNum, { color: C.gold }]}>
                        {isOwed ? '-' : ''}{balanceDisplay.value}
                    </Reanimated.Text>

                    <Txt variant="small" color={heroStatusColor} style={{ marginTop: 6, fontWeight: '600' }}>
                        {heroStatusLabel}
                    </Txt>

                    {/* Lockout warning */}
                    {isOwed && (balance || 0) <= -600 && (
                        <View style={s.lockBadge}>
                            <Ionicons name="lock-closed" size={14} color={C.white} />
                            <Txt variant="caption" weight="bold" color={C.white} style={{ marginLeft: 6 }}>
                                ACCOUNT RESTRICTED — CAP REACHED
                            </Txt>
                        </View>
                    )}

                    {/* Settle button */}
                    {isOwed && (
                        <TouchableOpacity
                            style={s.settleBtn}
                            onPress={handleDeposit}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="logo-whatsapp" size={16} color={C.white} />
                            <Txt variant="bodyBold" color={C.white} style={{ marginLeft: 8 }}>
                                Settle Balance via Transfer
                            </Txt>
                        </TouchableOpacity>
                    )}

                    {/* Payout button */}
                    {isGood && balance > 0 && (
                        <TouchableOpacity
                            style={[s.settleBtn, { backgroundColor: C.purple }]}
                            onPress={handlePayoutRequest}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="cash-outline" size={16} color={C.white} />
                            <Txt variant="bodyBold" color={C.white} style={{ marginLeft: 8 }}>
                                Request Payout
                            </Txt>
                        </TouchableOpacity>
                    )}
                </LinearGradient>

                {/* ── TRANSACTION HISTORY ───────────────────────────────── */}
                <Txt variant="caption" weight="bold" color={C.muted}
                    style={{ letterSpacing: 1, marginBottom: 12 }}>
                    TRANSACTION HISTORY
                </Txt>

                {transactions.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={36} color={C.muted} />
                        <Txt variant="bodyReg" color={C.muted} style={{ marginTop: 12, textAlign: 'center' }}>
                            No transactions yet.
                        </Txt>
                    </View>
                ) : (
                    <View style={s.txList}>
                        {transactions.map((tx, idx) => {
                            const isCredit = tx.amount_cents >= 0;
                            const amount = (Math.abs(tx.amount_cents) / 100).toFixed(2);
                            const date = new Date(tx.created_at);
                            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const isLast = idx === transactions.length - 1;

                            const txIcon = isCredit ? 'arrow-down-outline' : 'arrow-up-outline';
                            const txColor = isCredit ? C.green : C.red;
                            const txBg = isCredit ? C.greenDim : C.redDim;

                            return (
                                <TouchableOpacity
                                    key={tx.id}
                                    style={[s.txRow, isLast && { borderBottomWidth: 0 }]}
                                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                                    activeOpacity={0.75}
                                >
                                    {/* Icon badge */}
                                    <View style={[s.txIcon, { backgroundColor: txBg }]}>
                                        <Ionicons name={txIcon as any} size={18} color={txColor} />
                                    </View>

                                    {/* Description */}
                                    <View style={{ flex: 1 }}>
                                        <Txt variant="bodyBold" color={C.white} numberOfLines={1}>
                                            {tx.description || (isCredit ? 'Commission Credit' : 'Commission Debit')}
                                        </Txt>
                                        <Txt variant="small" color={C.muted} style={{ marginTop: 3 }}>
                                            {dateStr} · {timeStr}
                                        </Txt>
                                    </View>

                                    {/* Amount */}
                                    <Txt variant="bodyBold" color={txColor}>
                                        {isCredit ? '+' : '-'}${amount}
                                    </Txt>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* ── HOW IT WORKS ──────────────────────────────────────── */}
                <Txt variant="caption" weight="bold" color={C.muted}
                    style={{ letterSpacing: 1, marginTop: 28, marginBottom: 12 }}>
                    HOW IT WORKS
                </Txt>

                <View style={s.infoCard}>
                    {INFO_ROWS.map((row, i) => (
                        <View key={row.title}>
                            <View style={s.infoRow}>
                                <View style={[s.infoIconWrap, { backgroundColor: `${row.color}18` }]}>
                                    <Ionicons name={row.icon} size={20} color={row.color} />
                                </View>
                                <View style={{ flex: 1, gap: 3 }}>
                                    <Txt variant="bodyBold" color={C.white}>{row.title}</Txt>
                                    <Txt variant="small" color={C.muted}>{row.body}</Txt>
                                </View>
                            </View>
                            {i < INFO_ROWS.length - 1 && <View style={s.infoDivider} />}
                        </View>
                    ))}
                </View>

                <View style={{ height: insets.bottom + 32 }} />
            </ScrollView>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    // Header
    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, borderBottomWidth: 1, borderColor: C.border,
    },
    headerInner: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center', justifyContent: 'center',
    },

    // Hero card
    heroCard: {
        borderRadius: 24, padding: 24,
        borderWidth: 1, alignItems: 'center',
        marginBottom: 28,
    },
    balanceNum: {
        fontSize: 48, fontWeight: '800',
        letterSpacing: -1,
    },
    lockBadge: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.red,
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20, marginTop: 14,
    },
    settleBtn: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#25D366',
        paddingHorizontal: 22, paddingVertical: 12,
        borderRadius: 50, marginTop: 18, gap: 6,
    },

    // Transactions
    txList: {
        backgroundColor: C.surface,
        borderRadius: 20, borderWidth: 1,
        borderColor: C.border, overflow: 'hidden',
        marginBottom: 28,
    },
    txRow: {
        flexDirection: 'row', alignItems: 'center',
        gap: 14, paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.04)',
    },
    txIcon: {
        width: 40, height: 40, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },

    // Empty
    emptyWrap: {
        paddingVertical: 40, alignItems: 'center',
        borderWidth: 1, borderColor: C.border,
        borderRadius: 20, borderStyle: 'dashed',
        marginBottom: 28,
    },

    // How it works
    infoCard: {
        backgroundColor: C.surface,
        borderRadius: 20, borderWidth: 1,
        borderColor: C.border, overflow: 'hidden',
    },
    infoRow: {
        flexDirection: 'row', alignItems: 'flex-start',
        gap: 14, padding: 18,
    },
    infoIconWrap: {
        width: 40, height: 40, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
    },
    infoDivider: {
        height: 1, backgroundColor: 'rgba(255,255,255,0.05)',
        marginHorizontal: 16,
    },
});
