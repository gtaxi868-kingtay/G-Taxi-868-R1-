import React, { useState, useCallback } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useStripe } from '@stripe/stripe-react-native';
import * as Location from 'expo-location';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/Toast';
import { Button, Card, Chip, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

interface ServiceType {
    id: string;
    label: string;
    icon: string;
    baseRate: number;
}

export function LaundryEstimatorScreen({ navigation, route }: any) {
    const { service } = route.params as { service: ServiceType };
    const { user } = useAuth();
    const { initPaymentSheet, presentPaymentSheet } = useStripe();

    const [weight, setWeight] = useState(5);
    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('cash');

    const priceCents = Math.round(service.baseRate * weight);

    const handleSchedule = useCallback(async () => {
        if (!user?.id) { toast('Please sign in again.', 'error'); return; }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setLoading(true);

        try {
            // A driver has to come to the rider, so we need where they are.
            const perm = await Location.requestForegroundPermissionsAsync();
            if (perm.status !== 'granted') {
                toast('Allow location so a driver knows where to collect your laundry.', 'error');
                return;
            }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

            // The server prices and creates the order (create_laundry_order).
            // The phone used to insert it with its own total_cents, which the
            // database refused, and which would have let a rider set any price.
            const { data: booked, error: bookErr } = await supabase.rpc('create_laundry_order', {
                p_service: service.id,
                p_weight_lbs: weight,
                p_payment_method: paymentMethod,
                p_pickup_lat: pos.coords.latitude,
                p_pickup_lng: pos.coords.longitude,
                p_pickup_address: null,
            });
            if (bookErr) throw bookErr;
            if (!booked?.success) throw new Error(booked?.error || 'Could not book laundry.');
            const order = { id: booked.order_id as string };
            const chargedCents: number = booked.total_cents;

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
                    toast('Payment cancelled', 'error');
                    setLoading(false);
                    return;
                }

                toast(`Pickup booked. Paid $${(chargedCents / 100).toFixed(2)} TTD.`, 'success');
                navigation.replace('LaundryOrderStatus', { orderId: order.id, service, weight, priceCents: chargedCents });
            } else {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                toast(`Pickup booked. Pay the driver $${(chargedCents / 100).toFixed(2)} TTD.`, 'success');
                navigation.replace('LaundryOrderStatus', { orderId: order.id, service, weight, priceCents: chargedCents });
            }
        } catch (err: any) {
            toast(err.message || 'Booking did not go through. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    }, [user, priceCents, service, weight, navigation, paymentMethod, initPaymentSheet, presentPaymentSheet]);

    const m = useTheme();
    const step = (delta: number) => { Haptics.selectionAsync(); setWeight(w => Math.min(30, Math.max(1, w + delta))); };
    const stepBtn = (icon: any, label: string, delta: number) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => step(delta)} hitSlop={6}
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={m.ink} />
        </Pressable>
    );

    return (
        <Screen
            title={service.label}
            onBack={() => navigation.goBack()}
            footer={<Button title={`Book pickup · about $${(priceCents / 100).toFixed(2)}`} icon="calendar-outline" loading={loading} onPress={handleSchedule} />}
        >
            <Card style={{ alignItems: 'center', paddingVertical: SPACE.xl, marginTop: SPACE.sm }}>
                <Txt variant="label" tone="dim">About how much?</Txt>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg }}>
                    {stepBtn('remove', 'Less', -1)}
                    <View style={{ width: 140, alignItems: 'center' }}>
                        <Txt variant="hero" style={{ fontSize: 44, lineHeight: 50 }}>{weight}</Txt>
                        <Txt variant="body" tone="dim">lbs</Txt>
                    </View>
                    {stepBtn('add', 'More', 1)}
                </View>
                <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.lg, textAlign: 'center' }}>A full laundry basket is about 10 to 12 lbs.</Txt>
            </Card>

            <Card style={{ marginTop: SPACE.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt variant="body" tone="dim">{weight} lbs × ${(service.baseRate / 100).toFixed(2)}</Txt>
                    <Txt variant="headline">${(priceCents / 100).toFixed(2)}</Txt>
                </View>
                <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.xs }}>Estimate. Your final price is confirmed when you book.</Txt>
            </Card>

            <Section title="Pay with">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Chip icon="cash-outline" label="Cash to the driver" selected={paymentMethod === 'cash'} onPress={() => { Haptics.selectionAsync(); setPaymentMethod('cash'); }} />
                </View>
            </Section>
        </Screen>
    );
}
