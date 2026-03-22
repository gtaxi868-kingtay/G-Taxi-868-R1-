import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    Alert, ActivityIndicator, Dimensions
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
    const stripe = isExpoGo ? null : useStripe();

    const [selected, setSelected] = useState<PaymentMethod>(initialMethod);
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState('');
    const isProcessingRef = useRef(false);

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
                Alert.alert('Payment Failed', presentError.message);
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
    }, [rideId, userId, stripe, navigation, isExpoGo]);

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

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF">Payment</Txt>
                <View style={{ width: 44 }} />
            </BlurView>

            <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>

                {fareCents && (
                    <View style={s.fareDisplay}>
                        <Txt variant="caption" weight="heavy" color={R.muted}>AMOUNT DUE</Txt>
                        <Txt variant="headingL" weight="heavy" color="#FFF">${(fareCents / 100).toFixed(2)}</Txt>
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
                            <View style={s.iconWrap}>
                                <Ionicons name={opt.icon as any} size={24} color={isActive ? "#FFF" : R.muted} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 16 }}>
                                <Txt variant="bodyBold" color={isActive ? "#FFF" : R.muted}>{opt.label}</Txt>
                                <Txt variant="small" color={isActive ? R.purpleLight : R.muted}>{opt.subtitle}</Txt>
                            </View>
                            <View style={[s.radio, isActive && s.radioActive]}>
                                {isActive && <View style={s.radioDot} />}
                            </View>
                            {isActive && <LinearGradient colors={['rgba(124,58,237,0.1)', 'transparent']} style={StyleSheet.absoluteFill} />}
                        </TouchableOpacity>
                    );
                })}

                <View style={s.securityNotice}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={R.muted} />
                    <Txt variant="small" color={R.muted} style={{ marginLeft: 8 }}>Secure encrypted payments</Txt>
                </View>

                {rideId && (
                    <TouchableOpacity style={s.payBtn} onPress={handleConfirm} disabled={loading}>
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.btnGradient}>
                            {loading ? <ActivityIndicator color="#FFF" /> : (
                                <Txt variant="bodyBold" color="#FFF">
                                    {selected === 'card' ? 'Pay with Card' : 'Confirm Method'}
                                </Txt>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>
                )}

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center' },

    scroll: { padding: 24 },
    fareDisplay: { alignItems: 'center', marginBottom: 40, backgroundColor: R.surface, padding: 32, borderRadius: 32, borderWidth: 1, borderColor: R.border },

    methodCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, backgroundColor: R.surface, marginBottom: 12, borderWidth: 1, borderColor: R.border, overflow: 'hidden' },
    methodCardActive: { borderColor: R.purple, backgroundColor: 'rgba(124,58,237,0.05)' },
    iconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center' },

    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: R.muted, alignItems: 'center', justifyContent: 'center' },
    radioActive: { borderColor: R.purpleLight },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: R.purpleLight },

    securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
    payBtn: { height: 60, borderRadius: 30, overflow: 'hidden', marginTop: 40 },
    btnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
