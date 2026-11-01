import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { Button, Card, Divider, EmptyState, Loading, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps } from '../navigation/types';

interface RideData {
    id: string;
    created_at: string;
    total_fare_cents: number;
    wait_fare_cents?: number;
    distance_meters: number;
    duration_seconds: number;
    pickup_address: string;
    dropoff_address: string;
    wallet_deduction_cents?: number;
    cash_payment_cents?: number;
    payment_status?: string | null;
    payment_method?: string | null;
}

const RECEIPT_COLUMNS =
    'id, created_at, total_fare_cents, wait_fare_cents, distance_meters, duration_seconds, ' +
    'pickup_address, dropoff_address, wallet_deduction_cents, cash_payment_cents, ' +
    'payment_status, payment_method';

/**
 * The receipt must never assert an outcome the database hasn't confirmed.
 * Values come from the live payment_status_enum:
 *   pending | authorized | captured | failed | refunded | confirmed | receipt_sent
 * Anything unrecognised falls through to a neutral, non-committal label rather
 * than claiming success.
 */
function paymentPresentation(ride: RideData) {
    const status = (ride.payment_status ?? '').toLowerCase();
    const method = (ride.payment_method ?? '').toLowerCase();

    switch (status) {
        case 'captured':
        case 'confirmed':
        case 'receipt_sent':
            return { label: 'Paid', tone: '#2FB57C', icon: 'checkmark' as const, note: null };
        case 'failed':
            return {
                label: 'Payment failed',
                tone: '#E5484D',
                icon: 'close' as const,
                note: 'This payment did not go through. Please try another payment method or contact support.',
            };
        case 'refunded':
            return { label: 'Refunded', tone: '#D97706', icon: 'return-down-back' as const, note: 'This trip was refunded.' };
        case 'authorized':
            return {
                label: 'Card authorised',
                tone: '#D97706',
                icon: 'time-outline' as const,
                note: 'Your card is authorized. The final amount will be captured shortly.',
            };
        case 'pending':
            return method === 'cash'
                ? { label: 'Pay your driver in cash', tone: '#D97706', icon: 'cash-outline' as const, note: 'Settle this trip directly with your driver.' }
                : { label: 'Payment pending', tone: '#D97706', icon: 'time-outline' as const, note: 'This payment has not completed yet.' };
        default:
            return { label: 'Payment status not available', tone: '#8A8296', icon: 'help-outline' as const, note: null };
    }
}

