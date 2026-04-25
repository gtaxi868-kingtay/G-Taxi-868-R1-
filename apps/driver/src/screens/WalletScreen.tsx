import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Linking, Text, Alert, RefreshControl
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
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import * as ImagePicker from 'expo-image-picker';
import { ENV } from '../../../../shared/env';

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    white: '#FFFFFF',
    textDark: '#1A1A2E',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
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
    const { driver, user } = useAuth();

    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    // Reanimated count-up for balance display
    const balanceAnim = useSharedValue(0);
    const balanceDisplay = useDerivedValue(() =>
        `$${Math.abs(balanceAnim.value).toFixed(2)}`
    );

    const [refreshing, setRefreshing] = useState(false);

    // ── Supabase queries (DO NOT REMOVE) ────────────────────────────────────
    const fetchData = useCallback(async () => {
        if (!driver?.id) return;

        // Balance via RPC
        const { data: balanceCents, error: balanceError } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
        const dollars = (balanceCents || 0) / 100;
        setBalance(dollars);
        balanceAnim.value = withTiming(dollars, { duration: 900 });

        // Transaction ledger rows
        const { data: txs } = await supabase
            .from('payment_ledger')
            .select('id, created_at, amount, status, provider, description, ride_id')
            .eq('user_id', driver.id)
            .order('created_at', { ascending: false })
            .limit(30);
        
        if (balanceError) {
             Alert.alert("Sync Issue", "Failed to retrieve the latest wallet balance. Please pull down to refresh.");
        }
        
        if (txs) setTransactions(txs);
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id, balanceAnim]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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

    const handleCardTopUp = async (amountTtd: number) => {
        try {
            setProcessing(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('No session');

            const response = await fetch(`${ENV.SUPABASE_URL}/functions/v1/create_wallet_topup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ amount_ttd: amountTtd }),
            });

            const { clientSecret, error } = await response.json();
            if (error) throw new Error(error);

            const { error: initError } = await initPaymentSheet({
                paymentIntentClientSecret: clientSecret,
                merchantDisplayName: 'G-Taxi Ltd',
                defaultBillingDetails: { email: user?.email },
            });

            if (initError) throw initError;

            const { error: presentError } = await presentPaymentSheet();
            if (presentError) {
                if (presentError.code !== 'Canceled') {
                    Alert.alert('Payment Error', presentError.message);
                }
                return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Success', 'Wallet topped up successfully!');
            fetchData();
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Payment failed');
        } finally {
            setProcessing(false);
        }
    };

    const handleManualDeposit = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.7,
            });

            if (result.canceled || !result.assets[0]) return;

            setProcessing(true);
            const asset = result.assets[0];
            const fileExt = asset.uri.split('.').pop();
            const fileName = `${driver?.id}/${Date.now()}.${fileExt}`;
            
            // Convert to blob
            const response = await fetch(asset.uri);
            const blob = await response.blob();

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('receipts')
                .upload(fileName, blob);

            if (uploadError) throw uploadError;

            // Log the manual deposit
            const { error: dbError } = await supabase
                .from('manual_deposits')
                .insert({
                    user_id: driver?.id,
                    amount_cents: 0, // Admin will verify amount
                    receipt_url: uploadData.path,
                    status: 'pending'
                });

            if (dbError) throw dbError;

            Alert.alert('Success', 'Receipt uploaded! Admin will verify and credit your wallet shortly.');
            fetchData();
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Upload failed');
        } finally {
            setProcessing(false);
        }
    };

    const handleSettlePress = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            "Settle Balance",
            "How would you like to top up your wallet?",
            [
                { text: "$100 Top Up (Card)", onPress: () => handleCardTopUp(100) },
                { text: "Upload Bank Receipt", onPress: handleManualDeposit },
                { text: "Contact Support (WA)", onPress: () => Linking.openURL('https://wa.me/18687031000?text=I need to settle my G-Taxi commission balance.') },
                { text: "Cancel", style: "cancel" }
            ]
        );
    };

    const isOwed = balance !== null && balance < 0;
    const isGood = balance !== null && balance >= 0;

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={COLORS.purple} size="large" />
            </View>
        );
    }

    // Color scheme based on balance direction
    const heroGradient: readonly [string, string] = isOwed
        ? ['#FFFFFF', '#FFECEC']
        : ['#FFFFFF', '#E8F5E9'];
    const heroBorderColor = isOwed
        ? 'rgba(239,68,68,0.25)'
        : 'rgba(16,185,129,0.25)';
    const heroStatusColor = isOwed ? COLORS.error : COLORS.success;
    const heroStatusLabel = isOwed
        ? `You owe the platform TTD ${(Math.abs(balance || 0) * 0.19 / 0.81).toFixed(0)} (19% cut)`
        : 'Balance all clear ✓';

    return (
        <View style={s.root}>
            {/* ── HEADER — BlurView ─────────────────────────────────────── */}
            <BlurView tint="light" intensity={80} style={[s.headerBlur, { paddingTop: insets.top + 8 }]}>
                <LinearGradient
                    colors={['rgba(255,255,255,0.95)', 'rgba(245,245,247,0.6)']}
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
                        <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
                    </TouchableOpacity>

                    <Text style={{fontSize: 20, fontWeight: '700', color: COLORS.textDark}}>Wallet</Text>

                    {/* Spacer — same width as back button for visual centering */}
                    <View style={s.backBtn} pointerEvents="none" />
                </LinearGradient>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} colors={[COLORS.purple]} />
                }
            >
                {/* ── HERO BALANCE CARD ─────────────────────────────────── */}
                <LinearGradient
                    colors={heroGradient}
                    style={[s.heroCard, { borderColor: heroBorderColor }]}
                >
                    <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 6 }}>
                        TTD COMMISSION BALANCE
                    </Text>

                    {/* Animated balance — 48px gold */}
                    <Reanimated.Text style={[s.balanceNum, { color: isOwed ? COLORS.error : COLORS.purple }]}>
                        {isOwed ? '-' : ''}{balanceDisplay.value}
                    </Reanimated.Text>

                    <Text style={{fontSize: 10, color: heroStatusColor, marginTop: 6, fontWeight: '600' }}>
                        {heroStatusLabel}
                    </Text>

                    {/* Lockout warning */}
                    {isOwed && (balance || 0) <= -600 && (
                        <View style={s.lockBadge}>
                            <Ionicons name="lock-closed" size={14} color={COLORS.textDark} />
                            <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textDark, marginLeft: 6 }}>
                                ACCOUNT RESTRICTED — CAP REACHED
                            </Text>
                        </View>
                    )}

                    {/* Settle button */}
                    {isOwed && (
                        <TouchableOpacity
                            style={s.settleBtn}
                            onPress={handleSettlePress}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="logo-whatsapp" size={16} color={COLORS.textDark} />
                            <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginLeft: 8 }}>
                                Settle Balance via Transfer
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Payout button */}
                    {isGood && balance > 0 && (
                        <TouchableOpacity
                            style={[s.settleBtn, { backgroundColor: COLORS.purple }]}
                            onPress={handlePayoutRequest}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="cash-outline" size={16} color={COLORS.textDark} />
                            <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginLeft: 8 }}>
                                Request Payout
                            </Text>
                        </TouchableOpacity>
                    )}
                </LinearGradient>

                {/* ── TRANSACTION HISTORY ───────────────────────────────── */}
                <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 12 }}>
                    TRANSACTION HISTORY
                </Text>

                {transactions.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={36} color={COLORS.textMuted} />
                        <Text style={{fontSize: 14, color: COLORS.textMuted, marginTop: 12, textAlign: 'center' }}>
                            No transactions yet.
                        </Text>
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
                            const txColor = isCredit ? COLORS.success : COLORS.error;
                            const txBg = isCredit ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

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
                                        <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.textDark}} numberOfLines={1}>
                                            {tx.description || (isCredit ? 'Commission Credit' : 'Commission Debit')}
                                        </Text>
                                        <Text style={{fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>
                                            {dateStr} · {timeStr}
                                        </Text>
                                    </View>

                                    {/* Amount */}
                                    <Text style={{fontSize: 14, fontWeight: '700', color: txColor}}>
                                        {isCredit ? '+' : '-'}${amount}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                {/* ── HOW IT WORKS ──────────────────────────────────────── */}
                <Text style={{fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1, marginTop: 28, marginBottom: 12 }}>
                    HOW IT WORKS
                </Text>

                <View style={s.infoCard}>
                    {INFO_ROWS.map((row, i) => (
                        <View key={row.title}>
                            <View style={s.infoRow}>
                                <View style={[s.infoIconWrap, { backgroundColor: `${row.color}18` }]}>
                                    <Ionicons name={row.icon} size={20} color={row.color} />
                                </View>
                                <View style={{ flex: 1, gap: 3 }}>
                                    <Text style={{fontSize: 14, fontWeight: '700', color: COLORS.textDark}}>{row.title}</Text>
                                    <Text style={{fontSize: 10, color: COLORS.textMuted}}>{row.body}</Text>
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
    root: { flex: 1, backgroundColor: COLORS.bgSecondary },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    // Header
    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, borderBottomWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
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
        backgroundColor: COLORS.error,
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
        backgroundColor: 'rgba(26, 21, 48, 0.8)',
        borderRadius: 20, borderWidth: 1,
        borderColor: 'rgba(255,215,0,0.2)', overflow: 'hidden',
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
        borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
        borderRadius: 20, borderStyle: 'dashed',
        marginBottom: 28,
    },

    // How it works
    infoCard: {
        backgroundColor: 'rgba(26, 21, 48, 0.8)',
        borderRadius: 20, borderWidth: 1,
        borderColor: 'rgba(255,215,0,0.2)', overflow: 'hidden',
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
