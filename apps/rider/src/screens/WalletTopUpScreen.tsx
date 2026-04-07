import React, { useState, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    ActivityIndicator, Alert, Dimensions, ScrollView, Platform
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

import { tokens } from '../design-system/tokens';

const { width } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function WalletTopUpScreen({ navigation }: any) {
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const isWeb = Platform.OS === 'web';
    const stripe = (isExpoGo || isWeb) ? null : useStripe();

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

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Financial Support</Txt>
            </View>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                <View style={s.balanceCard}>
                    <LinearGradient 
                        colors={['rgba(124,58,237,0.1)', 'transparent']} 
                        style={StyleSheet.absoluteFill} 
                    />
                    <Txt variant="caption" weight="heavy" color={tokens.colors.primary.cyan} style={{ letterSpacing: 2 }}>ESTABLISHED BALANCE</Txt>
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
                                style={[s.amountCard, isActive && s.amountCardActive]}
                                onPress={() => handleAmountSelect(amt)}
                            >
                                <Txt variant="headingM" weight="heavy" color={isActive ? "#FFF" : R.muted}>${amt}</Txt>
                                <Txt variant="caption" weight="heavy" color={isActive ? tokens.colors.primary.cyan : R.muted}>TTD</Txt>
                                {isActive && (
                                    <LinearGradient 
                                        colors={['rgba(124,58,237,0.2)', 'transparent']} 
                                        style={StyleSheet.absoluteFill} 
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
                        colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
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
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    headerBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    balanceCard: { backgroundColor: 'rgba(255,255,255,0.03)', padding: 40, borderRadius: 40, alignItems: 'center', marginBottom: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
    amountCard: { width: (width - 40 - 12) / 2, height: 120, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
    amountCardActive: { borderColor: tokens.colors.primary.purple, backgroundColor: 'rgba(124,58,237,0.05)' },

    customWrap: { gap: 12, marginTop: 12 },
    label: { marginLeft: 16, letterSpacing: 1 },
    input: { height: 64, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, paddingHorizontal: 24, color: '#FFF', fontSize: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 32 },
    payBtn: { height: 64, borderRadius: 24, overflow: 'hidden' },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
