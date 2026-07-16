import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ScrollView, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

// Flat delivery payout, anchored to T&T minimum wage — mirrors the
// DELIVERY_DRIVER_PAYOUT_CENTS default in process_order_delivery_payment.
// The authoritative figure comes back from the payout RPC on completion.
const DELIVERY_PAYOUT_CENTS = 3200;

const FOOD_ORANGE = '#E6B450';
const SUCCESS = '#10B981';
const WARNING = '#E6B450';
const ERROR = '#EF4444';

type DeliveryStep = 'en_route_pickup' | 'picked_up' | 'en_route_dropoff' | 'delivered';

const STEPS: { key: DeliveryStep; label: string; icon: string; color: string }[] = [
    { key: 'en_route_pickup', label: 'Go to Restaurant', icon: 'navigate', color: FOOD_ORANGE },
    { key: 'picked_up', label: 'Picked Up', icon: 'bag-check', color: WARNING },
    { key: 'en_route_dropoff', label: 'En Route to Customer', icon: 'bicycle', color: VOICES.driver.accent },
    { key: 'delivered', label: 'Delivered', icon: 'checkmark-circle', color: SUCCESS },
];

interface OrderDetail {
    id: string;
    merchant_name: string | null;
    merchant_address: string | null;
    merchant_phone: string | null;
    rider_name: string | null;
    rider_phone: string | null;
    delivery_address: string | null;
    total_cents: number | null;
    delivery_fee_cents: number | null;
    delivery_status: string | null;
}

