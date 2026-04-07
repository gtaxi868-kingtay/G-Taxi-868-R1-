import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ActivityIndicator, Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';

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
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Pulse animation for active step
    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1.1, duration: 900, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
            ])
        ).start();
    }, []);

    // Fetch current order status
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                // Fetch status and intake logs
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
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();

        // Real-time subscription
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
    }, [orderId]);

    const currentStep = STATUS_STEPS.indexOf(status);

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <View style={[s.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Order Status</Text>
                <View style={{ width: 38 }} />
            </View>

            {/* Order summary card */}
            <View style={s.summaryCard}>
                <BlurView intensity={25} style={StyleSheet.absoluteFill} tint="dark" />
                <Text style={s.summaryId}>#{orderId.slice(0, 8).toUpperCase()}</Text>
                <Text style={s.summaryDetail}>
                    {service?.label}  ·  {weight} lbs  ·  ${((priceCents || 0) / 100).toFixed(2)} TTD
                </Text>
            </View>

            {/* Status steps */}
            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color="#00FFFF" />
                </View>
            ) : (
                <View style={s.steps}>
                    {STATUS_STEPS.map((step, idx) => {
                        const done = idx < currentStep;
                        const active = idx === currentStep;
                        return (
                            <View key={step} style={s.stepRow}>
                                {/* Connector line */}
                                {idx < STATUS_STEPS.length - 1 && (
                                    <View style={[s.connector, done && s.connectorDone]} />
                                )}
                                {/* Step icon */}
                                <Animated.View
                                    style={[
                                        s.stepIconBox,
                                        done && s.stepDone,
                                        active && s.stepActive,
                                        active && { transform: [{ scale: pulseAnim }] },
                                    ]}
                                >
                                    <Ionicons
                                        name={STATUS_ICONS[step] as any}
                                        size={20}
                                        color={active ? '#0A0A1F' : done ? '#10B981' : 'rgba(255,255,255,0.3)'}
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

            {/* --- NEW: PIN HUD (Truth Layer) --- */}
            {status === 'pending' && pins && (
                <View style={s.pinSection}>
                    <BlurView intensity={20} tint="dark" style={s.pinCard}>
                        <Txt variant="caption" color="rgba(255,255,255,0.4)">PICKUP PIN</Txt>
                        <Txt variant="headingL" color="#00FFFF" style={{ letterSpacing: 8 }}>{pins.pickup_pin}</Txt>
                        <Txt variant="small" color="rgba(255,255,255,0.4)" style={{ textAlign: 'center', marginTop: 8 }}>
                            Give this 4-digit code to the driver upon arrival.
                        </Txt>
                    </BlurView>
                </View>
            )}

            {/* --- NEW: INTAKE APPROVAL MODAL --- */}
            {status === 'awaiting_approval' && intakeLog && (
                <View style={StyleSheet.absoluteFill}>
                    <BlurView intensity={100} tint="dark" style={s.approvalOverlay}>
                        <View style={s.approvalCard}>
                            <LinearGradient colors={['rgba(124, 58, 237, 0.2)', 'rgba(0, 255, 255, 0.1)']} style={StyleSheet.absoluteFill} />
                            <Ionicons name="shield-checkmark" size={44} color="#00FFFF" style={{ alignSelf: 'center', marginBottom: 16 }} />
                            <Txt variant="headingM" color="#FFF" style={{ textAlign: 'center' }}>Verify Your Items</Txt>
                            <Txt variant="bodyReg" color="rgba(255,255,255,0.6)" style={{ textAlign: 'center', marginBottom: 24 }}>
                                The merchant has received your order. Please confirm the inventory count to begin cleaning.
                            </Txt>

                            <View style={s.itemList}>
                                {Object.entries(intakeLog.items).map(([key, val]: [string, any]) => (
                                    <View key={key} style={s.itemRow}>
                                        <Txt variant="bodyBold" color="#FFF">{key.toUpperCase()}</Txt>
                                        <Txt variant="bodyBold" color="#00FFFF">{val} units</Txt>
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
                                    <Txt variant="bodyBold" color="#0A0A1F">APPROVE</Txt>
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
                        colors={['rgba(123,97,255,0.3)', 'rgba(0,255,255,0.1)']}
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
    headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
    summaryCard: {
        marginHorizontal: 20, borderRadius: 20, overflow: 'hidden',
        padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 28, alignItems: 'center',
    },
    summaryId: { fontSize: 22, fontWeight: '900', color: '#00FFFF', letterSpacing: 2 },
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
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center', justifyContent: 'center',
    },
    stepDone: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: '#10B981' },
    stepActive: { backgroundColor: '#00FFFF', borderColor: '#00FFFF' },
    stepLabel: { flex: 1 },
    stepText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', fontWeight: '300' },
    stepTextDone: { color: '#10B981' },
    stepTextActive: { color: '#FFF', fontWeight: '700' },
    ctaContainer: { padding: 20, marginTop: 'auto' },
    ctaButton: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(123,97,255,0.3)' },
    ctaGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#FFF' },

    pinSection: { paddingHorizontal: 40, marginTop: 40 },
    pinCard: { padding: 24, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,255,255,0.2)', overflow: 'hidden' },

    approvalOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', padding: 20 },
    approvalCard: { borderRadius: 32, padding: 32, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,255,255,0.3)', backgroundColor: 'rgba(10, 10, 31, 0.8)' },
    itemList: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 20, marginBottom: 32 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    btnRow: { flexDirection: 'row', gap: 12 },
    rejectBtn: { flex: 1, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,77,77,0.1)', borderWidth: 1, borderColor: 'rgba(255,77,77,0.2)' },
    approveBtn: { flex: 2, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00FFFF' },
});
