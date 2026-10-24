import React, { useEffect, useRef, useState } from 'react';
import { View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { cancelRide } from '../services/api';
import { toast } from '../components/Toast';
import { CancelReasonSheet } from '../components/CancelReasonSheet';
import { BrandBadge, Button, Card, Loading, RADIUS, Row, Screen, SPACE, Txt, useTheme } from '../ui/kit';
import { AppScreenProps } from '../navigation/types';

// plate/rating can be genuinely missing. Never invent them: a rider looks
// for this plate on the street, so a made-up one is a safety problem.
interface DriverInfo {
    name: string;
    vehicle: string;
    plate: string | null;
    rating: number | null;
}

export function DriverFoundScreen({ navigation, route }: AppScreenProps<'DriverFound'>) {
    const { rideId, driver: initialDriver, destination, fare } = route.params as {
        rideId: string;
        driver?: DriverInfo;
        destination?: { latitude: number; longitude: number; address: string };
        fare?: { distance_meters: number; duration_seconds: number; total_fare_cents: number; route_polyline: string };
    };

    const insets = useSafeAreaInsets();
    const scaleAnim = useRef(new Animated.Value(0.8)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;
    const [driver, setDriver] = useState<DriverInfo | null>(initialDriver || null);
    const [loading, setLoading] = useState(!initialDriver);

    useEffect(() => {
        if (initialDriver) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Animated.parallel([
                Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
                Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
            return;
        }

        const fetchDriverDetails = async () => {
            try {
                const { data: rideData, error: rideError } = await supabase
                    .from('rides')
                    .select('driver_id')
                    .eq('id', rideId)
                    .single();

                if (rideError || !rideData?.driver_id) {
                    console.error('Failed to fetch ride driver_id:', rideError);
                    navigation.replace('ActiveRide', { rideId, destination, fare });
                    return;
                }

                const { data: driverData, error: driverError } = await supabase
                    .from('drivers')
                    // Real drivers columns. This used to select first_name /
                    // last_name / vehicle_plate, which do not exist (verified
                    // against the live table 2026-10-14), so the query always
                    // failed and this screen silently skipped to ActiveRide.
                    .select('id, name, vehicle_model, vehicle_type, plate_number, rating')
                    .eq('id', rideData.driver_id)
                    .single();

                if (driverError || !driverData) {
                    console.error('Failed to fetch driver details:', driverError);
                    navigation.replace('ActiveRide', { rideId, destination, fare });
                    return;
                }

                setDriver({
                    name: driverData.name?.trim() || 'Your driver',
                    vehicle: driverData.vehicle_model || driverData.vehicle_type || 'Vehicle',
                    plate: driverData.plate_number || null,
                    rating: typeof driverData.rating === 'number' && driverData.rating > 0 ? driverData.rating : null,
                });
                setLoading(false);

                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Animated.parallel([
                    Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
                    Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
                ]).start();
            } catch (err) {
                console.error('Error fetching driver details:', err);
                navigation.replace('ActiveRide', { rideId, destination, fare });
            }
        };

        fetchDriverDetails();
    }, [rideId, initialDriver]);

    const handleTrack = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        navigation.replace('ActiveRide', {
            rideId,
            destination,
            fare,
        });
    };

    const m = useTheme();
    const [reasonOpen, setReasonOpen] = useState(false);
    const [canceling, setCanceling] = useState(false);

    // Cancel here used to only go back to Home, leaving the ride live and the
    // driver still on the way. It now cancels the ride for real.
    const handleCancel = async (reasonCode: string | null) => {
        if (canceling) return;
        setCanceling(true);
        setReasonOpen(false);
        const res = await cancelRide(rideId, reasonCode);
        setCanceling(false);
        if (!res?.success) {
            toast(res?.error || 'Could not cancel. Please try again.', 'error');
            return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toast('Ride cancelled');
        navigation.reset({ index: 0, routes: [{ name: 'Home' as never }] } as any);
    };

    if (loading) {
        return (
            <Screen scroll={false}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Loading />
                    <Txt variant="body" tone="dim">Getting your driver's details…</Txt>
                </View>
            </Screen>
        );
    }

    return (
        <Screen
            scroll
            footer={
                <View>
                    <Button title="Track my ride" icon="navigate-outline" onPress={handleTrack} />
                    <Button title="Cancel ride" variant="ghost" style={{ marginTop: SPACE.md }} loading={canceling} onPress={() => setReasonOpen(true)} />
                </View>
            }
        >
            <Animated.View style={{ alignItems: 'center', paddingTop: insets.top + SPACE.xxl, opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
                <View>
                    <BrandBadge icon="car-sport" size={104} round />
                    <View style={{ position: 'absolute', bottom: -4, right: -8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.sm, paddingVertical: 4, borderRadius: RADIUS.pill, backgroundColor: m.sheet[1], borderWidth: 1, borderColor: m.chipBorder }}>
                        <Ionicons name="star" size={12} color="#F5A524" />
                        <Txt variant="label" style={{ marginLeft: 4 }}>{driver?.rating != null ? driver.rating.toFixed(1) : 'New'}</Txt>
                    </View>
                </View>
                <Txt variant="label" tone="accent" style={{ marginTop: SPACE.xl }}>Your driver is on the way</Txt>
                <Txt variant="hero" style={{ textAlign: 'center', marginTop: SPACE.xs }}>{driver?.name ?? 'Your driver'}</Txt>
            </Animated.View>

            <Card style={{ marginTop: SPACE.xl, paddingVertical: SPACE.xs }}>
                <Row icon="car-outline" title={driver?.vehicle ?? 'Vehicle'} subtitle="Vehicle" />
                <Row icon="pricetag-outline" title={driver?.plate ?? 'Plate not on file'} subtitle={driver?.plate ? 'Check this plate before you get in' : 'Confirm the plate with your driver'} />
                <Row icon="receipt-outline" title={`#${rideId?.slice(0, 8).toUpperCase()}`} subtitle="Ride reference" last />
            </Card>

            <CancelReasonSheet visible={reasonOpen} onPick={handleCancel} onClose={() => setReasonOpen(false)} />
        </Screen>
    );
}
