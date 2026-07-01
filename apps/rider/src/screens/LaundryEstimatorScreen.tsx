import React, { useState, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Alert, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

interface ServiceType {
    id: string;
    label: string;
    icon: string;
    baseRate: number;
}

export function LaundryEstimatorScreen({ navigation, route }: any) {
    const { service } = route.params as { service: ServiceType };
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { initPaymentSheet, presentPaymentSheet } = useStripe();

    const [weight, setWeight] = useState(5);
    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');

    const priceCents = Math.round(service.baseRate * weight);

    const handleSchedule = useCallback(async () => {
        if (!user?.id) { Alert.alert('Error', 'Please log in.'); return; }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);

        try {
            const { data: order, error: orderErr } = await supabase
                .from('orders')
                .insert({
                    rider_id: user.id,
                    total_cents: priceCents,
                    status: 'pending',
                    payment_method: paymentMethod === 'cash' ? 'cash' : 'card',
                    payment_status: paymentMethod === 'cash' ? 'cash_on_delivery' : 'unpaid',
                    delivery_method: 'laundry_pickup',
                })
                .select('id')
                .single();

            if (orderErr) throw orderErr;

            if (paymentMethod === 'card') {
                const { data: piData, error: piErr } = await supabase.functions.invoke(
                    'create_order_payment_intent',
                    { body: { order_id: order.id } }
                );
                if (piErr) throw new Error(piErr.message || 'Failed to create payment');

                const { error: initErr } = await initPaymentSheet({
                    merchantDisplayName: 'G-Taxi Laundry',
                    paymentIntentClientSecret: piData.clientSecret,
                    customerId: piData.customer,
                    customerEphemeralKeySecret: piData.ephemeralKey,
                    style: 'alwaysDark',
                });
                if (initErr) throw initErr;

                const { error: presentErr } = await presentPaymentSheet();
                if (presentErr) {
                    Alert.alert('Payment Cancelled', presentErr.message);
                    setLoading(false);
                    return;
                }

                Alert.alert(
                    '✅ Laundry Scheduled!',
                    `${service.label} for ~${weight} lbs.\nPaid: $${(priceCents / 100).toFixed(2)} TTD\nOrder: ${order.id.slice(0, 8).toUpperCase()}`,
                    [
                        {
                            text: 'Track Order',
                            onPress: () => navigation.navigate('LaundryOrderStatus', { orderId: order.id, service, weight, priceCents }),
                        },
                        { text: 'Done', onPress: () => navigation.navigate('Home') },
                    ]
                );
            } else {
                Alert.alert(
                    '✅ Laundry Scheduled! (Cash on Delivery)',
                    `${service.label} for ~${weight} lbs.\nTotal: $${(priceCents / 100).toFixed(2)} TTD\nPay driver upon pickup.\nOrder: ${order.id.slice(0, 8).toUpperCase()}`,
                    [
                        {
                            text: 'Track Order',
                            onPress: () => navigation.navigate('LaundryOrderStatus', { orderId: order.id, service, weight, priceCents }),
                        },
                        { text: 'Done', onPress: () => navigation.navigate('Home') },
                    ]
                );
            }
        } catch (err: any) {
            Alert.alert('Booking Failed', err.message || 'Please try again.');
        } finally {
            setLoading(false);
        }
    }, [user, priceCents, service, weight, navigation, paymentMethod, initPaymentSheet, presentPaymentSheet]);

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>{service.label}</Text>
                <View style={{ width: 38 }} />
            </View>

            <View style={s.content}>
                <View style={s.scaleBox}>
                    <View style={[StyleSheet.absoluteFillObject, glassSurface(25, 0.2)]} />
                    <Ionicons name="scale-outline" size={48} color="rgba(255,255,255,0.6)" />
                    <Text style={s.weightDisplay}>{weight} lbs</Text>
                    <Text style={s.weightSub}>Estimated weight</Text>

                    <View style={s.sliderContainer}>
                        {Slider && (
                            <Slider
                                style={s.slider}
                                minimumValue={1}
                                maximumValue={30}
                                step={1}
                                value={weight}
                                onValueChange={(val: any) => {
                                    setWeight(val as number);
                                    Haptics.selectionAsync();
                                }}
                                minimumTrackTintColor={VOICES.rider.accent}
                                maximumTrackTintColor="rgba(255,255,255,0.15)"
                                thumbTintColor={CYAN}
                            />
                        )}
                        <View style={s.sliderLabels}>
                            <Text style={s.sliderLabel}>1 lb</Text>
                            <Text style={s.sliderLabel}>30 lbs</Text>
                        </View>
                    </View>
                </View>

                <View style={s.priceCard}>
                    <View style={[StyleSheet.absoluteFillObject, glassSurface(25, 0.2)]} />
                    <Text style={s.priceBreakdown}>
                        {weight} lbs  ×  ${(service.baseRate / 100).toFixed(2)}/lb
                    </Text>
                    <Text style={s.priceTotal}>${(priceCents / 100).toFixed(2)} TTD</Text>
                    <Text style={s.priceNote}>Including express handling</Text>
                </View>

                <View style={s.features}>
                    {['Same-day pickup', 'Hypoallergenic detergent', 'Sealed & returned fresh'].map(f => (
                        <View key={f} style={s.featureRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#4ADE80" />
                            <Text style={s.featureText}>{f}</Text>
                        </View>
                    ))}
                </View>
            </View>

            <View style={s.paymentToggle}>
                <TouchableOpacity
                    style={[s.payOption, paymentMethod === 'card' && s.payOptionActive]}
                    onPress={() => setPaymentMethod('card')}
                >
                    <Ionicons name="card-outline" size={18} color={paymentMethod === 'card' ? CYAN : 'rgba(255,255,255,0.4)'} />
                    <Text style={[s.payOptionText, paymentMethod === 'card' && s.payOptionTextActive]}>Card</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.payOption, paymentMethod === 'cash' && s.payOptionActive]}
                    onPress={() => setPaymentMethod('cash')}
                >
                    <Ionicons name="cash-outline" size={18} color={paymentMethod === 'cash' ? CYAN : 'rgba(255,255,255,0.4)'} />
                    <Text style={[s.payOptionText, paymentMethod === 'cash' && s.payOptionTextActive]}>Cash</Text>
                </TouchableOpacity>
            </View>

            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleSchedule} disabled={loading} activeOpacity={0.88}>
                    <LinearGradient
                        colors={[VOICES.rider.accent, VOICES.rider.accentDark]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="calendar-outline" size={22} color="#EAF3F6" style={{ marginRight: 8 }} />
                        <Text style={s.ctaText}>{loading ? 'Scheduling...' : `Schedule Pickup  ·  $${(priceCents / 100).toFixed(2)} TTD`}</Text>
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6' },
    content: { flex: 1, padding: 20, gap: 16 },
    scaleBox: {
        borderRadius: 28, overflow: 'hidden', padding: 28, alignItems: 'center',
        ...ghostBorder(0.12),
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    scaleEmoji: { fontSize: 72, marginBottom: 12 },
    weightDisplay: { fontSize: 56, fontWeight: '900', color: VOICES.rider.accent },
    weightSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 4, marginBottom: 24 },
    sliderContainer: { width: '100%' },
    slider: { width: '100%', height: 40 },
    sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    sliderLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
    priceCard: {
        borderRadius: 24, overflow: 'hidden', padding: 22, alignItems: 'center', gap: 4,
        ...ghostBorder(0.2),
        backgroundColor: 'rgba(0,255,255,0.04)',
    },
    priceBreakdown: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
    priceTotal: { fontSize: 36, fontWeight: '900', color: CYAN },
    priceNote: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 4 },
    features: { gap: 12, paddingVertical: 8 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    featureText: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
    paymentToggle: {
        flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 12,
    },
    payOption: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 14, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.05)',
        ...ghostBorder(0.1),
    },
    payOptionActive: {
        backgroundColor: 'rgba(52,230,236,0.12)',
        borderColor: CYAN,
    },
    payOptionText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
    payOptionTextActive: { color: CYAN },
    ctaContainer: { paddingHorizontal: 20, paddingTop: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 16, fontWeight: '800', color: '#EAF3F6' },
});
