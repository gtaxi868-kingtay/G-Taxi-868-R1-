import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ActivityIndicator, Dimensions, Alert, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withSequence,
    useAnimatedStyle, Easing,
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

// Blueberry Luxe — Gold Edition (Driver)
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#1A1508',
    gradientStart: '#1A1200',
    gradientEnd: '#0D0B1E',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    purpleLight: '#9B7CF0',
    gold: '#FFD700',
    goldDark: '#B8860B',
    goldLight: '#FFEC8B',
    amber: '#FFB000',
    amberSoft: 'rgba(255,176,0,0.1)',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.4)',
    glassBg: 'rgba(255,215,0,0.06)',
    glassBorder: 'rgba(255,176,0,0.3)',
    success: '#00FF94',
    warning: '#F59E0B',
    error: '#EF4444',
};

const DEFAULT_DRIVER_SHARE = 0.78; // 22% commission (Standard)
const ARC_SIZE = 180;

function paymentLabel(method: string | null): string {
    if (method === 'card') return 'CARD';
    if (method === 'wallet') return 'WALLET';
    return 'CASH';
}
function paymentIcon(method: string | null): string {
    if (method === 'card') return 'card-outline';
    if (method === 'wallet') return 'wallet-outline';
    return 'cash-outline';
}

interface RideDetail {
    pickup_address: string | null;
    dropoff_address: string | null;
    total_fare_cents: number | null;
    payment_method: string | null;
    vehicle_type: string | null;
    rider_id: string | null;
}

