import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, Dimensions, ScrollView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';
import { ENV } from '../../../../shared/env';

const { width } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    gold: '#F59E0B',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function WalletTopUpScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const stripe = isExpoGo ? null : useStripe();

    const [balance, setBalance] = useState<number | null>(null);
    const [selectedAmount, setSelectedAmount] = useState<number>(100);
    const [customAmount, setCustomAmount] = useState<string>('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user?.id) {
            supabase.rpc('get_wallet_balance', { p_user_id: user.id })
                .then(({ data, error }) => {
                    if (!error && data !== null) setBalance(data / 100);
                    else setBalance(0);
                });
        }
    }, [user?.id]);

    const handleAmountSelect = (amt: number) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCustomAmount('');
        setSelectedAmount(amt);
    };

    const handleAddFunds = async () => {
        const amt = customAmount ? parseFloat(customAmount) : selectedAmount;
        if (isNaN(amt) || amt < 10) {
            Alert.alert('Invalid Amount', 'Minimum top-up is $10 TTD.');
            return;
        }

        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (isExpoGo || !stripe) {
            Alert.alert('Expo Go Limitation', 'Native Stripe is not available in Expo Go. Please use a development build for card payments.');
            setLoading(false);
            return;
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) throw new Error('No session');

            const functionsUrl = `${ENV.SUPABASE_URL}/functions/v1/create_wallet_topup`;
            const response = await fetch(functionsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount_ttd: amt })
            });

            const { clientSecret } = await response.json();
            if (!clientSecret) throw new Error('Setup failed');

            const { error: initError } = await stripe.initPaymentSheet({
                paymentIntentClientSecret: clientSecret,
                merchantDisplayName: 'G-Taxi',
                style: 'alwaysDark',
                appearance: {
                    colors: {
                        primary: R.purple,
                        background: R.bg,
                        componentBackground: R.surface,
                        componentText: '#FFF',
                        primaryText: '#FFF',
                        secondaryText: R.muted,
                        placeholderText: 'rgba(255,255,255,0.2)',
                        icon: '#FFF',
                        error: '#EF4444',
                    },
                },
            });

            if (initError) throw new Error(initError.message);

            const { error: presentError } = await stripe.presentPaymentSheet();
            if (!presentError) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Success', `$${amt} TTD added to your wallet!`);
                navigation.goBack();
            }
        } catch (error: any) {
            Alert.alert('Error', error.message);
        } finally {
            setLoading(false);
        }
    };

    const amounts = [50, 100, 200, 500];
    const displayAmount = customAmount ? parseFloat(customAmount) || 0 : selectedAmount;

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF">Add Funds</Txt>
                <View style={{ width: 44 }} />
            </BlurView>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                <View style={s.balanceCard}>
                    <LinearGradient colors={['rgba(124,58,237,0.15)', 'transparent']} style={StyleSheet.absoluteFill} />
                    <Txt variant="caption" weight="heavy" color={R.muted}>CURRENT BALANCE</Txt>
                    <Txt variant="headingL" weight="heavy" color={R.purpleLight}>
                        ${balance !== null ? balance.toFixed(2) : '0.00'}
                    </Txt>
                </View>

                <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 20 }}>Select Amount</Txt>
                <View style={s.grid}>
                    {amounts.map(amt => {
                        const isActive = selectedAmount === amt && !customAmount;
                        return (
                            <TouchableOpacity
                                key={amt}
                                style={[s.amountCard, isActive && s.amountCardActive]}
                                onPress={() => handleAmountSelect(amt)}
                            >
                                <Txt variant="headingM" weight="heavy" color={isActive ? "#FFF" : R.muted}>${amt}</Txt>
                                <Txt variant="caption" weight="heavy" color={isActive ? R.purpleLight : R.muted}>TTD</Txt>
                                {isActive && <LinearGradient colors={['rgba(124,58,237,0.2)', 'transparent']} style={StyleSheet.absoluteFill} />}
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <View style={s.customWrap}>
                    <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>CUSTOM AMOUNT</Txt>
                    <TextInput
                        style={s.input}
                        placeholder="Enter amount"
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        keyboardType="numeric"
                        value={customAmount}
                        onChangeText={setCustomAmount}
                    />
                </View>

                <View style={s.securityNotice}>
                    <Ionicons name="lock-closed-outline" size={16} color={R.muted} />
                    <Txt variant="small" weight="heavy" color={R.muted} style={{ marginLeft: 8 }}>Secured by Stripe</Txt>
                </View>

                <TouchableOpacity style={s.payBtn} onPress={handleAddFunds} disabled={loading || displayAmount <= 0}>
                    <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                        {loading ? <ActivityIndicator color="#FFF" /> : (
                            <Txt variant="bodyBold" color="#FFF">Add ${displayAmount} TTD</Txt>
                        )}
                    </LinearGradient>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    scroll: { padding: 24 },
    balanceCard: { backgroundColor: R.surface, padding: 32, borderRadius: 32, alignItems: 'center', marginBottom: 40, borderWidth: 1, borderColor: R.border, overflow: 'hidden' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
    amountCard: { width: (width - 48 - 12) / 2, height: 100, backgroundColor: R.surface, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: R.border, overflow: 'hidden' },
    amountCardActive: { borderColor: R.purple, backgroundColor: 'rgba(124,58,237,0.05)' },

    customWrap: { gap: 8 },
    label: { marginLeft: 16 },
    input: { height: 60, backgroundColor: R.surface, borderRadius: 30, paddingHorizontal: 24, color: '#FFF', fontSize: 18, borderWidth: 1, borderColor: R.border },

    securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 40 },
    payBtn: { height: 60, borderRadius: 30, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
