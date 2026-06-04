import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, useWindowDimensions, ScrollView, Platform,
    KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { Txt } from '@/design-system/primitives';
import { ENV } from '@gtaxi/shared/env';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

const R = {
    bg: SURFACE.base,
    surface: 'rgba(255,255,255,0.08)',
    border: 'rgba(191,64,255,0.2)',
    purple: VOICES.rider.accent,
    purpleLight: CYAN,
    gold: '#F59E0B',
    white: '#FFF',
    muted: '#AEA9B5',
};

export function WalletTopUpScreen({ navigation }: any) {
    const { width } = useWindowDimensions();
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
        if (isNaN(amt) || amt < 20) {
            Alert.alert('Invalid Amount', 'Minimum top-up is $20 TTD.');
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
            if (!token) throw new Error('Your session has expired. Please log in again.');

            const functionsUrl = `${ENV.SUPABASE_URL}/functions/v1/create_wallet_topup`;
            const response = await fetch(functionsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount_ttd: amt })
            });

            if (!response.ok) {
                if (response.status === 429) throw new Error('Traffic is high right now. Please wait a moment and try again.');
                if (response.status === 401) throw new Error('Your session has expired. Please log in again.');
                const errorBody = await response.text().catch(() => '');
                throw new Error(errorBody || `Server error (${response.status}). Please try again.`);
            }

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

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Financial Support</Txt>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1 }}
            >
            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
                <View style={s.balanceCard}>
                    <LinearGradient 
                        colors={[`${VOICES.rider.accent}1A`, 'transparent']} 
                        style={StyleSheet.absoluteFillObject} 
                    />
                    <Txt variant="caption" weight="heavy" color={CYAN} style={{ letterSpacing: 2 }}>ESTABLISHED BALANCE</Txt>
                    <Txt variant="displayXL" weight="heavy" color="#FFF">
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
                                style={[s.amountCard, { width: (width - 40 - 12) / 2 }, isActive && s.amountCardActive]}
                                onPress={() => handleAmountSelect(amt)}
                            >
                                <Txt variant="headingM" weight="heavy" color={isActive ? "#FFF" : R.muted}>${amt}</Txt>
                                <Txt variant="caption" weight="heavy" color={isActive ? CYAN : R.muted}>TTD</Txt>
                                {isActive && (
                                    <LinearGradient 
                                        colors={[`${VOICES.rider.accent}33`, 'transparent']} 
                                        style={StyleSheet.absoluteFillObject} 
                                    />
                                )}
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
                    <LinearGradient 
                        colors={[VOICES.rider.accent, CYAN]} 
                        start={{x: 0, y: 0}} 
                        end={{x: 1, y: 0}}
                        style={s.btnGradient}
                    >
                        {loading ? <ActivityIndicator color="#FFF" /> : (
                            <Txt variant="bodyBold" color="#FFF">INJECT ${displayAmount} TTD</Txt>
                        )}
                    </LinearGradient>
                </TouchableOpacity>

            </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    headerBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    balanceCard: { backgroundColor: 'rgba(255,255,255,0.03)', padding: 40, borderRadius: 40, alignItems: 'center', marginBottom: 40, ...ghostBorder(0.05), overflow: 'hidden' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
    amountCard: { height: 120, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.05), overflow: 'hidden' },
    amountCardActive: { borderColor: VOICES.rider.accent, backgroundColor: 'rgba(124,58,237,0.05)' },

    customWrap: { gap: 12, marginTop: 12 },
    label: { marginLeft: 16, letterSpacing: 1 },
    input: { height: 64, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, paddingHorizontal: 24, color: '#FFF', fontSize: 18, ...ghostBorder(0.05) },

    securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 32 },
    payBtn: { height: 64, borderRadius: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