export function ActiveDeliveryScreen({ navigation, route }: any) {
    const { orderId } = route.params || {};
    const insets = useSafeAreaInsets();

    const [order, setOrder] = useState<OrderDetail | null>(null);
    const [step, setStep] = useState<DeliveryStep>('en_route_pickup');
    const [isUpdating, setIsUpdating] = useState(false);

    const STATUS_MAP: Record<DeliveryStep, string> = {
        en_route_pickup: 'driver_assigned',
        picked_up: 'driver_picked_up',
        en_route_dropoff: 'driver_en_route',
        delivered: 'delivered',
    };

    useEffect(() => {
        if (!orderId) return;
        const fetchOrder = async () => {
            const { data } = await supabase
                .from('orders')
                .select(`
                    id, total_cents, delivery_fee_cents, delivery_address, delivery_status,
                    merchants(business_name, address, phone),
                    profiles!orders_rider_id_fkey(full_name, phone)
                `)
                .eq('id', orderId)
                .single();
            if (data) {
                const merchant = data.merchants as any;
                const profile = data.profiles as any;
                setOrder({
                    id: data.id,
                    merchant_name: merchant?.business_name ?? null,
                    merchant_address: merchant?.address ?? null,
                    merchant_phone: merchant?.phone ?? null,
                    rider_name: profile?.full_name ?? null,
                    rider_phone: profile?.phone ?? null,
                    delivery_address: data.delivery_address ?? null,
                    total_cents: data.total_cents,
                    delivery_fee_cents: data.delivery_fee_cents,
                    delivery_status: data.delivery_status,
                });
                // Restore step from existing status
                const reverse: Record<string, DeliveryStep> = {
                    driver_assigned: 'en_route_pickup',
                    driver_picked_up: 'picked_up',
                    driver_en_route: 'en_route_dropoff',
                    delivered: 'delivered',
                };
                if (data.delivery_status && reverse[data.delivery_status]) {
                    setStep(reverse[data.delivery_status]);
                }
            }
        };
        fetchOrder();
    }, [orderId]);

    const uploadProofPhoto = async (uri: string): Promise<string | null> => {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const userId = userData.user?.id;
            if (!userId) return null;

            const response = await fetch(uri);
            const blob = await response.blob();
            const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.readAsArrayBuffer(blob);
            });

            // storage_insert_owner_only requires the first folder segment to
            // be the uploader's auth uid.
            const path = `${userId}/delivery_proof_${orderId}_${Date.now()}.jpg`;
            const { error } = await supabase.storage
                .from('driver-documents')
                .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
            if (error) return null;
            return path;
        } catch {
            return null;
        }
    };

    // The final transition MUST go through the grocery edge function —
    // process_order_delivery_payment gates on the order still being in
    // 'confirmed'/'out_for_delivery', pays the flat delivery payout, and
    // holds pay if there is no proof photo. Setting status='delivered'
    // directly from the client would both skip the driver's pay and break
    // the RPC's state gate.
    const confirmDelivery = async (photoPath: string | null) => {
        setIsUpdating(true);
        try {
            const { data: res, error } = await supabase.functions.invoke('grocery', {
                body: { action: 'confirm_delivery', order_id: orderId, photo_url: photoPath },
            });
            if (error || !res || res.error) {
                throw new Error(res?.error || error?.message || 'Delivery confirmation failed');
            }

            // RPC owns orders.status; mirror the driver-facing delivery_status only.
            await supabase
                .from('orders')
                .update({ delivery_status: STATUS_MAP.delivered })
                .eq('id', orderId)
                .then((r) => r, () => null);

            setStep('delivered');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            if (res.held) {
                Alert.alert(
                    'Delivered — Payout On Hold',
                    'The delivery is confirmed, but your payout is held because no proof photo was submitted. Contact support to release it.',
                    [{ text: 'Done', onPress: () => navigation.replace('Dashboard') }]
                );
            } else {
                const paid = ((res.driver_payout_cents ?? DELIVERY_PAYOUT_CENTS) / 100).toFixed(2);
                Alert.alert(
                    'Delivery Complete!',
                    `TTD $${paid} has been added to your wallet.`,
                    [{ text: 'Done', onPress: () => navigation.replace('Dashboard') }]
                );
            }
        } catch (err: any) {
            Alert.alert('Could Not Confirm Delivery', err?.message ?? 'Please try again.');
        } finally {
            setIsUpdating(false);
        }
    };

    const captureProofAndConfirm = async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.granted) {
            const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
            if (!result.canceled && result.assets?.[0]?.uri) {
                const path = await uploadProofPhoto(result.assets[0].uri);
                if (path) {
                    await confirmDelivery(path);
                    return;
                }
                Alert.alert(
                    'Photo Upload Failed',
                    'The proof photo could not be uploaded. Deliver without it? Your payout will be held until proof is provided.',
                    [
                        { text: 'Retry Photo', onPress: captureProofAndConfirm },
                        { text: 'Deliver Without Photo', style: 'destructive', onPress: () => confirmDelivery(null) },
                    ]
                );
                return;
            }
        }
        Alert.alert(
            'Proof Photo Required',
            'Snap a photo of the handed-off order to release your payout. Delivering without one holds your pay.',
            [
                { text: 'Take Photo', onPress: captureProofAndConfirm },
                { text: 'Deliver Without Photo', style: 'destructive', onPress: () => confirmDelivery(null) },
            ]
        );
    };

    const advanceStep = async () => {
        if (isUpdating) return;
        const currentIdx = STEPS.findIndex(s => s.key === step);
        if (currentIdx >= STEPS.length - 1) return;

        const nextStep = STEPS[currentIdx + 1].key;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (nextStep === 'delivered') {
            await captureProofAndConfirm();
            return;
        }

        setIsUpdating(true);
        // 'out_for_delivery' (not 'in_delivery') — it is the status the payout
        // RPC accepts as a valid pre-delivery state.
        await supabase
            .from('orders')
            .update({ delivery_status: STATUS_MAP[nextStep], status: 'out_for_delivery' })
            .eq('id', orderId);

        setStep(nextStep);
        setIsUpdating(false);
    };

    const callPhone = (phone: string | null | undefined) => {
        if (!phone) return;
        Linking.openURL(`tel:${phone}`);
    };

    const currentStepData = STEPS.find(s => s.key === step) ?? STEPS[0];
    const currentIdx = STEPS.findIndex(s => s.key === step);
    const nextStepData = STEPS[currentIdx + 1];
    // Flat min-wage-anchored payout — a delivery's effort doesn't scale with
    // cart value, so this is NOT a percentage of the fee.
    const earnings = (DELIVERY_PAYOUT_CENTS / 100).toFixed(2);

    return (
        <View style={[s.root, { paddingTop: insets.top }]}>
            <LinearGradient colors={[SURFACE.containerLow, SURFACE.base]} style={StyleSheet.absoluteFillObject} />

            {/* Header */}
            <View style={s.header}>
                <View style={[s.earningsBadge]}>
                    <Text style={s.earningsLabel}>YOU EARN</Text>
                    <Text style={s.earningsValue}>TTD ${earnings}</Text>
                </View>
                <View style={s.typePill}>
                    <Ionicons name="restaurant-sharp" size={14} color={FOOD_ORANGE} />
                    <Text style={s.typePillText}>DELIVERY</Text>
                </View>
            </View>

            {/* Progress */}
            <View style={s.progressRow}>
                {STEPS.map((s_step, i) => (
                    <View key={s_step.key} style={s.progressItem}>
                        <View style={[
                            s.progressDot,
                            i < currentIdx && { backgroundColor: SUCCESS },
                            i === currentIdx && { backgroundColor: currentStepData.color, borderColor: currentStepData.color },
                            i > currentIdx && { backgroundColor: 'transparent' },
                        ]}>
                            {i < currentIdx
                                ? <Ionicons name="checkmark" size={10} color="#EAF3F6" />
                                : <Text style={[s.progressNum, i <= currentIdx && { color: '#EAF3F6' }]}>{i + 1}</Text>
                            }
                        </View>
                        {i < STEPS.length - 1 && (
                            <View style={[s.progressLine, i < currentIdx && { backgroundColor: SUCCESS }]} />
                        )}
                    </View>
                ))}
            </View>

            <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
                {/* Current step card */}
                <View style={[s.stepCard, ghostBorder(0.25), elevationGlow(8)]}>
                    <LinearGradient
                        colors={[currentStepData.color + '20', 'transparent']}
                        style={StyleSheet.absoluteFillObject}
                    />
                    <Ionicons name={currentStepData.icon as any} size={32} color={currentStepData.color} />
                    <Text style={[s.stepLabel, { color: currentStepData.color }]}>{currentStepData.label}</Text>
                </View>

                {/* Merchant info */}
                <View style={[s.infoCard, ghostBorder(0.15)]}>
                    <View style={s.infoRow}>
                        <View style={[s.infoIconWrap, { backgroundColor: FOOD_ORANGE + '20' }]}>
                            <Ionicons name="storefront-outline" size={18} color={FOOD_ORANGE} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.infoLabel}>Pick up from</Text>
                            <Text style={s.infoValue}>{order?.merchant_name ?? '...'}</Text>
                            {order?.merchant_address ? (
                                <Text style={s.infoSub}>{order.merchant_address}</Text>
                            ) : null}
                        </View>
                        {order?.merchant_phone ? (
                            <TouchableOpacity onPress={() => callPhone(order.merchant_phone)} style={s.callBtn}>
                                <Ionicons name="call" size={18} color={SUCCESS} />
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </View>

                {/* Customer info */}
                <View style={[s.infoCard, ghostBorder(0.15)]}>
                    <View style={s.infoRow}>
                        <View style={[s.infoIconWrap, { backgroundColor: VOICES.driver.accent + '20' }]}>
                            <Ionicons name="person-outline" size={18} color={VOICES.driver.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.infoLabel}>Deliver to</Text>
                            <Text style={s.infoValue}>{order?.rider_name ?? 'Customer'}</Text>
                            {order?.delivery_address ? (
                                <Text style={s.infoSub}>{order.delivery_address}</Text>
                            ) : null}
                        </View>
                        {order?.rider_phone ? (
                            <TouchableOpacity onPress={() => callPhone(order.rider_phone)} style={s.callBtn}>
                                <Ionicons name="call" size={18} color={SUCCESS} />
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </View>
            </ScrollView>

            {/* Action button */}
            <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
                {nextStepData ? (
                    <TouchableOpacity style={s.advanceBtn} onPress={advanceStep} disabled={isUpdating} activeOpacity={0.88}>
                        <LinearGradient
                            colors={[nextStepData.color, nextStepData.color + 'CC']}
                            style={s.advanceGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Ionicons name={nextStepData.icon as any} size={22} color="#EAF3F6" />
                            <Text style={s.advanceText}>{nextStepData.label}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
    earningsBadge: { backgroundColor: FOOD_ORANGE + '15', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, ...ghostBorder(0.2) },
    earningsLabel: { fontSize: 10, fontWeight: '700', color: FOOD_ORANGE, letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold', marginBottom: 2 },
    earningsValue: { fontSize: 20, fontWeight: '800', color: FOOD_ORANGE, fontFamily: 'SpaceGrotesk-Bold' },
    typePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FOOD_ORANGE + '12', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, ...ghostBorder(0.2) },
    typePillText: { fontSize: 11, fontWeight: '800', color: FOOD_ORANGE, letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
    progressRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
    progressItem: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    progressDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    progressNum: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.3)', fontFamily: 'SpaceGrotesk-Bold' },
    progressLine: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 4 },
    content: { paddingHorizontal: 16, paddingBottom: 20, gap: 12 },
    stepCard: { borderRadius: 20, padding: 28, alignItems: 'center', gap: 12, backgroundColor: SURFACE.containerLow, overflow: 'hidden' },
    stepLabel: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
    infoCard: { borderRadius: 16, padding: 16, backgroundColor: SURFACE.containerLow },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    infoIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    infoLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold', marginBottom: 4 },
    infoValue: { fontSize: 15, fontWeight: '700', color: '#EAF3F6', fontFamily: 'Manrope-Medium' },
    infoSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Manrope-Medium', marginTop: 2 },
    callBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: SUCCESS + '15', alignItems: 'center', justifyContent: 'center', ...ghostBorder(0.2) },
    footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: SURFACE.base },
    advanceBtn: { borderRadius: 18, overflow: 'hidden', ...elevationGlow(8) },
    advanceGradient: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    advanceText: { fontSize: 16, fontWeight: '800', color: '#EAF3F6', letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
});
