import React, { useState, useEffect } from 'react';
import { View, Pressable } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { ENV } from '@g868/shared/env';
import { toast } from '../components/Toast';
import { Button, Card, Field, RADIUS, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

export function WalletTopUpScreen({ navigation }: any) {
    const { user } = useAuth();
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const stripe = isExpoGo ? null : useStripe();

    const [balance, setBalance] = useState<number | null>(null);
    const [selectedAmount, setSelectedAmount] = useState<number>(100);
    const [customAmount, setCustomAmount] = useState<string>('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user?.id) {
            supabase.rpc('get_wallet_balance', { p_user_id: user.id })
                .then(
                    ({ data, error }) => {
                        if (!error && data !== null) setBalance(data / 100);
                        else setBalance(0);
                    },
                    (err: unknown) => { console.warn('[WalletTopUp] balance fetch failed:', err); setBalance(0); },
                );
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
            toast('The minimum top-up is $20 TTD.', 'error');
            return;
        }

        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (isExpoGo || !stripe) {
            toast('Card top-ups need the full G 868 app, not Expo Go.', 'error');
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
                // A 5xx here means card top-ups are not switched on server-side yet.
                if (response.status >= 500) throw new Error('Adding money by card is not available yet. You can still pay for rides in cash.');
                const errorBody = await response.text().catch(() => '');
                throw new Error(errorBody || `Something went wrong (${response.status}). Please try again.`);
            }

            const { clientSecret } = await response.json();
            if (!clientSecret) throw new Error('Setup failed');

            const { error: initError } = await stripe.initPaymentSheet({
                paymentIntentClientSecret: clientSecret,
                merchantDisplayName: 'G-Taxi',
                style: 'alwaysDark',
                appearance: {
                    colors: {
                        primary: '#8B7CFF',
                        background: '#0B0814',
                        componentBackground: '#1C1626',
                        componentText: '#F6F0E8',
                        primaryText: '#F6F0E8',
                        secondaryText: '#B8B0C4',
                        placeholderText: 'rgba(255,255,255,0.2)',
                        icon: '#EAF3F6',
                        error: '#EF4444',
                    },
                },
            });

            if (initError) throw new Error(initError.message);

            const { error: presentError } = await stripe.presentPaymentSheet();
            if (!presentError) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                toast(`$${amt} TTD added to your wallet`, 'success');
                navigation.goBack();
            }
        } catch (error: any) {
            toast(error.message || 'Could not add money. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const m = useTheme();
    const amounts = [50, 100, 200, 500];
    const displayAmount = customAmount ? parseFloat(customAmount) || 0 : selectedAmount;

    return (
        <Screen
            title="Add money"
            onBack={() => navigation.goBack()}
            footer={<Button title={`Add $${displayAmount || 0} TTD`} onPress={handleAddFunds} loading={loading} disabled={displayAmount <= 0} />}
        >
            <Card style={{ alignItems: 'center', paddingVertical: SPACE.xl, marginTop: SPACE.sm }}>
                <Txt variant="label" tone="dim">Current balance</Txt>
                <Txt variant="hero" style={{ marginTop: SPACE.xs }}>${balance !== null ? balance.toFixed(2) : '—'}</Txt>
            </Card>

            <Section title="Choose an amount">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -SPACE.xs }}>
                    {amounts.map(amt => {
                        const on = selectedAmount === amt && !customAmount;
                        return (
                            <View key={amt} style={{ width: '50%', padding: SPACE.xs }}>
                                <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`$${amt} TTD`}
                                    onPress={() => handleAmountSelect(amt)}
                                    style={({ pressed }) => ({
                                        height: 72, borderRadius: RADIUS.field, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
                                        borderColor: on ? m.accent : m.chipBorder, backgroundColor: on ? (m.key === 'day' ? 'rgba(122,92,255,0.08)' : 'rgba(185,174,255,0.12)') : m.chip,
                                        opacity: pressed ? 0.85 : 1,
                                    })}>
                                    <Txt variant="title">${amt}</Txt>
                                    <Txt variant="caption" tone="dim">TTD</Txt>
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
            </Section>

            <Section title="Or enter an amount">
                <Field placeholder="Minimum $20" keyboardType="numeric" value={customAmount} onChangeText={setCustomAmount} />
            </Section>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="lock-closed-outline" size={14} color={m.faint} />
                <Txt variant="caption" tone="faint" style={{ marginLeft: 6 }}>Card payments are processed securely by Stripe</Txt>
            </View>
        </Screen>
    );
}