export function ReceiptScreen({ navigation, route }: AppScreenProps<'Receipt'>) {
    const { ride: initialRide, rideId } = route.params;
    const [ride, setRide] = useState<RideData | null>(initialRide || null);
    const [loading, setLoading] = useState(!initialRide);
    const [error, setError] = useState<string | null>(null);

    // A receipt is a financial record, so the database is the only acceptable
    // source for it. `initialRide` (when a caller passes one) is treated purely
    // as an instant placeholder so the screen isn't blank — we ALWAYS refetch
    // and overwrite it. Previously this effect returned early whenever a caller
    // supplied a ride object, which meant RatingScreen's hand-built object —
    // literally { pickup_address: 'Pickup Location' } and no payment_status —
    // was rendered as the real receipt.
    const effectiveRideId = rideId ?? initialRide?.id;

    useEffect(() => {
        if (!effectiveRideId) {
            setError('Unable to load ride details');
            setLoading(false);
            return;
        }

        let cancelled = false;

        const fetchRideData = async () => {
            try {
                const { data, error: fetchError } = await supabase
                    .from('rides')
                    .select(RECEIPT_COLUMNS)
                    .eq('id', effectiveRideId)
                    .single();

                if (cancelled) return;

                if (fetchError || !data) {
                    console.error('Failed to fetch ride data:', fetchError);
                    setError('Unable to load ride details');
                    setLoading(false);
                    return;
                }

                setRide(data as unknown as RideData);
                setError(null);
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                console.error('Error fetching ride:', err);
                setError('Unable to load ride details');
                setLoading(false);
            }
        };

        fetchRideData();
        return () => { cancelled = true; };
    }, [effectiveRideId]);

    const handleDone = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    };

    const m = useTheme();
    // Opened from Your trips: a back arrow returns to the list. Opened at the
    // end of a ride (the stack was reset to this screen): no back, only
    // "Back to home".
    const onBack = navigation.canGoBack() ? () => navigation.goBack() : undefined;

    if (loading) {
        return (
            <Screen scroll={false} title="Receipt" onBack={onBack}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Loading />
                    <Txt variant="body" tone="dim">Loading your receipt…</Txt>
                </View>
            </Screen>
        );
    }

    if (error || !ride) {
        return (
            <Screen title="Receipt" onBack={onBack} footer={<Button title="Back to home" onPress={handleDone} />}>
                <EmptyState icon="receipt-outline" title="We could not load this receipt" body="Check your connection, then open it again from Your Trips." />
            </Screen>
        );
    }

    const date = new Date(ride.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const payment = paymentPresentation(ride);
    const money = (c: number) => `TT$${(c / 100).toFixed(2)}`;
    const distanceKm = ride.distance_meters ? (ride.distance_meters / 1000).toFixed(1) : '—';
    const durationMin = ride.duration_seconds ? Math.round(ride.duration_seconds / 60) : '—';
    const line = (label: string, value: string, tone?: 'dim' | 'ink') => (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
            <Txt variant="body" tone={tone === 'ink' ? 'ink' : 'dim'}>{label}</Txt>
            <Txt variant="bodyStrong">{value}</Txt>
        </View>
    );

    return (
        <Screen
            title="Receipt"
            onBack={onBack}
            footer={
                <View>
                    <Button title="Back to home" onPress={handleDone} />
                    <Button title="Report a problem with this trip" variant="ghost" style={{ marginTop: SPACE.md }}
                        onPress={() => navigation.navigate('ReportProblem', { ride })} />
                </View>
            }
        >
            <View style={{ alignItems: 'center', paddingTop: SPACE.xxl }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: payment.tone + '22' }}>
                    <Ionicons name={payment.icon} size={30} color={payment.tone} />
                </View>
                <Txt variant="label" style={{ color: payment.tone, marginTop: SPACE.md }}>{payment.label}</Txt>
                <Txt variant="hero" style={{ marginTop: SPACE.xs }}>{money((ride.total_fare_cents || 0) + (ride.wait_fare_cents || 0))}</Txt>
                <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.xs }}>{dateStr} · {timeStr}</Txt>
                {payment.note ? <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>{payment.note}</Txt> : null}
            </View>

            <Card style={{ marginTop: SPACE.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#8B7CFF' }} />
                    <Txt variant="body" numberOfLines={2} style={{ flex: 1, marginLeft: SPACE.md }}>{ride.pickup_address}</Txt>
                </View>
                <View style={{ width: 2, height: 14, backgroundColor: m.chipBorder, marginLeft: 4, marginVertical: 4 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: m.key === 'day' ? '#21152E' : '#E9CFA6' }} />
                    <Txt variant="body" numberOfLines={2} style={{ flex: 1, marginLeft: SPACE.md }}>{ride.dropoff_address}</Txt>
                </View>
                <Txt variant="caption" tone="dim" style={{ marginTop: SPACE.md }}>{distanceKm} km · {durationMin} min</Txt>
            </Card>

            <Card style={{ marginTop: SPACE.md }}>
                {line('Trip fare', money(ride.total_fare_cents || 0))}
                {(ride.wait_fare_cents ?? 0) > 0 && line('Waiting time', `+${money(ride.wait_fare_cents ?? 0)}`)}
                {(ride.wallet_deduction_cents ?? 0) > 0 && line('Paid from G-Coin', `-${money(ride.wallet_deduction_cents ?? 0)}`)}
                {(ride.cash_payment_cents ?? 0) > 0 && line('Paid in cash', money(ride.cash_payment_cents ?? 0))}
                <Divider style={{ marginVertical: SPACE.sm }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                    <Txt variant="headline">Total</Txt>
                    <Txt variant="headline">{money((ride.total_fare_cents || 0) + (ride.wait_fare_cents || 0))}</Txt>
                </View>
            </Card>

            <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: SPACE.lg }}>Ride #{ride.id.slice(0, 8).toUpperCase()} · Thanks for riding with G 868</Txt>
        </Screen>
    );
}
