import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ActivityIndicator, useWindowDimensions, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withSequence,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { useAuth } from '../context/AuthContext';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import type { DeliveryOffer } from '../services/realtime';

const WARNING = '#F59E0B';
const ERROR = '#EF4444';
const FOOD_ORANGE = '#F97316';
const SUCCESS = '#00FF94';

const ARC_SIZE = 180;

interface OrderDetail {
    merchant_name: string | null;
    merchant_address: string | null;
    rider_address: string | null;
    total_cents: number | null;
    delivery_fee_cents: number | null;
    items_count: number;
}

export function DeliveryRequestScreen({ navigation, route }: any) {
    const { height } = useWindowDimensions();
    const { offer }: { offer: DeliveryOffer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();

    const TIMEOUT_SECONDS = 20;
    const [timeLeft, setTimeLeft] = useState(
        offer?.expires_at
            ? Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000))
            : TIMEOUT_SECONDS
    );
    const [isHandling, setIsHandling] = useState(false);
    const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);

    const sheetY = useSharedValue(height);
    const fareScale = useSharedValue(1);
    const shakeX = useSharedValue(0);

    useEffect(() => {
        sheetY.value = withSpring(0, { damping: 18, stiffness: 120 });
        fareScale.value = withSequence(
            withSpring(1.12, { damping: 6, stiffness: 300 }),
            withSpring(1.0, { damping: 10, stiffness: 200 })
        );
    }, []);

    useEffect(() => {
        if (!offer?.order_id) { setDetailLoading(false); return; }
        const fetchDetails = async () => {
            const { data } = await supabase
                .from('orders')
                .select('total_cents, delivery_fee_cents, delivery_address, merchants(business_name, address)')
                .eq('id', offer.order_id)
                .single();
            if (data) {
                const itemCount = await supabase
                    .from('order_items')
                    .select('id', { count: 'exact', head: true })
                    .eq('order_id', offer.order_id);
                setOrderDetail({
                    merchant_name: (data.merchants as any)?.business_name ?? null,
                    merchant_address: (data.merchants as any)?.address ?? null,
                    rider_address: data.delivery_address ?? null,
                    total_cents: data.total_cents,
                    delivery_fee_cents: data.delivery_fee_cents,
                    items_count: itemCount.count ?? 0,
                });
            }
            setDetailLoading(false);
        };
        fetchDetails();
    }, [offer?.order_id]);

    useEffect(() => {
        if (!offer?.expires_at) return;
        const timer = setInterval(() => {
            const left = Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
            setTimeLeft(left);
            if (left <= 0 && !isHandling) handleDecline(true);
        }, 500);
        return () => clearInterval(timer);
    }, [offer?.expires_at]);

    const handleAccept = async () => {
        if (!offer?.id || !driver?.id || isHandling) return;
        setIsHandling(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        const { error } = await supabase
            .from('delivery_offers')
            .update({ status: 'accepted' })
            .eq('id', offer.id)
            .eq('status', 'pending');

        if (error) {
            Alert.alert('Offer Expired', 'This delivery is no longer available.');
            navigation.goBack();
            return;
        }

        // Update the order with the assigned driver
        await supabase
            .from('orders')
            .update({ delivery_driver_id: driver.id, status: 'driver_assigned' })
            .eq('id', offer.order_id);

        navigation.replace('ActiveDelivery', { orderId: offer.order_id });
    };

    const handleDecline = async (auto = false) => {
        if (isHandling) return;
        setIsHandling(true);
        if (auto) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            shakeX.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(0, { duration: 60 }));
        }
        await supabase
            .from('delivery_offers')
            .update({ status: auto ? 'expired' : 'declined' })
            .eq('id', offer.id)
            .eq('status', 'pending');
        navigation.goBack();
    };

    const deliveryEarnings = offer?.delivery_fee_cents
        ? (offer.delivery_fee_cents * 0.81 / 100).toFixed(2)
        : orderDetail?.delivery_fee_cents
            ? (orderDetail.delivery_fee_cents * 0.81 / 100).toFixed(2)
            : '?';

    const arcColor = timeLeft > 5 ? FOOD_ORANGE : timeLeft > 2 ? WARNING : ERROR;

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }, { translateX: shakeX.value }] }));
    const fareStyle = useAnimatedStyle(() => ({ transform: [{ scale: fareScale.value }] }));

    return (
        <View style={s.root} pointerEvents="box-none">
            <LinearGradient
                colors={[SURFACE.containerLow, SURFACE.base]}
                style={StyleSheet.absoluteFillObject}
            />
            <BlurView tint="dark" intensity={60} style={[StyleSheet.absoluteFillObject, glassSurface(60, 0.2)]} />

            <Reanimated.View style={[s.sheet, { paddingBottom: insets.bottom + 20 }, sheetStyle]}>
                <BlurView intensity={60} tint="dark" style={[s.cardBlur, glassSurface(60, 0.2)]}>
                    <View style={s.cardInner}>
                        <View style={s.handle} />

                        <View style={s.headerRow}>
                            <View style={s.typeBadge}>
                                <Ionicons name="restaurant-sharp" size={14} color={FOOD_ORANGE} />
                                <Text style={s.typeBadgeText}>FOOD DELIVERY</Text>
                            </View>
                            <Text style={s.subLabel}>81% of delivery fee</Text>
                        </View>

                        <View style={s.timerOuter}>
                            <LinearGradient
                                colors={['rgba(249,115,22,0.05)', 'transparent']}
                                style={[s.arc, { borderColor: arcColor }]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <Reanimated.View style={[s.fareBox, fareStyle]}>
                                    <Text style={s.earningsLabel}>YOU EARN</Text>
                                    <Text style={[s.earningsValue, { color: FOOD_ORANGE }]}>
                                        ${deliveryEarnings}
                                    </Text>
                                    <Text style={[s.countdownText, { color: arcColor }]}>
                                        {timeLeft}S REMAINING
                                    </Text>
                                </Reanimated.View>
                            </LinearGradient>
                        </View>

                        {detailLoading ? (
                            <ActivityIndicator color={FOOD_ORANGE} style={{ marginVertical: 40 }} />
                        ) : (
                            <View style={s.addressLayer}>
                                <View style={s.addrRow}>
                                    <View style={[s.dot, { backgroundColor: FOOD_ORANGE }]} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.addrLabel}>PICKUP FROM</Text>
                                        <Text style={s.addrText} numberOfLines={1}>
                                            {orderDetail?.merchant_name ?? offer?.merchant_name ?? 'Restaurant'}
                                        </Text>
                                        {orderDetail?.merchant_address ? (
                                            <Text style={s.addrSub} numberOfLines={1}>{orderDetail.merchant_address}</Text>
                                        ) : null}
                                    </View>
                                </View>
                                <View style={s.line} />
                                <View style={s.addrRow}>
                                    <View style={s.square} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.addrLabel}>DELIVER TO</Text>
                                        <Text style={s.addrText} numberOfLines={1}>
                                            {orderDetail?.rider_address ?? 'Customer address'}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        <View style={s.statsGrid}>
                            <View style={s.statPill}>
                                <Ionicons name="bag-handle-outline" size={16} color={FOOD_ORANGE} />
                                <Text style={s.statPillText}>
                                    {orderDetail?.items_count ?? '?'} ITEM{orderDetail?.items_count !== 1 ? 'S' : ''}
                                </Text>
                            </View>
                            <View style={s.statPill}>
                                <Ionicons name="wallet-outline" size={16} color={FOOD_ORANGE} />
                                <Text style={s.statPillText}>
                                    {orderDetail?.delivery_fee_cents
                                        ? `TTD $${(orderDetail.delivery_fee_cents / 100).toFixed(0)} FEE`
                                        : 'DELIVERY FEE'}
                                </Text>
                            </View>
                        </View>

                        <View style={s.actionRow}>
                            <TouchableOpacity style={s.declineBtn} onPress={() => handleDecline(false)} disabled={isHandling} accessibilityLabel="Decline delivery" accessibilityRole="button">
                                <Text style={s.declineText}>DECLINE</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={s.acceptBtn} onPress={handleAccept} disabled={isHandling} activeOpacity={0.9} accessibilityLabel="Accept delivery" accessibilityRole="button">
                                <LinearGradient
                                    colors={[FOOD_ORANGE, '#EA580C']}
                                    style={s.acceptGradient}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    {isHandling ? <ActivityIndicator color={SURFACE.base} /> : (
                                        <>
                                            <Ionicons name="bicycle" size={20} color={SURFACE.base} />
                                            <Text style={s.acceptText}>ACCEPT DELIVERY</Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base, justifyContent: 'flex-end' },
    sheet: { paddingHorizontal: 16 },
    cardBlur: { borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden', ...ghostBorder(0.2) },
    cardInner: { padding: 24, backgroundColor: SURFACE.containerLow },
    handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 24 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
    typeBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(249,115,22,0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
        ...ghostBorder(0.25),
    },
    typeBadgeText: { fontSize: 11, fontWeight: '800', color: FOOD_ORANGE, letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
    subLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'SpaceGrotesk-Bold' },
    timerOuter: { alignItems: 'center', marginBottom: 32, ...elevationGlow(20) },
    arc: { width: ARC_SIZE, height: ARC_SIZE, borderRadius: ARC_SIZE / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center', borderStyle: 'solid', backgroundColor: 'rgba(249,115,22,0.05)' },
    fareBox: { alignItems: 'center' },
    earningsLabel: { fontSize: 11, fontWeight: '600', color: VOICES.driver.textMuted, letterSpacing: 1.5, marginBottom: 4, fontFamily: 'SpaceGrotesk-Bold' },
    earningsValue: { fontSize: 42, fontWeight: '800', letterSpacing: -1, marginBottom: 4, fontFamily: 'SpaceGrotesk-Bold' },
    countdownText: { fontSize: 13, fontWeight: '800', letterSpacing: 1, fontFamily: 'SpaceGrotesk-Bold' },
    addressLayer: { backgroundColor: SURFACE.containerLow, borderRadius: 20, padding: 20, marginBottom: 28, ...ghostBorder(0.2) },
    addrRow: { flexDirection: 'row', alignItems: 'flex-start' },
    addrLabel: { fontSize: 11, fontWeight: '600', color: VOICES.driver.textMuted, letterSpacing: 0.5, marginBottom: 2, fontFamily: 'SpaceGrotesk-Bold' },
    addrText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', fontFamily: 'Manrope-Medium' },
    addrSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Manrope-Medium', marginTop: 2 },
    dot: { width: 12, height: 12, borderRadius: 6, marginRight: 14, marginTop: 2 },
    square: { width: 12, height: 12, borderRadius: 3, backgroundColor: WARNING, marginRight: 14, marginTop: 2 },
    line: { width: 2, height: 28, backgroundColor: 'rgba(255,255,255,0.1)', marginLeft: 5, marginVertical: 4 },
    statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 28 },
    statPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE.containerLow, paddingVertical: 12, borderRadius: 14, ...ghostBorder(0.2), gap: 6 },
    statPillText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF', fontFamily: 'SpaceGrotesk-Bold' },
    actionRow: { flexDirection: 'row', gap: 12 },
    declineBtn: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16, ...ghostBorder(0.3), backgroundColor: 'rgba(239,68,68,0.08)' },
    declineText: { fontSize: 15, fontWeight: '800', color: ERROR, letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
    acceptBtn: { flex: 2, height: 56, borderRadius: 16, overflow: 'hidden', ...elevationGlow(6) },
    acceptGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    acceptText: { fontSize: 15, fontWeight: '800', color: SURFACE.base, letterSpacing: 0.5, fontFamily: 'SpaceGrotesk-Bold' },
});
