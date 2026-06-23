import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Linking, Text, Alert, RefreshControl,
    Modal, TextInput, KeyboardAvoidingView, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Reanimated, {
    useSharedValue, withTiming, useDerivedValue,
} from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import * as ImagePicker from 'expo-image-picker';
import { ENV } from '@gtaxi/shared/env';
import { LinearGradient } from 'expo-linear-gradient';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { elevationGlow, ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

interface Transaction {
    id: string;
    created_at: string;
    amount: number;
    status: string;
    provider: string;
    description: string | null;
    ride_id: string | null;
}

const INFO_ROWS = [
    {
        icon: 'cash-outline' as const,
        color: '#10B981',
        title: 'Cash Trips',
        body: 'You collect & keep all cash. G-Taxi debits our 15% + 3% reserve from this ledger.',
    },
    {
        icon: 'card-outline' as const,
        color: VOICES.driver.accent,
        title: 'Card / Wallet Trips',
        body: 'We collect the payment. Your 82% share is credited to this ledger.',
    },
    {
        icon: 'lock-closed-outline' as const,
        color: '#EF4444',
        title: 'The $600 Cap',
        body: 'If your balance hits -$600 TTD you cannot accept new rides until you settle.',
    },
];

export function WalletScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void; goBack: () => void } }) {
    const insets = useSafeAreaInsets();
    const { driver, user } = useAuth();

    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    const balanceAnim = useSharedValue(0);
    const balanceDisplay = useDerivedValue(() =>
        `$${Math.abs(balanceAnim.value).toFixed(2)}`
    );

    const [refreshing, setRefreshing] = useState(false);

    const [bankModalVisible, setBankModalVisible] = useState(false);
    const [bankName, setBankName] = useState('');
    const [accountHolder, setAccountHolder] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [savingBank, setSavingBank] = useState(false);
    const [hasBankDetails, setHasBankDetails] = useState(false);

    const fetchData = useCallback(async () => {
        if (!driver?.id) return;

        const { data: driverRow } = await supabase
            .from('drivers')
            .select('bank_details')
            .eq('id', driver.id)
            .single();
        const bank = driverRow?.bank_details;
        if (bank?.bank_name && bank?.account_number) {
            setHasBankDetails(true);
            setBankName(bank.bank_name);
            setAccountHolder(bank.account_holder || '');
            setAccountNumber(bank.account_number);
        }

        const { data: balanceCents, error: balanceError } = await supabase.rpc('get_wallet_balance', { p_user_id: driver.id });
        const dollars = (balanceCents || 0) / 100;
        setBalance(dollars);
        balanceAnim.value = withTiming(dollars, { duration: 900 });

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

    const handleSaveBankDetails = async () => {
        if (!driver?.id) return;
        if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
            Alert.alert("Incomplete", "Please fill in bank name, account holder and account number.");
            return;
        }
        setSavingBank(true);
        const { error } = await supabase
            .from('drivers')
            .update({
                bank_details: {
                    bank_name: bankName.trim(),
                    account_holder: accountHolder.trim(),
                    account_number: accountNumber.trim(),
                },
            })
            .eq('id', driver.id);
        setSavingBank(false);

        if (error) {
            Alert.alert("Error", "Could not save bank details. Please try again.");
        } else {
            setHasBankDetails(true);
            setBankModalVisible(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Saved", "Bank details saved. You can now request payouts.");
        }
    };

    const handlePayoutRequest = async () => {
        if (!balance || balance <= 0) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        if (!hasBankDetails) {
            setBankModalVisible(true);
            return;
        }

        Alert.alert(
            "Request Payout",
            `Would you like to request a payout of $${balance.toFixed(2)} TTD to ${bankName} ····${accountNumber.slice(-4)}?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Request",
                    onPress: async () => {
                        const { data, error } = await supabase.functions.invoke('request_payout', {
                            body: { amount_cents: Math.round(balance * 100) },
                        });

                        if (error || data?.error) {
                            const message = data?.error
                                || (error as { context?: { json?: { error?: string } } })?.context?.json?.error
                                || "Could not submit payout request. Please try again.";
                            Alert.alert("Payout Failed", message);
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
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Payment failed';
            Alert.alert('Error', message);
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
            
            const response = await fetch(asset.uri);
            const blob = await response.blob();

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('receipts')
                .upload(fileName, blob);

            if (uploadError) throw uploadError;

            const receiptPath = uploadData.path;
            const receiptUrl = supabase.storage.from('receipts').getPublicUrl(receiptPath).data.publicUrl;

            // Phase 4: OCR parse the receipt
            let parsedAmount = 0;
            let referenceToken: string | null = null;
            try {
                const { data: ocrData } = await supabase.functions.invoke('parse_receipt', {
                    body: { photo_url: receiptPath },
                });
                if (ocrData?.success && ocrData?.data?.amount_cents) {
                    parsedAmount = ocrData.data.amount_cents;
                }
                if (ocrData?.success && ocrData?.data?.reference_token) {
                    referenceToken = ocrData.data.reference_token;
                }
            } catch {
                // OCR is best-effort; fall back to manual admin review
            }

            // Duplicate-transaction guard: never let the same bank/ATM reference
            // be submitted (and later credited) twice.
            if (referenceToken) {
                const { data: dupe } = await supabase
                    .from('manual_deposits')
                    .select('id')
                    .eq('reference_token', referenceToken)
                    .maybeSingle();
                if (dupe) {
                    Alert.alert('Already Submitted', 'This receipt (transaction ' + referenceToken + ') has already been submitted. It cannot be credited twice.');
                    return;
                }
            }

            const { error: dbError } = await supabase
                .from('manual_deposits')
                .insert({
                    user_id: driver?.id,
                    amount_cents: parsedAmount,
                    receipt_url: receiptPath,
                    reference_token: referenceToken,
                    status: 'pending'
                });

            if (dbError) {
                // 23505 = unique violation on reference_token (race with another upload)
                if ((dbError as any).code === '23505') {
                    Alert.alert('Already Submitted', 'This receipt has already been submitted. It cannot be credited twice.');
                    return;
                }
                throw dbError;
            }

            const msg = parsedAmount > 0
                ? `Receipt uploaded! Amount detected: TTD ${(parsedAmount / 100).toFixed(2)}. Admin will verify shortly.`
                : 'Receipt uploaded! Admin will verify and credit your wallet shortly.';
            Alert.alert('Success', msg);
            fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            Alert.alert('Error', message);
        } finally {
            setProcessing(false);
        }
    };

    const handleSmartAtmDeposit = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.7,
            });
            if (result.canceled || !result.assets[0]) return;

            setProcessing(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('No session');

            const amountCents = Math.round(Math.abs(balance || 0) * 100);

            const asset = result.assets[0];
            const fileExt = asset.uri.split('.').pop();
            const fileName = `settlements/${driver?.id}/${Date.now()}.${fileExt}`;

            const imgRes = await fetch(asset.uri);
            const blob = await imgRes.blob();
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('receipts')
                .upload(fileName, blob);
            if (uploadError) throw uploadError;

            const receiptPath = fileName;
            const receiptUrl = supabase.storage.from('receipts').getPublicUrl(receiptPath).data.publicUrl;

            // Phase 4: OCR parse the receipt to auto-detect amount + transaction id
            let parsedAmount = amountCents;
            let referenceToken: string | null = null;
            try {
                const { data: ocrData } = await supabase.functions.invoke('parse_receipt', {
                    body: { photo_url: receiptPath },
                });
                if (ocrData?.success && ocrData?.data?.amount_cents) {
                    parsedAmount = ocrData.data.amount_cents;
                }
                if (ocrData?.success && ocrData?.data?.reference_token) {
                    referenceToken = ocrData.data.reference_token;
                }
            } catch {
                // OCR is best-effort; fall back to wallet-based amount
            }

            const position = await Location.getCurrentPositionAsync({});
            const deposit_lat = position?.coords?.latitude;
            const deposit_lng = position?.coords?.longitude;

            const { data: settleData, error: settleErr } = await supabase.functions.invoke('submit_settlement', {
                body: {
                    amount_cents: parsedAmount,
                    method: 'smart_atm',
                    reference_token: referenceToken,
                    receipt_photo_url: receiptUrl,
                    deposit_lat,
                    deposit_lng,
                },
            });

            if (settleErr || !settleData?.success) {
                const dupHit = /duplicate|already|23505|reference/i.test(settleData?.error || settleErr?.message || '');
                throw new Error(dupHit
                    ? 'This receipt has already been submitted. It cannot be credited twice.'
                    : (settleData?.error || settleErr?.message || 'Settlement submission failed'));
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const parsedMsg = parsedAmount !== amountCents
                ? ` (OCR detected TTD ${(parsedAmount / 100).toFixed(2)})`
                : '';
            Alert.alert('Submitted', `ATM deposit submitted${parsedMsg}! Admin will verify and credit your wallet shortly.`);
            fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Submission failed';
            Alert.alert('Error', message);
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
                { text: "Smart ATM Deposit", onPress: handleSmartAtmDeposit },
                { text: "Upload Bank Receipt", onPress: handleManualDeposit },
                { text: "Contact Support (WA)", onPress: () => Linking.openURL('https://wa.me/18687031000?text=I need to settle my G-Taxi commission balance.') },
                { text: "Cancel", style: "cancel" }
            ]
        );
    };

    const isOwed = balance !== null && balance < 0;
    const isGood = balance !== null && balance >= 0;

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator color={VOICES.driver.accent} size="large" />
            </View>
        );
    }

    const heroGradient: readonly [string, string] = isOwed
        ? [SURFACE.base, '#2A0A0A']
        : [SURFACE.base, '#0A2A1A'];
    const heroStatusColor = isOwed ? '#FF4D4D' : '#10B981';
    const heroStatusLabel = isOwed
        ? `You owe the platform TTD ${(Math.abs(balance || 0) * 0.18 / 0.82).toFixed(0)} (18% platform + reserve)`
        : 'Balance all clear ✓';

    return (
        <View style={s.root}>
            <BlurView tint="dark" intensity={80} style={[s.headerBlur, { paddingTop: insets.top + 8 }, glassSurface(80, 0.2)]}>
                <View style={s.headerInner}>
                    <TouchableOpacity
                        style={s.backBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.goBack();
                        }}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="chevron-back" size={22} color="#FFF" />
                    </TouchableOpacity>

                    <Text style={{fontSize: 20, fontWeight: '700', color: '#FFF'}}>Wallet</Text>

                    <View style={s.backBtn} pointerEvents="none" />
                </View>
            </BlurView>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingTop: insets.top + 64 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={VOICES.driver.accent} colors={[VOICES.driver.accent]} />
                }
            >
                <LinearGradient
                    colors={heroGradient}
                    style={[s.heroCard, elevationGlow(0.12)]}
                >
                    <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginBottom: 6 }}>
                        Commission balance
                    </Text>

                    <Reanimated.Text style={[s.balanceNum, { color: isOwed ? '#FF4D4D' : VOICES.driver.accent }]}>
                        {isOwed ? '-' : ''}{balanceDisplay.value}
                    </Reanimated.Text>

                    <Text style={{fontSize: 10, color: heroStatusColor, marginTop: 6, fontWeight: '600' }}>
                        {heroStatusLabel}
                    </Text>

                    {isOwed && (balance || 0) <= -600 && (
                        <View style={s.lockBadge}>
                            <Ionicons name="lock-closed" size={14} color="#FFF" />
                            <Text style={{fontSize: 11, fontWeight: '700', color: '#FFF', marginLeft: 6 }}>
                                ACCOUNT RESTRICTED — CAP REACHED
                            </Text>
                        </View>
                    )}

                    {isOwed && (
                        <TouchableOpacity
                            style={s.settleBtn}
                            onPress={handleSettlePress}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="logo-whatsapp" size={16} color="#FFF" />
                            <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF', marginLeft: 8 }}>
                                Settle Balance via Transfer
                            </Text>
                        </TouchableOpacity>
                    )}

                    {isGood && balance > 0 && (
                        <TouchableOpacity
                            style={[s.settleBtn, { backgroundColor: VOICES.driver.accent }]}
                            onPress={handlePayoutRequest}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="cash-outline" size={16} color={SURFACE.base} />
                            <Text style={{fontSize: 14, fontWeight: '700', color: SURFACE.base, marginLeft: 8 }}>
                                Request Payout
                            </Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={s.bankLink}
                        onPress={() => setBankModalVisible(true)}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="business-outline" size={14} color="rgba(255,255,255,0.7)" />
                        <Text style={s.bankLinkText}>
                            {hasBankDetails
                                ? `Payout account: ${bankName} ····${accountNumber.slice(-4)}`
                                : 'Add bank details for payouts'}
                        </Text>
                    </TouchableOpacity>
                </LinearGradient>

                <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginBottom: 12 }}>
                    TRANSACTION HISTORY
                </Text>

                {transactions.length === 0 ? (
                    <View style={s.emptyWrap}>
                        <Ionicons name="receipt-outline" size={36} color="rgba(255,255,255,0.6)" />
                        <Text style={{fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 12, textAlign: 'center' }}>
                            No transactions yet.
                        </Text>
                    </View>
                ) : (
                    <View style={s.txList}>
                        {transactions.map((tx, idx) => {
                            const isCredit = tx.amount >= 0;
                            const amount = (Math.abs(tx.amount) / 100).toFixed(2);
                            const date = new Date(tx.created_at);
                            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const isLast = idx === transactions.length - 1;

                            const txIcon = isCredit ? 'arrow-down-outline' : 'arrow-up-outline';
                            const txColor = isCredit ? '#10B981' : '#FF4D4D';
                            const txBg = isCredit ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';

                            return (
                                <TouchableOpacity
                                    key={tx.id}
                                    style={[s.txRow, isLast && { borderBottomWidth: 0 }]}
                                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                                    activeOpacity={0.75}
                                >
                                    <View style={[s.txIcon, { backgroundColor: txBg }]}>
                                        <Ionicons name={txIcon as 'arrow-down-outline' | 'arrow-up-outline'} size={18} color={txColor} />
                                    </View>

                                    <View style={{ flex: 1 }}>
                                        <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}} numberOfLines={1}>
                                            {tx.description || (isCredit ? 'Commission Credit' : 'Commission Debit')}
                                        </Text>
                                        <Text style={{fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
                                            {dateStr} · {timeStr}
                                        </Text>
                                    </View>

                                    <Text style={{fontSize: 14, fontWeight: '700', color: txColor}}>
                                        {isCredit ? '+' : '-'}${amount}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                <Text style={{fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1, marginTop: 28, marginBottom: 12 }}>
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
                                    <Text style={{fontSize: 14, fontWeight: '700', color: '#FFF'}}>{row.title}</Text>
                                    <Text style={{fontSize: 10, color: 'rgba(255,255,255,0.6)'}}>{row.body}</Text>
                                </View>
                            </View>
                            {i < INFO_ROWS.length - 1 && <View style={s.infoDivider} />}
                        </View>
                    ))}
                </View>

                <View style={{ height: insets.bottom + 32 }} />
            </ScrollView>

            <Modal
                visible={bankModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setBankModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={s.modalOverlay}
                >
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>Payout Bank Account</Text>
                        <Text style={s.modalSubtitle}>
                            Local T&T bank transfers. Payouts are sent to this account after admin approval.
                        </Text>

                        <TextInput
                            style={s.modalInput}
                            placeholder="Bank name (e.g. Republic Bank)"
                            placeholderTextColor="rgba(255,255,255,0.4)"
                            value={bankName}
                            onChangeText={setBankName}
                        />
                        <TextInput
                            style={s.modalInput}
                            placeholder="Account holder name"
                            placeholderTextColor="rgba(255,255,255,0.4)"
                            value={accountHolder}
                            onChangeText={setAccountHolder}
                        />
                        <TextInput
                            style={s.modalInput}
                            placeholder="Account number"
                            placeholderTextColor="rgba(255,255,255,0.4)"
                            value={accountNumber}
                            onChangeText={setAccountNumber}
                            keyboardType="number-pad"
                        />

                        <TouchableOpacity
                            style={[s.settleBtn, { backgroundColor: VOICES.driver.accent, marginTop: 16 }]}
                            onPress={handleSaveBankDetails}
                            disabled={savingBank}
                            activeOpacity={0.85}
                        >
                            {savingBank ? (
                                <ActivityIndicator size="small" color={SURFACE.base} />
                            ) : (
                                <Text style={{ fontSize: 14, fontWeight: '700', color: SURFACE.base }}>
                                    Save Bank Details
                                </Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={{ alignItems: 'center', paddingVertical: 14 }}
                            onPress={() => setBankModalVisible(false)}
                        >
                            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20 },

    headerBlur: {
        position: 'absolute', top: 0, left: 0, right: 0,
        zIndex: 20, ...ghostBorder(0.15),
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

    heroCard: {
        borderRadius: 24, padding: 24,
        alignItems: 'center',
        marginBottom: 28,
    },
    balanceNum: {
        fontSize: 48, fontWeight: '800',
        letterSpacing: -1,
    },
    lockBadge: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#FF4D4D',
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20, marginTop: 14,
    },
    settleBtn: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#25D366',
        paddingHorizontal: 22, paddingVertical: 12,
        borderRadius: 50, marginTop: 18, gap: 6,
    },

    bankLink: {
        flexDirection: 'row', alignItems: 'center',
        marginTop: 14, gap: 6,
    },
    bankLinkText: {
        fontSize: 12, fontWeight: '600',
        color: 'rgba(255,255,255,0.7)',
        textDecorationLine: 'underline',
    },

    modalOverlay: {
        flex: 1, justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalCard: {
        backgroundColor: SURFACE.containerLow,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: 24, paddingBottom: 40,
        ...ghostBorder(0.15),
    },
    modalTitle: {
        fontSize: 18, fontWeight: '800', color: '#FFF',
        marginBottom: 6,
    },
    modalSubtitle: {
        fontSize: 13, color: 'rgba(255,255,255,0.6)',
        marginBottom: 18, lineHeight: 18,
    },
    modalInput: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
        fontSize: 15, color: '#FFF', marginBottom: 12,
        ...ghostBorder(0.12),
    },

    txList: {
        backgroundColor: SURFACE.containerLow,
        borderRadius: 20, ...ghostBorder(0.15), overflow: 'hidden',
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

    emptyWrap: {
        paddingVertical: 40, alignItems: 'center',
        ...ghostBorder(0.15),
        borderRadius: 20, borderStyle: 'dashed',
        marginBottom: 28,
    },

    infoCard: {
        backgroundColor: SURFACE.containerLow,
        borderRadius: 20, ...ghostBorder(0.15), overflow: 'hidden',
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
