import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Animated, useWindowDimensions, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';
import { cancelRide } from '../services/api';
import { useRide } from '../context/RideContext';

// plate/rating can be genuinely missing. Never invent them: a rider looks
// for this plate on the street, so a made-up one is a safety problem.
interface DriverInfo {
    name: string;
    vehicle: string;
    plate: string | null;
    rating: number | null;
}

export function DriverFoundScreen({ navigation, route }: AppScreenProps<'DriverFound'>) {
    const { width } = useWindowDimensions();
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
    const { clearActiveRide } = useRide();
    const [cancelling, setCancelling] = useState(false);

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

    // This button used to only navigate Home: the ride stayed assigned on
    // the server, the driver kept driving to the pickup, and the rider
    // believed the trip was cancelled. Cancel for real — server first,
    // and only leave once the server confirms.
    const handleCancel = () => {
        if (cancelling) return;
        Alert.alert(
            'Cancel this ride?',
            'Your driver is on the way to you. Cancelling is free for the first 10 minutes after they accept.',
            [
                { text: 'Keep my ride', style: 'cancel' },
                {
                    text: 'Cancel ride',
                    style: 'destructive',
                    onPress: async () => {
                        setCancelling(true);
                        const res = await cancelRide(rideId);
                        if (!res.success) {
                            setCancelling(false);
                            Alert.alert('Could not cancel', 'Your ride is still active. Check your signal and try again.');
                            return;
                        }
                        clearActiveRide();
                        (navigation as any).reset({ index: 0, routes: [{ name: 'Home' }] });
                        setTimeout(() => Alert.alert('Ride Cancelled', 'Your ride has been cancelled.'), 400);
                    },
                },
            ]
        );
    };

    if (loading) {
        return (
            <LinearGradient colors={['#1A0533', '#0D1B4B']} style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color="#00E5FF" />
                <Text style={{ color: 'rgba(255,255,255,0.6)', marginTop: 16, fontSize: 16 }}>Finding your driver...</Text>
            </LinearGradient>
        );
    }


    return (
        <LinearGradient colors={['#1A0533', '#0D1B4B']} style={s.container}>
            <Animated.View style={[s.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
                <View style={s.avatarContainer}>
                    <View style={s.avatarGlow} />
                    <View style={s.avatar}>
                        <Ionicons name="car-sport-outline" size={36} color="#EAF3F6" />
                    </View>
                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={12} color="#F59E0B" />
                        <Text style={s.ratingText}>{driver?.rating != null ? driver.rating.toFixed(1) : 'New'}</Text>
                    </View>
                </View>

                <Text style={s.matchedTitle}>Driver Found!</Text>
                <Text style={s.driverName}>{driver?.name ?? 'Your driver'}</Text>

                <View style={s.infoCard}>
                    <View style={[glassSurface(30), StyleSheet.absoluteFillObject]} />
                    <View style={s.infoRow}>
                        <Ionicons name="car-outline" size={18} color="#00E5FF" />
                        <Text style={s.infoText}>{driver?.vehicle ?? 'Vehicle'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="card-outline" size={18} color="#00E5FF" />
                        <Text style={s.infoText}>{driver?.plate ?? 'Plate not on file. Confirm with your driver'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={18} color="#10B981" />
                        <Text style={[s.infoText, { color: '#10B981' }]}>On the way to you...</Text>
                    </View>
                </View>

                <Text style={s.rideId}>Ride Reference: #{rideId?.slice(0, 8).toUpperCase()}</Text>
            </Animated.View>

            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 24 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleTrack} activeOpacity={0.88}>
                    <LinearGradient
                        colors={[VOICES.rider.accent, '#00E5FF']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="navigate-outline" size={22} color="#EAF3F6" style={{ marginRight: 10 }} />
                        <Text style={s.ctaText}>Track My Ride →</Text>
                    </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                    style={s.cancelBtn}
                    disabled={cancelling}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        handleCancel();
                    }}
                >
                    <Text style={s.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel'}</Text>
                </TouchableOpacity>
            </View>
        </LinearGradient>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center' },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    avatarContainer: { position: 'relative', marginBottom: 24 },
    avatarGlow: {
        position: 'absolute', width: 160, height: 160, borderRadius: 80,
        backgroundColor: 'rgba(0,229,255,0.1)',
        shadowColor: '#00E5FF', shadowOpacity: 0.5, shadowRadius: 30, elevation: 0,
        top: -20, left: -20,
    },
    avatar: {
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(123,92,240,0.2)',
        borderColor: '#00E5FF',
        alignItems: 'center', justifyContent: 'center',
        ...elevationGlow(4),
    },
    avatarEmoji: { fontSize: 56 },
    ratingBadge: {
        position: 'absolute', bottom: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: SURFACE.base, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
        ...ghostBorder(),
    },
    ratingText: { fontSize: 12, fontWeight: '700', color: '#F59E0B' },
    matchedTitle: {
        fontSize: 14, fontWeight: '800', color: '#00E5FF',
        letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
    },
    driverName: { fontSize: 38, color: '#EAF3F6', marginBottom: 28, fontFamily: 'CormorantGaramond_600SemiBold' },
    infoCard: {
        width: '100%', borderRadius: 24, overflow: 'hidden',
        ...ghostBorder(),
        padding: 6, backgroundColor: 'rgba(255,255,255,0.03)',
        marginBottom: 20,
    },
    infoRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 18, paddingVertical: 14,
    },
    infoText: { fontSize: 16, color: '#EAF3F6', fontWeight: '600' },
    divider: { height: 1, backgroundColor: 'rgba(123,92,240,0.3)', marginHorizontal: 18 },
    rideId: { fontSize: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 },
    ctaContainer: { paddingHorizontal: 24, gap: 12 },
    ctaButton: { 
        borderRadius: 20, 
        overflow: 'hidden',
        ...elevationGlow(6),
    },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 18, fontWeight: '900', color: '#EAF3F6', letterSpacing: 0.5 },
    cancelBtn: { alignItems: 'center', paddingVertical: 12 },
    cancelText: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
});
