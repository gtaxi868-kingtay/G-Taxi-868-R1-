import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    Alert, ActivityIndicator, Dimensions, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import Constants, { ExecutionEnvironment } from 'expo-constants';

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

type PaymentMethod = 'cash' | 'wallet' | 'card';

const OPTIONS = [
    { id: 'cash', label: 'Cash', icon: 'cash-outline', subtitle: 'Pay directly' },
    { id: 'wallet', label: 'Wallet', icon: 'wallet-outline', subtitle: 'Auto-deduct' },
    { id: 'card', label: 'Card', icon: 'card-outline', subtitle: 'Secure Stripe' },
];

export function PaymentScreen({ navigation, route }: any) {
    const rideId = route?.params?.ride_id;
    const initialMethod = route?.params?.payment_method ?? 'cash';
    const fareCents = route?.params?.fare_cents;
    const insets = useSafeAreaInsets();
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const isWeb = Platform.OS === 'web';
    const stripe = (isExpoGo || isWeb) ? null : useStripe();

    const [selected, setSelected] = useState<PaymentMethod>(initialMethod);
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState('');
    const isProcessingRef = useRef(false);
    // FIX F8: Payment retry state
    const [showPaymentRetry, setShowPaymentRetry] = useState(false);
    const [paymentAttempts, setPaymentAttempts] = useState(0);
    const MAX_PAYMENT_ATTEMPTS = 3;

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? ""));
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
                customerId: data.customer,              // NEW: Link to saved cards
                customerEphemeralKeySecret: data.ephemeralKey, // NEW: Security handshake
                merchantDisplayName: 'G-Taxi 868',
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

            if (initError) { Alert.alert('Error', initError.message); return; }

            const { error: presentError } = await stripe.presentPaymentSheet();
            if (presentError && presentError.code !== 'Canceled') {
                // FIX F8: Payment retry logic
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

    const handleConfirm = async () => {
        if (selected === 'card') {
            await handleCardPayment();
        } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.goBack();
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF" style={{ marginLeft: 16 }}>Payment</Txt>
            </View>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                {fareCents && (
                    <View style={s.fareDisplay}>
                        <Txt variant="caption" weight="heavy" color={tokens.colors.primary.cyan} style={{ letterSpacing: 2 }}>AMOUNT DUE</Txt>
                        <Txt variant="displayXL" weight="heavy" color="#FFF">${(fareCents / 100).toFixed(2)}</Txt>
                    </View>
                )}

                <Txt variant="bodyBold" color="#FFF" style={{ marginBottom: 20 }}>Select Method</Txt>

                {OPTIONS.map(opt => {
                    const isActive = selected === opt.id;
                    return (
                        <TouchableOpacity
                            key={opt.id}
                            style={[s.methodCard, isActive && s.methodCardActive]}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelected(opt.id as any); }}
                        >
                            <View style={[s.iconWrap, isActive && { backgroundColor: tokens.colors.primary.purple }]}>
                                <Ionicons name={opt.icon as any} size={24} color={isActive ? "#FFF" : R.muted} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 16 }}>
                                <Txt variant="bodyBold" color={isActive ? "#FFF" : R.muted}>{opt.label}</Txt>
                                <Txt variant="small" color={isActive ? tokens.colors.primary.cyan : R.muted}>{opt.subtitle}</Txt>
                            </View>
                            <View style={[s.radio, isActive && s.radioActive]}>
                                {isActive && <View style={[s.radioDot, { backgroundColor: tokens.colors.primary.cyan }]} />}
                            </View>
                        </TouchableOpacity>
                    );
                })}

                <View style={s.securityNotice}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={R.muted} />
                    <Txt variant="small" color={R.muted} style={{ marginLeft: 8 }}>Secure encrypted payments</Txt>
                </View>

                {rideId && (
                    <TouchableOpacity style={s.payBtn} onPress={handleConfirm} disabled={loading}>
                        <LinearGradient 
                            colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                            start={{x: 0, y: 0}} 
                            end={{x: 1, y: 0}}
                            style={s.btnGradient}
                        >
                            {loading ? <ActivityIndicator color="#FFF" /> : (
                                <Txt variant="bodyBold" color="#FFF">
                                    {selected === 'card' ? 'PROCESS ENGAGEMENT' : 'CONFIRM ENGAGEMENT'}
                                </Txt>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>
                )}

            </ScrollView>

            {/* FIX F8: Payment Retry Toast */}
            {showPaymentRetry && (
                <View style={s.retryToast}>
                    <ActivityIndicator size="small" color="#0D0B1E" style={{ marginRight: 12 }} />
                    <Txt variant="bodyBold" color="#0D0B1E">
                        Retrying payment... (Attempt {paymentAttempts + 1}/{MAX_PAYMENT_ATTEMPTS})
                    </Txt>
                </View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    scroll: { paddingHorizontal: 20 },
    fareDisplay: { alignItems: 'center', marginBottom: 40, backgroundColor: 'rgba(255,255,255,0.03)', padding: 40, borderRadius: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    methodCard: { flexDirection: 'row', alignItems: 'center', padding: 24, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
    methodCardActive: { borderColor: tokens.colors.primary.purple, backgroundColor: 'rgba(124,58,237,0.05)' },
    iconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },

    radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    radioActive: { borderColor: tokens.colors.primary.cyan },
    radioDot: { width: 12, height: 12, borderRadius: 6 },

    securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 32 },
    payBtn: { height: 64, borderRadius: 24, overflow: 'hidden', marginTop: 40 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // FIX F8: Payment Retry Toast
    retryToast: {
        position: 'absolute',
        bottom: 100,
        left: 20, right: 20,
        backgroundColor: 'rgba(245, 158, 11, 0.95)',
        paddingVertical: 16, paddingHorizontal: 20,
        borderRadius: 16,
        flexDirection: 'row', alignItems: 'center',
        zIndex: 100,
    },
});
