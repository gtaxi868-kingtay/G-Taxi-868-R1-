import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';

const DRIVER_SHARE = 0.81;

interface RideDetail {
    pickup_address: string | null;
    total_fare_cents: number | null;
    payment_method: string | null;
}

function paymentLabel(method: string | null): string {
    if (method === 'card') return 'Card';
    if (method === 'wallet') return 'Wallet';
    return 'Cash';
}

function paymentIcon(method: string | null): string {
    if (method === 'card') return '💳';
    if (method === 'wallet') return '👛';
    return '💵';
}

export function TripRequestScreen({ navigation, route }: any) {
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();
    const [timeLeft, setTimeLeft] = useState(15);
    const [isHandling, setIsHandling] = useState(false);
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);

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
                if (data && !error) setRideDetail(data);
                setDetailLoading(false);
            });
    }, [offer?.ride_id]);

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
        await declineRide(offer.id);
        navigation.goBack();
    };

    const distanceKm = offer?.distance_meters ? (offer.distance_meters / 1000).toFixed(1) : '?';
    const driverEarningsCents = rideDetail?.total_fare_cents
        ? Math.round(rideDetail.total_fare_cents * DRIVER_SHARE)
        : offer?.fare_cents ? Math.round(offer.fare_cents * DRIVER_SHARE) : null;
    const fareDisplay = driverEarningsCents !== null ? `$${(driverEarningsCents / 100).toFixed(2)} TTD` : null;

    const timerColor = timeLeft > 8 ? tokens.colors.primary.cyan : timeLeft > 4 ? tokens.colors.status.warning : tokens.colors.status.error;

    return (
        <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
            <Card style={styles.card} padding="xl" elevation="level3" radius="xl">
                <View style={[styles.timerRing, { borderColor: timerColor }]}>
                    <Txt variant="headingL" weight="bold" color={timerColor}>{timeLeft}s</Txt>
                </View>

                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={styles.title}>
                    New Trip Request
                </Txt>

                <View style={styles.detailsContainer}>
                    {detailLoading ? (
                        <ActivityIndicator color={tokens.colors.primary.purple} style={{ marginVertical: 16 }} />
                    ) : (
                        <>
                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>📍</Txt>
                                <View style={{ flex: 1 }}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>PICKUP</Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={2}>
                                        {rideDetail?.pickup_address || 'Address unavailable'}
                                    </Txt>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>📏</Txt>
                                <View>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>DISTANCE</Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>{distanceKm} km away</Txt>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            {fareDisplay && (
                                <>
                                    <View style={styles.detailRow}>
                                        <Txt style={styles.detailIcon}>💰</Txt>
                                        <View>
                                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>YOUR EARNINGS (81%)</Txt>
                                            <Txt variant="headingM" weight="bold" color={tokens.colors.status.success}>{fareDisplay}</Txt>
                                        </View>
                                    </View>
                                    <View style={styles.divider} />
                                </>
                            )}

                            <View style={styles.detailRow}>
                                <Txt style={styles.detailIcon}>{paymentIcon(rideDetail?.payment_method ?? null)}</Txt>
                                <View>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>PAYMENT</Txt>
                                    <Txt variant="bodyBold" color={tokens.colors.text.primary}>{paymentLabel(rideDetail?.payment_method ?? null)}</Txt>
                                </View>
                            </View>
                        </>
                    )}
                </View>

                <View style={styles.actions}>
                    <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => handleDecline(false)} disabled={isHandling}>
                        <Txt variant="bodyBold" weight="bold" color={tokens.colors.text.primary}>Decline</Txt>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={handleAccept} disabled={isHandling}>
                        <Txt variant="headingM" weight="bold" color={tokens.colors.background.base}>
                            {isHandling ? '...' : 'ACCEPT'}
                        </Txt>
                    </TouchableOpacity>
                </View>
            </Card>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', paddingHorizontal: 20 },
    card: { alignItems: 'center', backgroundColor: tokens.colors.background.ambient },
    timerRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    title: { marginBottom: 24 },
    detailsContainer: { width: '100%', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: tokens.colors.border.subtle, paddingVertical: 4, marginBottom: 28 },
    detailRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    detailIcon: { fontSize: 20, marginTop: 2 },
    divider: { height: 1, backgroundColor: tokens.colors.border.subtle, marginHorizontal: 16 },
    actions: { flexDirection: 'row', gap: 14, width: '100%' },
    btn: { flex: 1, paddingVertical: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    acceptBtn: { backgroundColor: tokens.colors.primary.cyan, flex: 2 },
    declineBtn: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: tokens.colors.border.subtle },
});
