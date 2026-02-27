import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';

// ── Locked commission rule ─────────────────────────────────────────────────
// Driver's share as displayed on the request card = 81% of total fare.
// Rider-facing fare is total_fare_cents; driver sees their net take.
const DRIVER_SHARE = 0.81;

interface RideDetail {
    pickup_address: string | null;
    total_fare_cents: number | null;
    payment_method: string | null;
}

function paymentIcon(method: string | null): string {
    if (method === 'card') return '💳';
    if (method === 'wallet') return '👛';
    return '💵';
}

function paymentLabel(method: string | null): string {
    if (method === 'card') return 'Card';
    if (method === 'wallet') return 'Wallet';
    return 'Cash';
}

export function TripRequestScreen({ navigation, route }: any) {
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();
    const [timeLeft, setTimeLeft] = useState(15);
    const [isHandling, setIsHandling] = useState(false);

    // Ride detail state — fetched after mount
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);

    // Fetch pickup address, fare, and payment method from ride row
    useEffect(() => {
        if (!offer?.ride_id) {
            setDetailLoading(false);
            return;
        }

        supabase
            .from('rides')
            .select('pickup_address, total_fare_cents, payment_method')
            .eq('id', offer.ride_id)
            .single()
            .then(({ data, error }) => {
                if (data && !error) {
                    setRideDetail(data);
                }
                setDetailLoading(false);
            });
    }, [offer?.ride_id]);

    // 15-second auto-decline timer
    useEffect(() => {
        if (timeLeft <= 0) {
            if (!isHandling) handleDecline(true);
            return;
        }
        const timer = setTimeout(() => setTimeLeft(l => l - 1), 1000);
        return () => clearTimeout(timer);
    }, [timeLeft, isHandling]);

    const handleAccept = async () => {
        if (!offer || !driver || isHandling) return;
        setIsHandling(true);

        console.log('Accepting offer:', offer.id);
        const { error } = await acceptRide(offer.ride_id, driver.id);

        if (error) {
            alert('Offer expired or no longer available.');
            navigation.goBack();
        } else {
            navigation.replace('ActiveTrip', { rideId: offer.ride_id });
        }
    };

    const handleDecline = async (auto = false) => {
        if (!offer || isHandling) return;
        setIsHandling(true);
        console.log(auto ? 'Auto-declining offer' : 'Manually declining offer');
        await declineRide(offer.id);
        navigation.goBack();
    };

    // Derived display values
    const distanceKm = offer?.distance_meters
        ? (offer.distance_meters / 1000).toFixed(1)
        : '?';

    const driverEarningsCents = rideDetail?.total_fare_cents
        ? Math.round(rideDetail.total_fare_cents * DRIVER_SHARE)
        : null;

    const fareDisplay = driverEarningsCents !== null
        ? `$${(driverEarningsCents / 100).toFixed(2)} TTD`
        : offer?.fare_cents
            ? `$${((offer.fare_cents * DRIVER_SHARE) / 100).toFixed(2)} TTD`
            : null;

    // Timer ring colour transitions red as time runs out
    const timerColor = timeLeft > 8
        ? tokens.colors.primary.cyan
        : timeLeft > 4
            ? tokens.colors.status.warning
            : tokens.colors.status.error;

    return (
        <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
            <Surface style={styles.card} intensity={60}>

                {/* Timer Ring */}
                <View style={[styles.timerRing, { borderColor: timerColor }]}>
                    <Txt variant="headingL" weight="bold" color={timerColor}>{timeLeft}s</Txt>
                </View>

                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={styles.title}>
                    New Trip Request!
                </Txt>

                {/* Detail rows */}
                <View style={styles.detailsContainer}>
                    {detailLoading ? (
                        <ActivityIndicator color={tokens.colors.primary.purple} style={{ marginVertical: 16 }} />
                    ) : (
                        <>
                            {/* Pickup address */}
                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>📍</Txt>
                                <View style={{ flex: 1 }}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                                        PICKUP
                                    </Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={2}>
                                        {rideDetail?.pickup_address || 'Address unavailable'}
                                    </Txt>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            {/* Distance */}
                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>📏</Txt>
                                <View>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                                        DISTANCE
                                    </Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>
                                        {distanceKm} km away
                                    </Txt>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            {/* Fare */}
                            {fareDisplay && (
                                <>
                                    <View style={styles.detailRow}>
                                        <Txt style={styles.detailIcon}>💰</Txt>
                                        <View>
                                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                                                YOUR EARNINGS (81%)
                                            </Txt>
                                            <Txt variant="headingM" weight="bold" color={tokens.colors.status.success}>
                                                {fareDisplay}
                                            </Txt>
                                        </View>
                                    </View>

                                    <View style={styles.divider} />
                                </>
                            )}

                            {/* Payment method */}
                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>
                                    {paymentIcon(rideDetail?.payment_method ?? null)}
                                </Txt>
                                <View>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>
                                        PAYMENT
                                    </Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>
                                        {paymentLabel(rideDetail?.payment_method ?? null)}
                                    </Txt>
                                </View>
                            </View>
                        </>
                    )}
                </View>

                {/* Action Buttons */}
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.btn, styles.declineBtn]}
                        onPress={() => handleDecline(false)}
                        disabled={isHandling}
                    >
                        <Txt variant="bodyBold" weight="bold" color={tokens.colors.text.primary}>Decline</Txt>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.btn, styles.acceptBtn]}
                        onPress={handleAccept}
                        disabled={isHandling}
                    >
                        <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                            {isHandling ? '...' : 'ACCEPT'}
                        </Txt>
                    </TouchableOpacity>
                </View>

            </Surface>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    card: {
        borderRadius: 28,
        padding: 32,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    timerRing: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 4,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        marginBottom: 24,
    },
    detailsContainer: {
        width: '100%',
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
        paddingVertical: 4,
        marginBottom: 28,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    detailIcon: {
        fontSize: 20,
        marginTop: 2,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        marginHorizontal: 16,
    },
    actions: {
        flexDirection: 'row',
        gap: 14,
        width: '100%',
    },
    btn: {
        flex: 1,
        paddingVertical: 18,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    acceptBtn: {
        backgroundColor: tokens.colors.primary.cyan,
        flex: 2,
    },
    declineBtn: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: tokens.colors.status.error,
    },
});
