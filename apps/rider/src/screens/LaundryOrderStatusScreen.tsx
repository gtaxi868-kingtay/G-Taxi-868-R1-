import React, { useEffect, useState } from 'react';
import { View, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, GUTTER, Loading, RADIUS, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

const STATUS_STEPS = ['pending', 'picked_up', 'processing', 'ready', 'delivered'];
// Real order statuses mapped onto these steps: dispatch/driver steps use the
// shared order vocabulary (process_stop_arrival -> out_for_delivery).
const STEP_ALIAS: Record<string, string> = {
    confirmed: 'pending',
    out_for_delivery: 'picked_up',
    preparing: 'processing',
    ready_for_pickup: 'ready',
};
const STATUS_LABELS: Record<string, string> = {
    pending: 'Order confirmed',
    picked_up: 'Picked up',
    processing: 'Being cleaned',
    ready: 'Ready to bring back',
    delivered: 'Delivered',
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

    // APPROVE / REJECT on "Verify your items". Goes through
    // rider_answer_item_check: the rider may not write orders directly
    // (a direct update here used to be refused silently).
    const answerItemCheck = async (approve: boolean) => {
        const { data, error } = await supabase.rpc('rider_answer_item_check', {
            p_order_id: orderId,
            p_approve: approve,
        });
        if (error || !data?.success) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            toast(data?.error || error?.message || 'Could not send your answer. Please try again.', 'error');
            return;
        }
        setStatus(data.status);
        Haptics.notificationAsync(approve
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning);
    };
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
            // Re-read once live: a status change in the channel's first
            // seconds would otherwise not show until the next one.
            .subscribe((st: string) => { if (st === 'SUBSCRIBED') fetchStatus(); });

        return () => { channel.unsubscribe(); };
    }, [orderId, retryKey]);

    const currentStep = STATUS_STEPS.indexOf(STEP_ALIAS[status] ?? status);

    const m = useTheme();
    const summary = [service?.label, weight ? `${weight} lbs` : null, priceCents ? `$${(priceCents / 100).toFixed(2)} TTD` : null].filter(Boolean).join(' · ');

    return (
        <Screen title="Your laundry" onBack={() => navigation.goBack()}
            footer={<Button title="Back to home" variant="secondary" onPress={() => { Haptics.selectionAsync(); navigation.navigate('Home'); }} />}>
            <Card style={{ marginTop: SPACE.sm }}>
                <Txt variant="headline">Order #{orderId.slice(0, 8).toUpperCase()}</Txt>
                {summary ? <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>{summary}</Txt> : null}
            </Card>

            {status === 'pending' && pins?.pickup_pin && (
                <Card style={{ marginTop: SPACE.md, alignItems: 'center' }}>
                    <Txt variant="overline" tone="faint">PICKUP PIN</Txt>
                    <Txt variant="hero" tone="accent" style={{ letterSpacing: 8, marginTop: SPACE.xs }}>{pins.pickup_pin}</Txt>
                    <Txt variant="caption" tone="dim" style={{ textAlign: 'center' }}>Give this code to the driver when they arrive.</Txt>
                </Card>
            )}

            <Section title="Progress">
                {loading ? <Loading /> : fetchError ? (
                    <EmptyState icon="cloud-offline-outline" title="Could not load your order" body="Check your connection and try again."
                        action={<Button title="Try again" variant="secondary" onPress={() => { setLoading(true); setRetryKey(k => k + 1); }} />} />
                ) : (
                    <Card>
                        {STATUS_STEPS.map((step, idx) => {
                            const done = idx < currentStep;
                            const active = idx === currentStep;
                            return (
                                <View key={step} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ alignItems: 'center', width: 36 }}>
                                        <Animated.View style={[{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                                            backgroundColor: active ? '#8B7CFF' : done ? 'rgba(47,181,124,0.16)' : m.field }, active && pulseStyle]}>
                                            <Ionicons name={(done ? 'checkmark' : STATUS_ICONS[step]) as any} size={16} color={active ? '#FFFFFF' : done ? '#2FB57C' : m.faint} />
                                        </Animated.View>
                                        {idx < STATUS_STEPS.length - 1 && <View style={{ width: 2, height: 18, backgroundColor: done ? '#2FB57C' : m.chipBorder }} />}
                                    </View>
                                    <Txt variant={active ? 'bodyStrong' : 'body'} tone={active || done ? 'ink' : 'faint'} style={{ marginLeft: SPACE.md, marginBottom: idx < STATUS_STEPS.length - 1 ? 18 : 0 }}>
                                        {STATUS_LABELS[step]}
                                    </Txt>
                                </View>
                            );
                        })}
                    </Card>
                )}
            </Section>

            <Modal visible={status === 'awaiting_approval' && !!intakeLog} transparent animationType="slide">
                <View style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">Check your items</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.md }}>The shop counted your laundry. Confirm so they can start cleaning.</Txt>
                        <Card style={{ paddingVertical: SPACE.xs }}>
                            {Object.entries(intakeLog?.items || {}).map(([key, val]: [string, any], i, arr) => (
                                <Row key={key} title={key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')} last={i === arr.length - 1}
                                    right={<Txt variant="bodyStrong" tone="accent">{val}</Txt>} />
                            ))}
                        </Card>
                        <View style={{ flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.xl }}>
                            <Button title="Something's wrong" variant="secondary" style={{ flex: 1 }} onPress={() => answerItemCheck(false)} />
                            <Button title="Looks right" style={{ flex: 1 }} onPress={() => answerItemCheck(true)} />
                        </View>
                    </View>
                </View>
            </Modal>
        </Screen>
    );
}
