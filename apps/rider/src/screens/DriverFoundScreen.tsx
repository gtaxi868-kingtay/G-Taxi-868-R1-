import React, { useEffect, useRef, useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Animated, Dimensions, ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../shared/supabase';

const { width } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    gradientStart: '#1A0533',
    gradientEnd: '#0D1B4B',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    cyan: '#00E5FF',
    cyanDark: '#0099BB',
    cyanSoft: 'rgba(0,229,255,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

interface DriverInfo {
    name: string;
    vehicle: string;
    plate: string;
    rating: number;
}

export function DriverFoundScreen({ navigation, route }: any) {
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

    // Fetch driver details if not provided (called from restoration handler)
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
                    // Fallback: navigate directly to ActiveRide
                    navigation.replace('ActiveRide', { rideId, destination, fare });
                    return;
                }

                const { data: driverData, error: driverError } = await supabase
                    .from('drivers')
                    .select('id, first_name, last_name, vehicle_type, vehicle_plate, rating')
                    .eq('id', rideData.driver_id)
                    .single();

                if (driverError || !driverData) {
                    console.error('Failed to fetch driver details:', driverError);
                    // Fallback: navigate directly to ActiveRide
                    navigation.replace('ActiveRide', { rideId, destination, fare });
                    return;
                }

                setDriver({
                    name: `${driverData.first_name || ''} ${driverData.last_name || ''}`.trim() || 'Your Driver',
                    vehicle: driverData.vehicle_type || 'Vehicle',
                    plate: driverData.vehicle_plate || 'PBA 1234',
                    rating: driverData.rating || 4.8,
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
        // Navigate to ActiveRide with all required params
        navigation.replace('ActiveRide', {
            rideId,
            destination,
            fare,
        });
    };

    if (loading) {
        return (
            <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientEnd]} style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={COLORS.cyan} />
                <Text style={{ color: COLORS.textSecondary, marginTop: 16, fontSize: 16 }}>Finding your driver...</Text>
            </LinearGradient>
        );
    }


    return (
        <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientEnd]} style={s.container}>
            <Animated.View style={[s.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
                {/* Glowing success ring */}
                <View style={s.avatarContainer}>
                    <View style={s.avatarGlow} />
                    <View style={s.avatar}>
                        <Text style={s.avatarEmoji}>🚗</Text>
                    </View>
                    {/* Star rating */}
                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={12} color="#F59E0B" />
                        <Text style={s.ratingText}>{driver?.rating?.toFixed(1) ?? '4.8'}</Text>
                    </View>
                </View>

                <Text style={s.matchedTitle}>Driver Found!</Text>
                <Text style={s.driverName}>{driver?.name ?? 'Your Driver'}</Text>

                {/* Driver Info Card */}
                <View style={s.infoCard}>
                    <BlurView intensity={30} style={StyleSheet.absoluteFillObject} tint="dark" />
                    <View style={s.infoRow}>
                        <Ionicons name="car-outline" size={18} color={COLORS.cyan} />
                        <Text style={s.infoText}>{driver?.vehicle ?? 'Vehicle'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="card-outline" size={18} color={COLORS.cyan} />
                        <Text style={s.infoText}>{driver?.plate ?? 'PBA 1234'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={18} color={COLORS.success} />
                        <Text style={[s.infoText, { color: COLORS.success }]}>On the way to you...</Text>
                    </View>
                </View>

                {/* Ride ID reference */}
                <Text style={s.rideId}>Ride Reference: #{rideId?.slice(0, 8).toUpperCase()}</Text>
            </Animated.View>

            {/* CTA Button */}
            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 24 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleTrack} activeOpacity={0.88}>
                    <LinearGradient
                        colors={[COLORS.purple, COLORS.cyan]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="navigate-outline" size={22} color={COLORS.white} style={{ marginRight: 10 }} />
                        <Text style={s.ctaText}>Track My Ride →</Text>
                    </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                    style={s.cancelBtn}
                    onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        navigation.navigate('Home');
                    }}
                >
                    <Text style={s.cancelText}>Cancel</Text>
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
        backgroundColor: COLORS.cyanSoft,
        shadowColor: COLORS.cyan, shadowOpacity: 0.5, shadowRadius: 30, elevation: 0,
        top: -20, left: -20,
    },
    avatar: {
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(123,92,240,0.2)',
        borderWidth: 3, borderColor: COLORS.cyan,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: COLORS.cyan, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
    },
    avatarEmoji: { fontSize: 56 },
    ratingBadge: {
        position: 'absolute', bottom: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: COLORS.bgSecondary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
        borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    },
    ratingText: { fontSize: 12, fontWeight: '700', color: COLORS.warning },
    matchedTitle: {
        fontSize: 14, fontWeight: '800', color: COLORS.cyan,
        letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
    },
    driverName: { fontSize: 34, fontWeight: '900', color: COLORS.white, marginBottom: 28, letterSpacing: -0.5 },
    infoCard: {
        width: '100%', borderRadius: 24, overflow: 'hidden',
        borderWidth: 1, borderColor: COLORS.glassBorder,
        padding: 6, backgroundColor: COLORS.glassBg,
        marginBottom: 20,
    },
    infoRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 18, paddingVertical: 14,
    },
    infoText: { fontSize: 16, color: COLORS.white, fontWeight: '600' },
    divider: { height: 1, backgroundColor: COLORS.glassBorder, marginHorizontal: 18 },
    rideId: { fontSize: 12, color: COLORS.textMuted, letterSpacing: 1 },
    ctaContainer: { paddingHorizontal: 24, gap: 12 },
    ctaButton: { 
        borderRadius: 20, 
        overflow: 'hidden',
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 18, fontWeight: '900', color: COLORS.white, letterSpacing: 0.5 },
    cancelBtn: { alignItems: 'center', paddingVertical: 12 },
    cancelText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
});
