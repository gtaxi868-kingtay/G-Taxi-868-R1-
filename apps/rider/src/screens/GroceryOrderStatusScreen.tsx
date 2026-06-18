import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { supabase } from '@gtaxi/core';
import { Txt } from '@/design-system/primitives';

const CYAN = '#06B6D4';
const SUCCESS = '#10B981';
const ERROR = '#FF4D4D';

const STATUS_STEPS = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered'];
const STATUS_LABELS: Record<string, string> = {
    pending: 'Order Placed',
    confirmed: 'Accepted',
    preparing: 'Being Prepared',
    ready_for_pickup: 'Ready for Pickup',
    delivered: 'Delivered ✅',
};
const STATUS_ICONS: Record<string, string> = {
    pending: 'hourglass-outline',
    confirmed: 'checkmark-circle-outline',
    preparing: 'refresh-circle-outline',
    ready_for_pickup: 'bag-handle-outline',
    delivered: 'home-outline',
};

const DEFAULT_REGION = {
    latitude: 10.6918,
    longitude: -61.2225,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
};

export function GroceryOrderStatusScreen({ navigation, route }: any) {
    const { orderId, service, weight, priceCents } = route.params;
    const insets = useSafeAreaInsets();
    const [status, setStatus] = useState<string>('pending');
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
    const [paymentStatus, setPaymentStatus] = useState<string>('unpaid');
    const [pins, setPins] = useState<any>(null);
    const [intakeLog, setIntakeLog] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [merchantLocation, setMerchantLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [driverId, setDriverId] = useState<string | null>(null);
    const [rideId, setRideId] = useState<string | null>(null);
    const mapRef = useRef<MapView>(null);

    const resolveDriverFromRide = async (ride_id: string) => {
        const { data: ride } = await supabase
            .from('rides')
            .select('driver_id')
            .eq('id', ride_id)
            .single();

        if (ride?.driver_id) {
            setDriverId(ride.driver_id);
            setRideId(ride_id);
        }
    };

    useEffect(() => {
        const fetchStatus = async () => {
            setFetchError(false);
            try {
                const { data, error } = await supabase
                    .from('orders')
                    .select('status, payment_method, payment_status, ride_id, merchant_id, merchant_intake_logs(*), order_handoff_pins(*)')
                    .eq('id', orderId)
                    .single();

                if (error) throw error;
                if (data) {
                    setStatus(data.status);
                    setPaymentMethod(data.payment_method);
                    setPaymentStatus(data.payment_status);
                    setPins(data.order_handoff_pins);
                    if (data.ride_id) resolveDriverFromRide(data.ride_id);
                    if (data.merchant_intake_logs && data.merchant_intake_logs.length > 0) {
                        setIntakeLog(data.merchant_intake_logs[0]);
                    }

                    if (data.merchant_id) {
                        const { data: merchant } = await supabase
                            .from('merchants')
                            .select('lat, lng')
                            .eq('id', data.merchant_id)
                            .single();

                        if (merchant?.lat && merchant?.lng) {
                            setMerchantLocation({ latitude: merchant.lat, longitude: merchant.lng });
                        }
                    }
                }
            } catch (err) {
                console.error('[GroceryOrderStatus] fetch error:', err);
                setFetchError(true);
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();

        const channel = supabase
            .channel(`order_status_${orderId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${orderId}`,
            }, (payload: any) => {
                if (payload.new?.status) {
                    setStatus(payload.new.status);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                if (payload.new?.ride_id && payload.new.ride_id !== rideId) {
                    resolveDriverFromRide(payload.new.ride_id);
                }
            })
            .subscribe();

        return () => { channel.unsubscribe(); };
    }, [orderId, retryKey]);

    useEffect(() => {
        if (!driverId) return;

        const channel = supabase
            .channel(`driver_location_${driverId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'driver_locations',
                filter: `driver_id=eq.${driverId}`,
            }, (payload: any) => {
                if (payload.new?.lat && payload.new?.lng) {
                    setDriverLocation({ latitude: payload.new.lat, longitude: payload.new.lng });
                    mapRef.current?.animateToRegion({
                        latitude: payload.new.lat,
                        longitude: payload.new.lng,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    }, 1000);
                }
            })
            .subscribe();

        return () => { channel.unsubscribe(); };
    }, [driverId]);

    const currentStep = STATUS_STEPS.indexOf(status);
    const isPending = status === 'pending';
    const hasDriver = !!driverId;

    const mapRegion = merchantLocation ? {
        ...merchantLocation,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
    } : DEFAULT_REGION;

    return (
        <LinearGradient colors={[SURFACE.base, '#12122A']} style={s.container} pointerEvents="box-none">
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Order Status</Text>
                <View style={{ width: 38 }} />
            </View>

            {/* Live Map */}
            <View style={s.mapContainer}>
                <MapView
                    ref={mapRef}
                    style={s.map}
                    provider={PROVIDER_DEFAULT}
                    initialRegion={mapRegion}
                >
                    {merchantLocation && (
                        <Marker
                            coordinate={merchantLocation}
                            title="Merchant"
                            pinColor="#F59E0B"
                        />
                    )}
                    {driverLocation && (
                        <Marker
                            coordinate={driverLocation}
                            title="Driver"
                            pinColor={VOICES.rider.accent}
                        />
                    )}
                </MapView>

                {/* Searching overlay when no driver */}
                {isPending && !hasDriver && (
                    <View style={s.searchingOverlay}>
                        <BlurView intensity={60} tint="dark" style={s.searchingBlur}>
                            <Ionicons name="radio" size={40} color={VOICES.rider.accent} />
                            <Text style={s.searchingText}>Searching for Driver...</Text>
                            <Text style={s.searchingSub}>Finding the nearest available driver</Text>
                        </BlurView>
                    </View>
                )}

                {/* Driver assigned badge */}
                {hasDriver && (
                    <View style={s.driverBadge}>
                        <BlurView intensity={60} tint="dark" style={s.driverBadgeBlur}>
                            <Ionicons name="car" size={16} color={CYAN} />
                            <Text style={s.driverBadgeText}>Driver assigned</Text>
                        </BlurView>
                    </View>
                )}
            </View>

            {/* Order summary card */}
            <View style={s.summaryCard}>
                <BlurView intensity={60} style={StyleSheet.absoluteFillObject} tint="dark" />
                <Text style={s.summaryId}>#{orderId.slice(0, 8).toUpperCase()}</Text>
                <Text style={s.summaryDetail}>
                    {service?.label}  ·  {weight} lbs  ·  ${((priceCents || 0) / 100).toFixed(2)} TTD
                </Text>
                {paymentMethod === 'cash' && paymentStatus === 'cash_on_delivery' ? (
                    <View style={s.paymentBadgeCash}>
                        <Ionicons name="cash-outline" size={12} color="#F59E0B" />
                        <Text style={s.paymentBadgeCashText}>Cash on delivery</Text>
                    </View>
                ) : paymentStatus === 'paid' ? (
                    <View style={s.paymentBadgePaid}>
                        <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                        <Text style={s.paymentBadgePaidText}>Paid by Card</Text>
                    </View>
                ) : paymentStatus === 'unpaid' && paymentMethod === 'card' ? (
                    <View style={s.paymentBadgePending}>
                        <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.4)" />
                        <Text style={s.paymentBadgePendingText}>Payment pending</Text>
                    </View>
                ) : null}
            </View>

            {/* Status steps */}
            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color={CYAN} />
                </View>
            ) : fetchError ? (
                <View style={[s.center, { paddingHorizontal: 32 }]}>
                    <Ionicons name="cloud-offline-outline" size={44} color="rgba(255,255,255,0.25)" />
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
                        Could not load order status
                    </Text>
                    <TouchableOpacity
                        onPress={() => { setLoading(true); setRetryKey(k => k + 1); }}
                        style={{ marginTop: 20, paddingHorizontal: 28, paddingVertical: 13, backgroundColor: CYAN, borderRadius: 16 }}
                    >
                        <Text style={{ color: SURFACE.base, fontWeight: '700', fontSize: 15 }}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={s.steps}>
                    {STATUS_STEPS.map((step, idx) => {
                        const done = idx < currentStep;
                        const active = idx === currentStep;
                        return (
                            <View key={step} style={s.stepRow}>
                                {idx < STATUS_STEPS.length - 1 && (
                                    <View style={[s.connector, done && s.connectorDone]} />
                                )}
                                <View
                                    style={[
                                        s.stepIconBox,
                                        done && s.stepDone,
                                        active && s.stepActive,
                                    ]}
                                >
                                    <Ionicons
                                        name={STATUS_ICONS[step] as any}
                                        size={20}
                                        color={active ? SURFACE.base : done ? SUCCESS : 'rgba(255,255,255,0.3)'}
                                    />
                                </View>
                                <View style={s.stepLabel}>
                                    <Text style={[
                                        s.stepText,
                                        done && s.stepTextDone,
                                        active && s.stepTextActive,
                                    ]}>
                                        {STATUS_LABELS[step]}
                                    </Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            )}

            {/* PIN HUD */}
            {(status === 'pending' || status === 'confirmed') && pins && (
                <View style={s.pinSection}>
                    <BlurView intensity={60} tint="dark" style={s.pinCard}>
                        <Txt variant="caption" color="rgba(255,255,255,0.4)">PICKUP PIN</Txt>
                        <Txt variant="headingL" color={CYAN} style={{ letterSpacing: 8 }}>{pins.pickup_pin}</Txt>
                        <Txt variant="small" color="rgba(255,255,255,0.4)" style={{ textAlign: 'center', marginTop: 8 }}>
                            Give this code to the driver upon pickup.
                        </Txt>
                    </BlurView>
                </View>
            )}

            {/* INTAKE APPROVAL */}
            {status === 'awaiting_approval' && intakeLog && (
                <View style={StyleSheet.absoluteFillObject}>
                    <BlurView intensity={60} tint="dark" style={s.approvalOverlay}>
                        <View style={s.approvalCard}>
                            <LinearGradient colors={['rgba(191,64,255,0.2)', 'rgba(6,182,212,0.1)']} style={StyleSheet.absoluteFillObject} />
                            <Ionicons name="shield-checkmark" size={44} color={CYAN} style={{ alignSelf: 'center', marginBottom: 16 }} />
                            <Txt variant="headingM" color="#FFF" style={{ textAlign: 'center' }}>Verify Your Items</Txt>
                            <Txt variant="bodyReg" color="rgba(255,255,255,0.6)" style={{ textAlign: 'center', marginBottom: 24 }}>
                                The merchant has received your order. Please confirm to begin preparation.
                            </Txt>

                            <View style={s.itemList}>
                                {Object.entries(intakeLog.items).map(([key, val]: [string, any]) => (
                                    <View key={key} style={s.itemRow}>
                                        <Txt variant="bodyBold" color="#FFF">{key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</Txt>
                                        <Txt variant="bodyBold" color={CYAN}>{val} units</Txt>
                                    </View>
                                ))}
                            </View>

                            <View style={s.btnRow}>
                                <TouchableOpacity style={s.rejectBtn} onPress={async () => {
                                    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                                }}>
                                    <Txt variant="bodyBold" color={ERROR}>REJECT</Txt>
                                </TouchableOpacity>
                                <TouchableOpacity style={s.approveBtn} onPress={async () => {
                                    await supabase.from('orders').update({ status: 'confirmed' }).eq('id', orderId);
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                }}>
                                    <Txt variant="bodyBold" color={SURFACE.base}>APPROVE</Txt>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </BlurView>
                </View>
            )}

            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity
                    style={s.ctaButton}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('Home'); }}
                    activeOpacity={0.88}
                >
                    <LinearGradient
                        colors={[`${VOICES.rider.accent}4D`, `${CYAN}1A`]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={s.ctaGradient}
                    >
                        <Text style={s.ctaText}>Back to Home</Text>
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
        ...elevationGlow(),
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
    mapContainer: { height: 220, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', marginBottom: 16, ...elevationGlow() },
    map: { flex: 1 },
    searchingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
    searchingBlur: {
        padding: 24, borderRadius: 20, alignItems: 'center',
        ...glassSurface(60, 0.2),
        ...ghostBorder(0.3),
    },
    searchingText: { fontSize: 16, fontWeight: '700', color: '#FFF', marginTop: 12, fontFamily: 'SpaceGrotesk' },
    searchingSub: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontFamily: 'Manrope' },
    driverBadge: { position: 'absolute', top: 12, left: 12 },
    driverBadgeBlur: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12,
        borderRadius: 20, gap: 6,
        ...glassSurface(60, 0.2),
        ...ghostBorder(0.1),
    },
    driverBadgeText: { fontSize: 12, fontWeight: '600', color: '#FFF', fontFamily: 'Manrope' },
    summaryCard: {
        marginHorizontal: 20, borderRadius: 20,
        padding: 18, marginBottom: 20, alignItems: 'center',
        ...glassSurface(60, 0.2),
        ...ghostBorder(0.1),
    },
    summaryId: { fontSize: 22, fontWeight: '900', color: CYAN, letterSpacing: 2, fontFamily: 'SpaceGrotesk' },
    summaryDetail: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontFamily: 'Manrope' },
    paymentBadgeCash: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
        paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
        backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    },
    paymentBadgeCashText: { fontSize: 12, fontWeight: '700', color: '#F59E0B', fontFamily: 'Manrope' },
    paymentBadgePaid: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
        paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
        backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    },
    paymentBadgePaidText: { fontSize: 12, fontWeight: '700', color: '#22C55E', fontFamily: 'Manrope' },
    paymentBadgePending: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
        paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    },
    paymentBadgePendingText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.4)', fontFamily: 'Manrope' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    steps: { paddingHorizontal: 40, gap: 0 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 64 },
    connector: {
        position: 'absolute', left: 56, top: 44,
        width: 2, height: 32,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    connectorDone: { backgroundColor: SUCCESS },
    stepIconBox: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.07)',
        alignItems: 'center', justifyContent: 'center',
        ...ghostBorder(0.15),
    },
    stepDone: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: SUCCESS },
    stepActive: { backgroundColor: CYAN, borderColor: CYAN },
    stepLabel: { flex: 1 },
    stepText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', fontWeight: '300', fontFamily: 'Manrope' },
    stepTextDone: { color: SUCCESS },
    stepTextActive: { color: '#FFF', fontWeight: '700' },
    ctaContainer: { padding: 20, marginTop: 'auto' },
    ctaButton: { borderRadius: 20, overflow: 'hidden', ...ghostBorder(0.3) },
    ctaGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#FFF', fontFamily: 'SpaceGrotesk' },
    pinSection: { paddingHorizontal: 40, marginTop: 20 },
    pinCard: {
        padding: 24, borderRadius: 24, alignItems: 'center',
        ...glassSurface(60, 0.2),
        ...ghostBorder(0.2),
    },
    approvalOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', padding: 20 },
    approvalCard: {
        borderRadius: 32, padding: 32, overflow: 'hidden',
        backgroundColor: 'rgba(10, 10, 31, 0.8)',
        ...ghostBorder(0.3),
    },
    itemList: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 32 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    btnRow: { flexDirection: 'row', gap: 12 },
    rejectBtn: {
        flex: 1, height: 56, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${ERROR}1A`,
        ...ghostBorder(0.2),
    },
    approveBtn: { flex: 2, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: CYAN },
});
