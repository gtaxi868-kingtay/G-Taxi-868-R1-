import React, { useEffect, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { Txt } from '@/design-system/primitives';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';

const CYAN = '#06B6D4';

const STATUS_STEPS = ['pending', 'picked_up', 'processing', 'ready', 'delivered'];
const STATUS_LABELS: Record<string, string> = {
    pending: 'Order Confirmed',
    picked_up: 'Picked Up',
    processing: 'Being Cleaned',
    ready: 'Ready for Delivery',
    delivered: 'Delivered ✅',
};
const STATUS_ICONS: Record<string, string> = {
    pending: 'hourglass-outline',
    picked_up: 'bag-handle-outline',
    processing: 'refresh-circle-outline',
    ready: 'checkmark-circle-outline',
    delivered: 'home-outline',
};

export function LaundryOrderStatusScreen({ navigation, route }: any) {
    const { orderId, service, weight, priceCents } = route.params;
    const insets = useSafeAreaInsets();
    const [status, setStatus] = useState<string>('pending');
    const [pins, setPins] = useState<any>(null);
    const [intakeLog, setIntakeLog] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const pulseAnim = useSharedValue(1);

    useEffect(() => {
        pulseAnim.value = withRepeat(
            withSequence(
                withTiming(1.1, { duration: 900 }),
                withTiming(1, { duration: 900 })
            ),
            -1,
            true
        );
    }, []);

    const pulseStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pulseAnim.value }],
    }));

    useEffect(() => {
        const fetchStatus = async () => {
            setFetchError(false);
            try {
                const { data, error } = await supabase
                    .from('orders')
                    .select('status, merchant_intake_logs(*), order_handoff_pins(*)')
                    .eq('id', orderId)
                    .single();
                if (error) throw error;
                if (data) {
                    setStatus(data.status);
                    setPins(data.order_handoff_pins);
                    if (data.merchant_intake_logs && data.merchant_intake_logs.length > 0) {
                        setIntakeLog(data.merchant_intake_logs[0]);
                    }
                }
            } catch (err) {
                console.error('[LaundryOrderStatus] fetch error:', err);
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
            })
            .subscribe();

        return () => { channel.unsubscribe(); };
    }, [orderId, retryKey]);

    const currentStep = STATUS_STEPS.indexOf(status);

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Order Status</Text>
                <View style={{ width: 38 }} />
            </View>

            <View style={s.summaryCard}>
                <View style={[StyleSheet.absoluteFillObject, glassSurface(25, 0.2)]} />
                <Text style={s.summaryId}>#{orderId.slice(0, 8).toUpperCase()}</Text>
                <Text style={s.summaryDetail}>
                    {service?.label}  ·  {weight} lbs  ·  ${((priceCents || 0) / 100).toFixed(2)} TTD
                </Text>
            </View>

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
                        <Text style={{ color: '#0A0A1F', fontWeight: '700', fontSize: 15 }}>Try Again</Text>
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
                                <Animated.View
                                    style={[
                                        s.stepIconBox,
                                        done && s.stepDone,
                                        active && s.stepActive,
                                        active && pulseStyle,
                                    ]}
                                >
                                    <Ionicons
                                        name={STATUS_ICONS[step] as any}
                                        size={20}
                                        color={active ? SURFACE.base : done ? '#10B981' : 'rgba(255,255,255,0.3)'}
                                    />
                                </Animated.View>
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

            {status === 'pending' && pins && (
                <View style={s.pinSection}>
                    <View style={s.pinCard}>
                        <View style={[StyleSheet.absoluteFillObject, glassSurface(20, 0.2)]} />
                        <Txt variant="caption" color="rgba(255,255,255,0.4)">PICKUP PIN</Txt>
                        <Txt variant="headingL" color={CYAN} style={{ letterSpacing: 8 }}>{pins.pickup_pin}</Txt>
                        <Txt variant="small" color="rgba(255,255,255,0.4)" style={{ textAlign: 'center', marginTop: 8 }}>
                            Give this 4-digit code to the driver upon arrival.
                        </Txt>
                    </View>
                </View>
            )}

            {status === 'awaiting_approval' && intakeLog && (
                <View style={StyleSheet.absoluteFillObject}>
                    <View style={s.approvalOverlay}>
                        <View style={[StyleSheet.absoluteFillObject, glassSurface(100, 0.2)]} />
                        <View style={s.approvalCard}>
                            <LinearGradient colors={[`${VOICES.rider.accent}33`, `${CYAN}1A`]} style={StyleSheet.absoluteFillObject} />
                            <Ionicons name="shield-checkmark" size={44} color={CYAN} style={{ alignSelf: 'center', marginBottom: 16 }} />
                            <Txt variant="headingM" color="#EAF3F6" style={{ textAlign: 'center' }}>Verify Your Items</Txt>
                            <Txt variant="bodyReg" color="rgba(255,255,255,0.6)" style={{ textAlign: 'center', marginBottom: 24 }}>
                                The merchant has received your order. Please confirm the inventory count to begin cleaning.
                            </Txt>

                            <View style={s.itemList}>
                                {Object.entries(intakeLog.items).map(([key, val]: [string, any]) => (
                                    <View key={key} style={s.itemRow}>
                                        <Txt variant="bodyBold" color="#EAF3F6">{key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</Txt>
                                        <Txt variant="bodyBold" color={CYAN}>{val} units</Txt>
                                    </View>
                                ))}
                            </View>

                            <View style={s.btnRow}>
                                <TouchableOpacity style={s.rejectBtn} onPress={async () => {
                                    await supabase.from('orders').update({ status: 'rejected' }).eq('id', orderId);
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                                }}>
                                    <Txt variant="bodyBold" color="#FF4D4D">REJECT</Txt>
                                </TouchableOpacity>
                                <TouchableOpacity style={s.approveBtn} onPress={async () => {
                                    await supabase.from('orders').update({ status: 'processing' }).eq('id', orderId);
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                }}>
                                    <Txt variant="bodyBold" color={SURFACE.base}>APPROVE</Txt>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
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
    },
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#EAF3F6' },
    summaryCard: {
        marginHorizontal: 20, borderRadius: 20, overflow: 'hidden',
        padding: 18, ...ghostBorder(0.1),
        backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 28, alignItems: 'center',
    },
    summaryId: { fontSize: 22, fontWeight: '900', color: CYAN, letterSpacing: 2 },
    summaryDetail: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    steps: { paddingHorizontal: 40, gap: 0 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 64 },
    connector: {
        position: 'absolute', left: 56, top: 44,
        width: 2, height: 32,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    connectorDone: { backgroundColor: '#10B981' },
    stepIconBox: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.07)',
        ...ghostBorder(),
        alignItems: 'center', justifyContent: 'center',
    },
    stepDone: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: '#10B981' },
    stepActive: { backgroundColor: CYAN, borderColor: CYAN },
    stepLabel: { flex: 1 },
    stepText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', fontWeight: '300' },
    stepTextDone: { color: '#10B981' },
    stepTextActive: { color: '#EAF3F6', fontWeight: '700' },
    ctaContainer: { padding: 20, marginTop: 'auto' },
    ctaButton: { borderRadius: 20, overflow: 'hidden', ...ghostBorder(0.3) },
    ctaGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#EAF3F6' },

    pinSection: { paddingHorizontal: 40, marginTop: 40 },
    pinCard: { padding: 24, borderRadius: 24, alignItems: 'center', ...ghostBorder(0.2), overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)' },

    approvalOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', padding: 20 },
    approvalCard: { borderRadius: 32, padding: 32, overflow: 'hidden', ...ghostBorder(0.3), backgroundColor: 'rgba(10, 10, 31, 0.8)' },
    itemList: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 32 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    btnRow: { flexDirection: 'row', gap: 12 },
    rejectBtn: { flex: 1, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,77,77,0.1)', ...ghostBorder(0.2) },
    approveBtn: { flex: 2, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: CYAN },
});
