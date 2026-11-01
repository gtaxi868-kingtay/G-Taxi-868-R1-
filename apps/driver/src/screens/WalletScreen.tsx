import React, { useEffect, useState, useCallback } from 'react';
import {
    View, StyleSheet, Linking, Text, Alert, RefreshControl,
    Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { photoBytes } from '../utils/driverSignup';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import * as ImagePicker from 'expo-image-picker';
import { ENV } from '@g868/shared/env';
import { Screen, Txt, Card, Section, Row, Pop, Button, Field, EmptyState, Loading, FONT, SPACE, useTheme, IconName } from '../ui/kit';
import { DRIVE_COLORS, ttd } from '../theme/drive';

interface Transaction {
    id: string;
    created_at: string;
    amount: number;
    status: string;
    transaction_type: string;
    description: string | null;
    ride_id: string | null;
}

// Plain explanation of the ledger. The platform has no fixed percentage (it
// keeps what is left after driver, G-Lead, reserve and shop are paid), so
// never state one here.
const INFO_ROWS: { icon: IconName; color: string; title: string; body: string }[] = [
    {
        icon: 'cash-outline',
        color: DRIVE_COLORS.money,
        title: 'Cash trips',
        body: 'You keep the cash. G868\'s part of the fare (including the 1.5% safety reserve) is recorded here as money you owe.',
    },
    {
        icon: 'card-outline',
        color: DRIVE_COLORS.cyan,
        title: 'Card and wallet trips',
        body: 'The rider pays in the app. Your share (80% of the fare, 78% if you joined through a G-Lead) is credited here.',
    },
    {
        icon: 'lock-closed-outline',
        color: DRIVE_COLORS.danger,
        title: 'The -TT$600 limit',
        body: 'If you owe more than TT$600 you cannot go online until you settle.',
    },
];

export function WalletScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void; goBack: () => void } }) {
    const m = useTheme();
    const { driver, user } = useAuth();

    const { initPaymentSheet, presentPaymentSheet } = useStripe();
    const [balance, setBalance] = useState<number | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    const [loadError, setLoadError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const [bankModalVisible, setBankModalVisible] = useState(false);
    const [bankName, setBankName] = useState('');
    const [accountHolder, setAccountHolder] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [savingBank, setSavingBank] = useState(false);
    const [hasBankDetails, setHasBankDetails] = useState(false);

    const fetchData = useCallback(async () => {
        if (!driver?.id || !user?.id) {
            setLoading(false);
            setRefreshing(false);
            return;
        }

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

        // get_wallet_balance enforces p_user_id === auth.uid() — the driver's
        // AUTH id, not drivers.id (the row's own primary key). Money is
        // credited to the driver's auth id (drivers.user_id) throughout the
        // settlement engine, so reads must use the same key.
        const { data: balanceCents, error: balanceError } = await supabase.rpc('get_wallet_balance', { p_user_id: user.id });
        const dollars = (balanceCents || 0) / 100;
        if (!balanceError) setBalance(dollars);

        // Driver earnings live in wallet_transactions (Sum(amount) = truth),
        // not payment_ledger — that table only records what RIDERS paid in.
        const { data: txs } = await supabase
            .from('wallet_transactions')
            .select('id, created_at, amount, status, transaction_type, description, ride_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(30);

        setLoadError(!!balanceError);

        if (txs) setTransactions(txs);
        setLoading(false);
        setRefreshing(false);
    }, [driver?.id, user?.id]);

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

    // Both "Upload Bank Receipt" and "Smart ATM Deposit" land in
    // manual_deposits: the queue admin Financials actually reviews. The
    // receipt stays in the private receipts bucket under the driver's own
    // folder; admin opens it with a signed link. A bank/ATM reference can
    // only be claimed once (unique in the database).
    const submitDepositReceipt = async (kind: 'bank' | 'atm') => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.7,
                base64: true,
            });
            if (result.canceled || !result.assets[0]) return;

            setProcessing(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Please sign in again.');
            const uid = session.user.id;

            const asset = result.assets[0];
            if (!asset.base64) throw new Error('That photo could not be read. Please choose it again.');
            const mime = asset.mimeType || 'image/jpeg';
            const fileExt = mime.split('/')[1] === 'png' ? 'png' : 'jpg';
            const receiptPath = `${uid}/${kind}-${Date.now()}.${fileExt}`;

            // base64 bytes, not fetch(uri).blob(): the blob read fails on
            // many Android phones.
            const { error: uploadError } = await supabase.storage
                .from('receipts')
                .upload(receiptPath, photoBytes(asset.base64), { contentType: mime });
            if (uploadError) throw uploadError;

            // OCR is best-effort; admin checks the photo either way.
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
                // fall through to the owed balance below
            }

            const owedCents = balance !== null && balance < 0 ? Math.round(Math.abs(balance) * 100) : 0;
            const claimCents = parsedAmount > 0 ? parsedAmount : owedCents;
            if (claimCents <= 0) {
                Alert.alert(
                    'Could not read the amount',
                    'We could not read the amount on this receipt. Please contact support on WhatsApp and we will credit it by hand.'
                );
                return;
            }

            const { error: dbError } = await supabase
                .from('manual_deposits')
                .insert({
                    user_id: uid,
                    amount_cents: claimCents,
                    receipt_url: receiptPath,
                    reference_token: referenceToken,
                });

            if (dbError) {
                // 23505 = this bank/ATM reference was already submitted
                if ((dbError as any).code === '23505') {
                    Alert.alert('Already Submitted', 'This receipt has already been submitted. It cannot be credited twice.');
                    return;
                }
                throw dbError;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const msg = parsedAmount > 0
                ? `Receipt sent! Amount read: TTD ${(parsedAmount / 100).toFixed(2)}. Admin will verify and credit your wallet.`
                : `Receipt sent for TTD ${(claimCents / 100).toFixed(2)} (your balance owed). Admin will verify and credit your wallet.`;
            Alert.alert('Submitted', msg);
            fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            Alert.alert('Error', message);
        } finally {
            setProcessing(false);
        }
    };

    const handleManualDeposit = () => submitDepositReceipt('bank');
    const handleSmartAtmDeposit = () => submitDepositReceipt('atm');

    const handleSettlePress = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            "Settle what you owe",
            "How did you pay? Send the receipt and we credit your wallet after a quick check.",
            // Card top-up (handleCardTopUp) is hidden: Stripe has no keys
            // and does not serve Trinidad and Tobago businesses, so it can
            // only fail. Put it back here once a card processor is live.
            [
                { text: "Smart ATM deposit", onPress: handleSmartAtmDeposit },
                { text: "Upload bank receipt", onPress: handleManualDeposit },
                { text: "WhatsApp support", onPress: () => Linking.openURL('https://wa.me/18687031000?text=I need to settle my G-Taxi commission balance.') },
                { text: "Cancel", style: "cancel" }
            ]
        );
    };

    const isOwed = balance !== null && balance < 0;
    const isLocked = isOwed && (balance || 0) <= -600;
    const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={m.accent} colors={[m.accent]} />;

    if (loading) return <Screen title="Wallet"><Loading /></Screen>;

    const tone = balance === null ? m.dim : isOwed ? DRIVE_COLORS.danger : DRIVE_COLORS.online;

    return (
        <Screen title="Wallet" refreshControl={refresh}>
            {loadError ? (
                <Txt variant="caption" tone="danger" style={{ marginBottom: SPACE.md }}>
                    Couldn't load your latest balance. Pull down to try again.
                </Txt>
            ) : null}

            <Pop>
                <Card style={[st.hero, { borderColor: `${tone}66` }]}>
                    <Txt variant="overline" tone="faint">{isOwed ? 'YOU OWE G868' : 'YOUR BALANCE'}</Txt>
                    <Text style={[st.big, { color: tone }]} numberOfLines={1} adjustsFontSizeToFit>
                        {balance === null ? '—' : ttd(Math.round(Math.abs(balance) * 100))}
                    </Text>
                    <Txt tone="dim" style={{ textAlign: 'center' }}>
                        {balance === null ? 'Balance unavailable right now'
                            : isLocked ? 'Over the TT$600 limit. Settle to go online again.'
                            : isOwed ? 'From cash trips. Settle any time; the limit is TT$600.'
                            : balance > 0 ? 'Yours to cash out.' : 'All clear. Nothing owed.'}
                    </Txt>
                    {isLocked ? (
                        <View style={st.lock}>
                            <Ionicons name="lock-closed" size={14} color="#FFFFFF" />
                            <Txt variant="label" style={{ color: '#FFFFFF', marginLeft: 6 }}>Can't go online until settled</Txt>
                        </View>
                    ) : null}
                    <View style={{ alignSelf: 'stretch', marginTop: SPACE.lg }}>
                        {isOwed ? (
                            <Button title="Settle what I owe" icon="checkmark-done" color={DRIVE_COLORS.online} onPress={handleSettlePress} loading={processing} />
                        ) : balance !== null && balance > 0 ? (
                            <Button title="Cash out to my bank" icon="arrow-down-circle" color={DRIVE_COLORS.online} onPress={handlePayoutRequest} />
                        ) : null}
                    </View>
                </Card>
            </Pop>

            <Section title="Get cash">
                <Card style={{ paddingVertical: 0 }}>
                    <Row icon="business-outline" title={hasBankDetails ? `${bankName} ····${accountNumber.slice(-4)}` : 'Add your bank account'}
                        subtitle={hasBankDetails ? 'Where your payouts go. Tap to change.' : 'Needed before you can cash out'}
                        onPress={() => setBankModalVisible(true)} />
                    <Row icon="cash-outline" title="Cash withdrawal" subtitle="Cardless cash via Republic Bank SMS" onPress={() => navigation.navigate('CashWithdrawal')} />
                    <Row icon="key-outline" title="Redeem a cash code" subtitle="A code a rider gave you" onPress={() => navigation.navigate('RedeemCashCode')} last />
                </Card>
            </Section>

            <Section title="History">
                {transactions.length === 0 ? (
                    <EmptyState icon="receipt-outline" title="Nothing here yet" body="Each trip's pay, and anything you owe or settle, shows up here." />
                ) : (
                    <Card style={{ paddingVertical: 0 }}>
                        {transactions.map((tx, idx) => {
                            const isCredit = tx.amount >= 0;
                            const when = new Date(tx.created_at).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
                            return (
                                <View key={tx.id} style={[st.tx, { borderBottomColor: m.chipBorder, borderBottomWidth: idx === transactions.length - 1 ? 0 : 1 }]}>
                                    <View style={[st.txIcon, { backgroundColor: isCredit ? 'rgba(47,208,138,0.14)' : 'rgba(255,90,95,0.14)' }]}>
                                        <Ionicons name={isCredit ? 'arrow-down' : 'arrow-up'} size={16} color={isCredit ? DRIVE_COLORS.online : DRIVE_COLORS.danger} />
                                    </View>
                                    <View style={{ flex: 1, marginHorizontal: SPACE.md }}>
                                        <Txt variant="bodyStrong" numberOfLines={1}>{tx.description || (isCredit ? 'Money in' : 'Money out')}</Txt>
                                        <Txt variant="caption" tone="faint">{when}{tx.status && tx.status !== 'completed' ? ` · ${tx.status}` : ''}</Txt>
                                    </View>
                                    <Txt variant="bodyStrong" style={{ color: isCredit ? DRIVE_COLORS.online : DRIVE_COLORS.danger }}>
                                        {isCredit ? '+' : '−'}{ttd(Math.abs(tx.amount))}
                                    </Txt>
                                </View>
                            );
                        })}
                    </Card>
                )}
            </Section>

            <Section title="How it works">
                <Card>
                    {INFO_ROWS.map((row, i) => (
                        <View key={row.title} style={[st.info, i > 0 && { marginTop: SPACE.lg }]}>
                            <View style={[st.txIcon, { backgroundColor: `${row.color}22` }]}>
                                <Ionicons name={row.icon} size={18} color={row.color} />
                            </View>
                            <View style={{ flex: 1, marginLeft: SPACE.md }}>
                                <Txt variant="bodyStrong">{row.title}</Txt>
                                <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>{row.body}</Txt>
                            </View>
                        </View>
                    ))}
                </Card>
            </Section>

            <Modal visible={bankModalVisible} transparent animationType="slide" onRequestClose={() => setBankModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.overlay}>
                    <View style={[st.sheet, { backgroundColor: m.tile, borderColor: m.chipBorder }]}>
                        <Txt variant="title">Payout bank account</Txt>
                        <Txt tone="dim" style={{ marginTop: 4, marginBottom: SPACE.lg }}>
                            A local T&T bank. Payouts go here after a quick check by G868.
                        </Txt>
                        <Field label="Bank" placeholder="e.g. Republic Bank" value={bankName} onChangeText={setBankName} />
                        <Field label="Name on the account" value={accountHolder} onChangeText={setAccountHolder} />
                        <Field label="Account number" value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" />
                        <Button title="Save bank account" color={DRIVE_COLORS.online} onPress={handleSaveBankDetails} loading={savingBank} />
                        <Button title="Cancel" variant="ghost" onPress={() => setBankModalVisible(false)} style={{ marginTop: SPACE.sm }} />
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </Screen>
    );
}

const st = StyleSheet.create({
    hero: { alignItems: 'center', borderWidth: 2 },
    big: { fontFamily: FONT.roundBlack, fontSize: 48, lineHeight: 56, marginVertical: SPACE.xs, fontVariant: ['tabular-nums'] },
    lock: { flexDirection: 'row', alignItems: 'center', backgroundColor: DRIVE_COLORS.danger, height: 30, paddingHorizontal: 12, borderRadius: 15, marginTop: SPACE.md },
    tx: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.md },
    txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    info: { flexDirection: 'row', alignItems: 'flex-start' },
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,9,13,0.7)' },
    sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 2, borderBottomWidth: 0, padding: SPACE.xl, paddingBottom: 36 },
});
