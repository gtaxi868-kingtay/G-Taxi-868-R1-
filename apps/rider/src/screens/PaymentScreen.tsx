import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Button, Card, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

type PaymentMethod = 'cash' | 'wallet' | 'card' | 'wipay';

const OPTIONS = [
    { id: 'cash', label: 'Cash', icon: 'cash-outline', subtitle: 'Pay your driver' },
    { id: 'wallet', label: 'G-Coin', icon: 'wallet-outline', subtitle: 'Paid from your wallet' },
    { id: 'card', label: 'Card', icon: 'card-outline', subtitle: 'Visa or Mastercard' },
    { id: 'wipay', label: 'WiPay', icon: 'card-outline', subtitle: 'Local T&T debit cards' },
];

export function PaymentScreen({ navigation, route }: any) {
    const rideId = route?.params?.ride_id;
    const initialMethod = route?.params?.payment_method ?? 'cash';
    const fareCents = route?.params?.fare_cents;
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const stripe = isExpoGo ? null : useStripe();

    const [selected, setSelected] = useState<PaymentMethod>(initialMethod);
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState('');
    const isProcessingRef = useRef(false);
    const [showPaymentRetry, setShowPaymentRetry] = useState(false);
    const [paymentAttempts, setPaymentAttempts] = useState(0);
    const MAX_PAYMENT_ATTEMPTS = 3;

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? "")).catch(() => {});
    }, []);

    const handleCardPayment = useCallback(async () => {
        if (!rideId) return;
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const idempotencyKey = `pi_${rideId}_${userId}`;
            if (isExpoGo || !stripe) {
                Alert.alert('Expo Go Limitation', 'Native Stripe is not available in Expo Go. Please use a development build for card payments.');
                return;
            }

            const { data, error: fnError } = await supabase.functions.invoke(
                'create_payment_intent',
                { body: { ride_id: rideId, idempotency_key: idempotencyKey } }
            );

            if (fnError || !data?.clientSecret) {
                Alert.alert('Setup Failed', fnError?.message || 'Could not initialize payment.');
                return;
            }

            const { error: initError } = await stripe.initPaymentSheet({
                paymentIntentClientSecret: data.clientSecret,
                customerId: data.customer,
                customerEphemeralKeySecret: data.ephemeralKey,
                merchantDisplayName: 'G-Taxi 868',
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

            if (initError) { Alert.alert('Error', initError.message); return; }

            const { error: presentError } = await stripe.presentPaymentSheet();
            if (presentError && presentError.code !== 'Canceled') {
                const attempts = paymentAttempts + 1;
                setPaymentAttempts(attempts);

                if (attempts < MAX_PAYMENT_ATTEMPTS) {
                    setShowPaymentRetry(true);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    setTimeout(() => {
                        setShowPaymentRetry(false);
                        isProcessingRef.current = false;
                        handleCardPayment();
                    }, 3000);
                } else {
                    Alert.alert(
                        'Payment Failed',
                        'Multiple attempts failed. Try a different method or contact support.',
                        [
                            { text: 'Try Again', onPress: () => { setPaymentAttempts(0); isProcessingRef.current = false; handleCardPayment(); }},
                            { text: 'Use Cash', onPress: () => { setSelected('cash'); navigation.goBack(); }}
                        ]
                    );
                }
                return;
            }

            if (!presentError) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Success', 'Card payment processed.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
            }
        } catch (err: any) {
            Alert.alert('Error', err.message);
        } finally {
            setLoading(false);
            isProcessingRef.current = false;
        }
    }, [rideId, userId, stripe, navigation, isExpoGo, paymentAttempts]);

    const handleWipayPayment = useCallback(async () => {
        if (!rideId) return;
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { data, error: fnError } = await supabase.functions.invoke(
                'create_wipay_payment',
                { body: { ride_id: rideId } }
            );

            if (fnError || !data?.checkout_url) {
                Alert.alert('Setup Failed', fnError?.message || 'Could not initialize WiPay payment.');
                return;
            }

            const supported = await Linking.canOpenURL(data.checkout_url);
            if (!supported) {
                Alert.alert('Error', 'Unable to open payment page.');
                return;
            }

            await Linking.openURL(data.checkout_url);

            const checkPayment = setInterval(async () => {
                const { data: ride } = await supabase
                    .from('rides')
                    .select('payment_status')
                    .eq('id', rideId)
                    .single();

                if (ride?.payment_status === 'captured') {
                    clearInterval(checkPayment);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Success', 'WiPay payment confirmed.', [
                        { text: 'OK', onPress: () => navigation.goBack() }
                    ]);
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(checkPayment);
                Alert.alert(
                    'Still Waiting',
                    'We haven\'t received payment confirmation yet. If you completed the payment, it may take a moment. You can check again or try a different method.',
                    [
                        { text: 'Check Again', onPress: () => navigation.goBack() },
                        { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() },
                    ]
                );
            }, 120000);
        } catch (err: any) {
            Alert.alert('Error', err.message);
        } finally {
            setLoading(false);
            isProcessingRef.current = false;
        }
    }, [rideId, userId, navigation]);

    const handleConfirm = async () => {
        if (selected === 'card') {
            await handleCardPayment();
        } else if (selected === 'wipay') {
            await handleWipayPayment();
        } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.goBack();
        }
    };

    const m = useTheme();
    return (
        <Screen
            title="Payment"
            onBack={() => navigation.goBack()}
            footer={rideId ? (
                <Button title={selected === 'card' ? 'Pay by card' : selected === 'wipay' ? 'Pay with WiPay' : 'Confirm'} loading={loading} onPress={handleConfirm} />
            ) : undefined}
        >
            {fareCents ? (
                <Card style={{ alignItems: 'center', paddingVertical: SPACE.xl, marginTop: SPACE.sm }}>
                    <Txt variant="label" tone="dim">Amount due</Txt>
                    <Txt variant="hero" style={{ marginTop: SPACE.xs }}>${(fareCents / 100).toFixed(2)}</Txt>
                </Card>
            ) : null}

            <Section title="Pay with">
                <Card style={{ paddingVertical: SPACE.xs }}>
                    {OPTIONS.map((opt, i) => {
                        const on = selected === opt.id;
                        return (
                            <Row key={opt.id} icon={opt.icon as any} title={opt.label} subtitle={opt.subtitle} last={i === OPTIONS.length - 1}
                                onPress={() => { Haptics.selectionAsync(); setSelected(opt.id as any); }}
                                right={<Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? m.accent : m.faint} />} />
                        );
                    })}
                </Card>
            </Section>

            {showPaymentRetry && (
                <Card style={{ marginTop: SPACE.lg }}>
                    <Txt variant="bodyStrong">Trying the payment again… (attempt {paymentAttempts + 1} of {MAX_PAYMENT_ATTEMPTS})</Txt>
                </Card>
            )}
        </Screen>
    );
}
