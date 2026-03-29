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
                const { data, error } = await supabase
                    .from('orders')
                    .select('status')
                    .eq('id', orderId)
                    .single();
                if (error) throw error;
                if (data?.status) setStatus(data.status);
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
                                        color={active ? '#0A0A1F' : done ? '#4ADE80' : 'rgba(255,255,255,0.3)'}
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
    connectorDone: { backgroundColor: '#4ADE80' },
    stepIconBox: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.07)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center', justifyContent: 'center',
    },
    stepDone: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: '#4ADE80' },
    stepActive: { backgroundColor: '#00FFFF', borderColor: '#00FFFF' },
    stepLabel: { flex: 1 },
    stepText: { fontSize: 15, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },
    stepTextDone: { color: '#4ADE80' },
    stepTextActive: { color: '#FFF', fontWeight: '700' },
    ctaContainer: { padding: 20, marginTop: 'auto' },
    ctaButton: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(123,97,255,0.3)' },
    ctaGradient: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
