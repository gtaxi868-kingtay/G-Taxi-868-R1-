import React, { useEffect, useState, useRef } from 'react';
import { View, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Card, EmptyState, GUTTER, Loading, RADIUS, Row, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';

// Real order vocabulary: merchant app moves pending -> confirmed ->
// preparing -> ready_for_pickup; the driver's stops (process_stop_arrival)
// move it to out_for_delivery, then delivered.
const STATUS_STEPS = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered'];
// Older/side statuses shown at the nearest real step.
const STEP_ALIAS: Record<string, string> = {
    awaiting_approval: 'confirmed',
    processing: 'preparing',
    handed_off: 'out_for_delivery',
    in_delivery: 'out_for_delivery',
};
const STATUS_LABELS: Record<string, string> = {
    pending: 'Order placed',
    confirmed: 'Accepted',
    preparing: 'Being prepared',
    ready_for_pickup: 'Ready for pickup',
    out_for_delivery: 'On the way',
    delivered: 'Delivered',
};
const STATUS_ICONS: Record<string, string> = {
    pending: 'hourglass-outline',
    confirmed: 'checkmark-circle-outline',
    preparing: 'refresh-circle-outline',
    ready_for_pickup: 'bag-handle-outline',
    out_for_delivery: 'car-outline',
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
            // Re-read once live: a status change in the channel's first
            // seconds would otherwise not show until the next one.
            .subscribe((st: string) => { if (st === 'SUBSCRIBED') fetchStatus(); });

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

    const currentStep = STATUS_STEPS.indexOf(STEP_ALIAS[status] ?? status);
    const isPending = status === 'pending';
    const hasDriver = !!driverId;

    const mapRegion = merchantLocation ? {
        ...merchantLocation,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
    } : DEFAULT_REGION;

    const m = useTheme();
    const summary = [service?.label, weight ? `${weight} lbs` : null, priceCents ? `$${(priceCents / 100).toFixed(2)} TTD` : null].filter(Boolean).join(' · ');
    const payNote = paymentMethod === 'cash' && paymentStatus === 'cash_on_delivery' ? { icon: 'cash-outline', text: 'Pay in cash on delivery', color: '#D97706' }
        : paymentStatus === 'paid' ? { icon: 'checkmark-circle', text: 'Paid', color: '#2FB57C' }
        : paymentStatus === 'unpaid' && paymentMethod === 'card' ? { icon: 'time-outline', text: 'Payment pending', color: m.faint }
        : null;

    return (
        <Screen title="Your order" onBack={() => navigation.goBack()}
            footer={<Button title="Back to home" variant="secondary" onPress={() => { Haptics.selectionAsync(); navigation.navigate('Home', { screen: 'Map' }); }} />}>
            <View style={{ height: 200, borderRadius: RADIUS.card, overflow: 'hidden', marginTop: SPACE.sm }}>
                <MapView ref={mapRef} style={{ flex: 1 }} provider={PROVIDER_DEFAULT} initialRegion={mapRegion} userInterfaceStyle={m.key === 'night' ? 'dark' : 'light'}>
                    {merchantLocation && <Marker coordinate={merchantLocation} title="Shop" pinColor="#F5A524" />}
                    {driverLocation && <Marker coordinate={driverLocation} title="Driver" pinColor="#8B7CFF" />}
                </MapView>
                <View style={{ position: 'absolute', left: SPACE.md, top: SPACE.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.md, height: 32, borderRadius: 16, backgroundColor: m.sheet[1] }}>
                    <Ionicons name={hasDriver ? 'car' : 'radio-outline'} size={14} color={m.accent} />
                    <Txt variant="label" style={{ marginLeft: 6 }}>{hasDriver ? 'Driver assigned' : isPending ? 'Finding a driver' : 'Preparing your order'}</Txt>
                </View>
            </View>

            <Card style={{ marginTop: SPACE.md }}>
                <Txt variant="headline">Order #{orderId.slice(0, 8).toUpperCase()}</Txt>
                {summary ? <Txt variant="caption" tone="dim" style={{ marginTop: 2 }}>{summary}</Txt> : null}
                {payNote && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.sm }}>
                        <Ionicons name={payNote.icon as any} size={14} color={payNote.color} />
                        <Txt variant="label" style={{ marginLeft: 6, color: payNote.color }}>{payNote.text}</Txt>
                    </View>
                )}
            </Card>

            {(status === 'pending' || status === 'confirmed') && pins?.pickup_pin && (
                <Card style={{ marginTop: SPACE.md, alignItems: 'center' }}>
                    <Txt variant="overline" tone="faint">PICKUP PIN</Txt>
                    <Txt variant="hero" tone="accent" style={{ letterSpacing: 8, marginTop: SPACE.xs }}>{pins.pickup_pin}</Txt>
                    <Txt variant="caption" tone="dim" style={{ textAlign: 'center' }}>Give this code to the driver at pickup.</Txt>
                </Card>
            )}

            {status === 'cancelled' && (
                <Card style={{ marginTop: SPACE.md, borderColor: '#E5484D' }}>
                    <Txt variant="bodyStrong" tone="danger">This order was cancelled.</Txt>
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
                                        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                                            backgroundColor: active ? '#8B7CFF' : done ? 'rgba(47,181,124,0.16)' : m.field }}>
                                            <Ionicons name={(done ? 'checkmark' : STATUS_ICONS[step]) as any} size={16} color={active ? '#FFFFFF' : done ? '#2FB57C' : m.faint} />
                                        </View>
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

            {/* The shop checked your items: confirm before they prepare it */}
            <Modal visible={status === 'awaiting_approval' && !!intakeLog} transparent animationType="slide">
                <View style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">Check your items</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs, marginBottom: SPACE.md }}>The shop has your order. Confirm these items so they can start.</Txt>
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