export function TripRequestScreen({ navigation, route }: any) {
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();

    const [timeLeft, setTimeLeft] = useState(offer?.timeout_seconds ?? 15);
    const [isHandling, setIsHandling] = useState(false);
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);
    const [isPreferred, setIsPreferred] = useState(false);
    const [stops, setStops] = useState<any[]>([]);

    const totalSeconds = offer?.timeout_seconds ?? 15;

    const sheetY = useSharedValue(height);
    const fareScale = useSharedValue(1);
    const shakeX = useSharedValue(0);
    const pickupX = useSharedValue(40);
    const dropoffX = useSharedValue(40);
    const pickupOp = useSharedValue(0);
    const dropoffOp = useSharedValue(0);

    useEffect(() => {
        sheetY.value = withSpring(0, { damping: 18, stiffness: 120 });
        fareScale.value = withSequence(
            withSpring(1.12, { damping: 6, stiffness: 300 }),
            withSpring(1.0, { damping: 10, stiffness: 200 })
        );
        pickupX.value = withSpring(0, { damping: 14, stiffness: 120 });
        pickupOp.value = withTiming(1, { duration: 300 });
        setTimeout(() => {
            dropoffX.value = withSpring(0, { damping: 14, stiffness: 120 });
            dropoffOp.value = withTiming(1, { duration: 300 });
        }, 120);
    }, []);

    useEffect(() => {
        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            if (isHandling || timeLeft <= 0) return;

            e.preventDefault();
            Alert.alert(
                'Discard Offer?',
                'Leaving this screen will ignore the current trip offer. Are you sure?',
                [
                    { text: 'Keep Offer', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }
                ]
            );
        });

        if (!offer?.ride_id) { 
            setDetailLoading(false); 
            return () => beforeRemoveListener();
        }
        const fetchDetails = async () => {
            const { data } = await supabase.from('rides')
                .select('pickup_address, dropoff_address, total_fare_cents, payment_method, vehicle_type, rider_id')
                .eq('id', offer.ride_id).single();
            if (data) {
                setRideDetail(data);
                const { data: stps } = await supabase.from('ride_stops').select('stop_type').eq('ride_id', offer.ride_id);
                if (stps) setStops(stps);
                if (data.rider_id && driver?.id) {
                    const { data: pref } = await supabase.from('rider_preferences').select('id')
                        .eq('rider_id', data.rider_id).eq('favored_driver_id', driver.id).single();
                    if (pref) setIsPreferred(true);
                }
            }
            setDetailLoading(false);
        };
        fetchDetails();

        return () => beforeRemoveListener();
    }, [offer?.ride_id]);

    useEffect(() => {
        if (!offer?.expires_at) return;
        const tick = () => {
            const left = Math.max(0, Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
            setTimeLeft(left);
            if (left <= 0 && !isHandling) handleDecline(true);
        };
        const timer = setInterval(tick, 500);
        return () => clearInterval(timer);
    }, [offer?.expires_at]);

    const handleAccept = async () => {
        if (!offer?.ride_id || !driver?.id || isHandling) return;
        setIsHandling(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const { error } = await acceptRide(offer?.ride_id, driver?.id);
        if (error) { Alert.alert('Offer Expired', 'This trip is no longer available.'); navigation.goBack(); }
        else navigation.replace('ActiveTrip', { rideId: offer?.ride_id });
    };

    const handleDecline = async (auto = false) => {
        if (isHandling) return;
        setIsHandling(true);
        if (auto) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            shakeX.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(0, { duration: 60 }));
        }
        await declineRide(offer?.id);
        navigation.goBack();
    };

    const driverEarnings = offer?.driver_payout_cents 
        ? (offer.driver_payout_cents / 100) 
        : (rideDetail?.total_fare_cents || offer?.fare_cents || 0) * DEFAULT_DRIVER_SHARE / 100;
    const distanceKm = offer?.distance_meters ? (offer.distance_meters / 1000).toFixed(1) : '?';
    const arcColor = timeLeft > 5 ? COLORS.gold : timeLeft > 2 ? COLORS.warning : COLORS.error;

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }, { translateX: shakeX.value }] }));
    const fareStyle = useAnimatedStyle(() => ({ transform: [{ scale: fareScale.value }] }));

    return (
        <View style={s.root}>
            {/* Deep Gradient Background */}
            <LinearGradient
                colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                style={StyleSheet.absoluteFillObject}
            />
            
            {/* Glass Overlay */}
            <BlurView tint="dark" intensity={20} style={StyleSheet.absoluteFillObject} />
            
            <Reanimated.View style={[s.sheet, { paddingBottom: insets.bottom + 20 }, sheetStyle]}>
                <BlurView intensity={30} tint="dark" style={s.cardBlur}>
                    <View style={s.cardInner}>
                        <View style={s.handle} />
                        
                        {/* Header with Logo and Status */}
                        <View style={s.headerRow}>
                            <Image 
                                source={require('../../assets/logo.png')} 
                                style={s.headerLogo}
                                resizeMode="contain"
                            />
                            {isPreferred && (
                                <View style={s.prefBadge}>
                                    <Ionicons name="star" size={12} color={COLORS.gold} />
                                    <Text style={s.prefBadgeText}>PREFERRED</Text>
                                </View>
                            )}
                        </View>

                        {/* Earnings Circle with Countdown */}
                        <View style={s.timerOuter}>
                            <LinearGradient
                                colors={[COLORS.amberSoft, 'transparent']}
                                style={[s.arc, { borderColor: arcColor }]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <Reanimated.View style={[s.fareBox, fareStyle]}>
                                    <Text style={s.earningsLabel}>EARNINGS</Text>
                                    <Text style={s.earningsValue}>${driverEarnings.toFixed(2)}</Text>
                                    <Text style={[s.countdownText, { color: arcColor }]}>{timeLeft}S REMAINING</Text>
                                </Reanimated.View>
                            </LinearGradient>
                        </View>

                        {/* Address Details */}
                        {detailLoading ? (
                            <ActivityIndicator color={COLORS.gold} style={{ marginVertical: 40 }} />
                        ) : (
                            <View style={s.addressLayer}>
                                <Reanimated.View style={[s.addrRow, useAnimatedStyle(() => ({ transform: [{ translateX: pickupX.value }], opacity: pickupOp.value }))]}>
                                    <View style={s.dot} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.addrLabel}>PICKUP</Text>
                                        <Text style={s.addrText} numberOfLines={1}>{rideDetail?.pickup_address || offer?.pickup_address || 'Current Location'}</Text>
                                    </View>
                                </Reanimated.View>
                                <View style={s.line} />
                                <Reanimated.View style={[s.addrRow, useAnimatedStyle(() => ({ transform: [{ translateX: dropoffX.value }], opacity: dropoffOp.value }))]}>
                                    <View style={s.square} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.addrLabel}>DROPOFF</Text>
                                        <Text style={s.addrText} numberOfLines={1}>{rideDetail?.dropoff_address || offer?.dropoff_address || 'Destination'}</Text>
                                    </View>
                                </Reanimated.View>
                            </View>
                        )}

                        {/* Stats Grid */}
                        <View style={s.statsGrid}>
                            <View style={s.statPill}>
                                <Ionicons name="navigate-outline" size={16} color={COLORS.gold} />
                                <Text style={s.statPillText}>{distanceKm} KM</Text>
                            </View>
                            <View style={s.statPill}>
                                <Ionicons name="time-outline" size={16} color={COLORS.gold} />
                                <Text style={s.statPillText}>{offer?.duration_min || '?'} MIN</Text>
                            </View>
                            <View style={s.statPill}>
                                <Ionicons name={paymentIcon(rideDetail?.payment_method || 'cash') as any} size={16} color={COLORS.gold} />
                                <Text style={s.statPillText}>{paymentLabel(rideDetail?.payment_method || 'cash')}</Text>
                            </View>
                        </View>

                        {/* Action Buttons */}
                        <View style={s.actionRow}>
                            <TouchableOpacity style={s.declineBtn} onPress={() => handleDecline(false)} disabled={isHandling}>
                                <Text style={s.declineText}>DECLINE</Text>
                            </TouchableOpacity>
                            
                            <TouchableOpacity style={s.acceptBtn} onPress={handleAccept} disabled={isHandling} activeOpacity={0.9}>
                                <LinearGradient 
                                    colors={[COLORS.gold, COLORS.goldDark]} 
                                    style={s.acceptGradient}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    {isHandling ? <ActivityIndicator color={COLORS.bgPrimary} /> : (
                                        <>
                                            <Ionicons name="flash" size={20} color={COLORS.bgPrimary} />
                                            <Text style={s.acceptText}>ACCEPT TRIP</Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    // Root & Layout
    root: { 
        flex: 1, 
        backgroundColor: COLORS.bgPrimary,
        justifyContent: 'flex-end',
    },
    sheet: { 
        paddingHorizontal: 16,
    },

    // Card with Blur
    cardBlur: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: COLORS.glassBorder,
    },
    cardInner: { 
        padding: 24, 
        backgroundColor: 'rgba(22,11,50,0.5)',
    },

    // Handle
    handle: { 
        width: 44, 
        height: 5, 
        borderRadius: 3, 
        backgroundColor: 'rgba(255,255,255,0.15)', 
        alignSelf: 'center', 
        marginBottom: 24,
    },

    // Header
    headerRow: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: 28,
    },
    headerLogo: {
        width: 48,
        height: 48,
    },
    prefBadge: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        backgroundColor: 'rgba(0,229,255,0.1)', 
        paddingHorizontal: 12, 
        paddingVertical: 6, 
        borderRadius: 16, 
        borderWidth: 1, 
        borderColor: 'rgba(0,229,255,0.2)',
        gap: 6,
    },
    prefBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: 0.5,
    },
    
    // Earnings Circle
    timerOuter: { 
        alignItems: 'center', 
        marginBottom: 32, 
        shadowColor: COLORS.gold, 
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 20, 
        shadowOpacity: 0.2,
    },
    arc: { 
        width: ARC_SIZE, 
        height: ARC_SIZE, 
        borderRadius: ARC_SIZE / 2, 
        borderWidth: 3, 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderStyle: 'solid',
        backgroundColor: 'rgba(0,229,255,0.05)',
    },
    fareBox: { 
        alignItems: 'center',
    },
    earningsLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.textMuted,
        letterSpacing: 1.5,
        marginBottom: 4,
    },
    earningsValue: {
        fontSize: 42,
        fontWeight: '800',
        color: COLORS.gold,
        letterSpacing: -1,
        marginBottom: 4,
    },
    countdownText: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 1,
    },
    
    // Address Layer
    addressLayer: { 
        backgroundColor: COLORS.glassBg, 
        borderRadius: 20, 
        padding: 20, 
        marginBottom: 28, 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder,
    },
    addrRow: { 
        flexDirection: 'row', 
        alignItems: 'center',
    },
    addrLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.textMuted,
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    addrText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.white,
    },
    dot: { 
        width: 12, 
        height: 12, 
        borderRadius: 6, 
        backgroundColor: COLORS.gold, 
        marginRight: 14, 
        shadowColor: COLORS.gold, 
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 6, 
        shadowOpacity: 0.5,
    },
    square: { 
        width: 12, 
        height: 12, 
        borderRadius: 3, 
        backgroundColor: COLORS.warning, 
        marginRight: 14, 
        shadowColor: COLORS.warning, 
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 6, 
        shadowOpacity: 0.5,
    },
    line: { 
        width: 2, 
        height: 28, 
        backgroundColor: 'rgba(255,255,255,0.1)', 
        marginLeft: 5, 
        marginVertical: 4,
    },

    // Stats Grid
    statsGrid: { 
        flexDirection: 'row', 
        gap: 10, 
        marginBottom: 28,
    },
    statPill: { 
        flex: 1, 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: COLORS.glassBg, 
        paddingVertical: 12, 
        borderRadius: 14, 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder,
        gap: 6,
    },
    statPillText: {
        fontSize: 14,
        fontWeight: '700',
        color: COLORS.white,
    },

    // Action Buttons
    actionRow: { 
        flexDirection: 'row', 
        gap: 12,
    },
    declineBtn: { 
        flex: 1, 
        height: 56, 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderRadius: 16, 
        borderWidth: 1, 
        borderColor: 'rgba(239,68,68,0.3)', 
        backgroundColor: 'rgba(239,68,68,0.08)',
    },
    declineText: {
        fontSize: 15,
        fontWeight: '800',
        color: COLORS.error,
        letterSpacing: 0.5,
    },
    acceptBtn: { 
        flex: 2, 
        height: 56, 
        borderRadius: 16, 
        overflow: 'hidden', 
        shadowColor: COLORS.gold, 
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12, 
        shadowOpacity: 0.3, 
        elevation: 6,
    },
    acceptGradient: { 
        flex: 1, 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: 8,
    },
    acceptText: {
        fontSize: 15,
        fontWeight: '800',
        color: COLORS.bgPrimary,
        letterSpacing: 0.5,
    },
});
