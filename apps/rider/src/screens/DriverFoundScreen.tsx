import React, { useEffect, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    Animated, Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

export function DriverFoundScreen({ navigation, route }: any) {
    const { rideId, driver } = route.params as {
        rideId: string;
        driver: {
            name: string;
            vehicle: string;
            plate: string;
            rating: number;
        };
    };
    const insets = useSafeAreaInsets();
    const scaleAnim = useRef(new Animated.Value(0.8)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Animated.parallel([
            Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 10, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, []);

    const handleTrack = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        navigation.navigate('ActiveRide', { rideId, driver });
    };

    return (
        <LinearGradient colors={['#0A0A1F', '#12122A']} style={s.container}>
            <Animated.View style={[s.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
                {/* Glowing success ring */}
                <View style={s.avatarContainer}>
                    <View style={s.avatarGlow} />
                    <View style={s.avatar}>
                        <Text style={s.avatarEmoji}>🚗</Text>
                    </View>
                    {/* Star rating */}
                    <View style={s.ratingBadge}>
                        <Ionicons name="star" size={12} color="#FFD700" />
                        <Text style={s.ratingText}>{driver?.rating?.toFixed(1) ?? '4.8'}</Text>
                    </View>
                </View>

                <Text style={s.matchedTitle}>Driver Found!</Text>
                <Text style={s.driverName}>{driver?.name ?? 'Your Driver'}</Text>

                {/* Driver Info Card */}
                <View style={s.infoCard}>
                    <BlurView intensity={30} style={StyleSheet.absoluteFill} tint="dark" />
                    <View style={s.infoRow}>
                        <Ionicons name="car-outline" size={18} color="#00FFFF" />
                        <Text style={s.infoText}>{driver?.vehicle ?? 'Vehicle'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="card-outline" size={18} color="#00FFFF" />
                        <Text style={s.infoText}>{driver?.plate ?? 'PBA 1234'}</Text>
                    </View>
                    <View style={s.divider} />
                    <View style={s.infoRow}>
                        <Ionicons name="time-outline" size={18} color="#4ADE80" />
                        <Text style={[s.infoText, { color: '#4ADE80' }]}>On the way to you...</Text>
                    </View>
                </View>

                {/* Ride ID reference */}
                <Text style={s.rideId}>Ride Reference: #{rideId?.slice(0, 8).toUpperCase()}</Text>
            </Animated.View>

            {/* CTA Button */}
            <View style={[s.ctaContainer, { paddingBottom: insets.bottom + 24 }]}>
                <TouchableOpacity style={s.ctaButton} onPress={handleTrack} activeOpacity={0.88}>
                    <LinearGradient
                        colors={['#00FFFF', '#0099CC']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={s.ctaGradient}
                    >
                        <Ionicons name="navigate-outline" size={22} color="#0A0A1F" style={{ marginRight: 10 }} />
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
        backgroundColor: 'rgba(0,255,255,0.1)',
        shadowColor: '#00FFFF', shadowOpacity: 0.6, shadowRadius: 30, elevation: 0,
        top: -20, left: -20,
    },
    avatar: {
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(123,97,255,0.2)',
        borderWidth: 3, borderColor: '#00FFFF',
        alignItems: 'center', justifyContent: 'center',
    },
    avatarEmoji: { fontSize: 56 },
    ratingBadge: {
        position: 'absolute', bottom: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: '#1A1A3A', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
        borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
    },
    ratingText: { fontSize: 12, fontWeight: '700', color: '#FFD700' },
    matchedTitle: {
        fontSize: 14, fontWeight: '700', color: '#00FFFF',
        letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
    },
    driverName: { fontSize: 34, fontWeight: '900', color: '#FFF', marginBottom: 28 },
    infoCard: {
        width: '100%', borderRadius: 24, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
        padding: 6, backgroundColor: 'rgba(255,255,255,0.05)',
        marginBottom: 20,
    },
    infoRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 18, paddingVertical: 14,
    },
    infoText: { fontSize: 16, color: '#FFF', fontWeight: '600' },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginHorizontal: 18 },
    rideId: { fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },
    ctaContainer: { paddingHorizontal: 24, gap: 12 },
    ctaButton: { borderRadius: 20, overflow: 'hidden' },
    ctaGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18,
    },
    ctaText: { fontSize: 18, fontWeight: '900', color: '#0A0A1F' },
    cancelBtn: { alignItems: 'center', paddingVertical: 12 },
    cancelText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },
});
