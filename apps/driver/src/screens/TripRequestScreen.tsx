import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ActivityIndicator, useWindowDimensions, Alert, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withSequence,
    useAnimatedStyle, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { LiquidGlass } from '@gtaxi/design-system/native';
import { ghostBorder, elevationGlow } from '@gtaxi/design-system/utils/style-rules';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';
import { Ride } from '@gtaxi/core';

const CYAN = '#00E5FF';
const WARNING = '#E6B450';
const ERROR = '#EF4444';
const SUCCESS = '#00FF94';

const DEFAULT_DRIVER_SHARE = 0.82;
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
    const { height } = useWindowDimensions();
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();

    const [timeLeft, setTimeLeft] = useState(offer?.timeout_seconds ?? 15);
    const [isHandling, setIsHandling] = useState(false);
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);
    const [isPreferred, setIsPreferred] = useState(false);
    const [stops, setStops] = useState<any[]>([]);
    const [hasNode, setHasNode] = useState(false);
    const [identityVerified, setIdentityVerified] = useState(false);
    const [trustScore, setTrustScore] = useState<number>(0);
    const [trustBadge, setTrustBadge] = useState<string>('STANDARD');

    const totalSeconds = offer?.timeout_seconds ?? 15;

    const reducedMotion = useReducedMotion();
    const sheetY = useSharedValue(reducedMotion ? 0 : height);
    const fareScale = useSharedValue(1);
    const shakeX = useSharedValue(0);
    const pickupX = useSharedValue(reducedMotion ? 0 : 40);
    const dropoffX = useSharedValue(reducedMotion ? 0 : 40);
    const pickupOp = useSharedValue(reducedMotion ? 1 : 0);
    const dropoffOp = useSharedValue(reducedMotion ? 1 : 0);

    useEffect(() => {
        if (reducedMotion) return;
        sheetY.value = withSpring(0, { damping: 18, stiffness: 120 });
        fareScale.value = withSequence(
            withSpring(1.12, { damping: 6, stiffness: 300 }),
            withSpring(1.0, { damping: 10, stiffness: 200 })
        );
        pickupX.value = withSpring(0, { damping: 14, stiffness: 120 });
        pickupOp.value = withTiming(1, { duration: 300 });
        const dropoffTimer = setTimeout(() => {
            dropoffX.value = withSpring(0, { damping: 14, stiffness: 120 });
            dropoffOp.value = withTiming(1, { duration: 300 });
        }, 120);
        return () => clearTimeout(dropoffTimer);
    }, []);

    useEffect(() => {
        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            if (isHandling || timeLeft <= 0) return;
            e.preventDefault();
            Alert.alert('Discard Offer?', 'Leaving this screen will ignore the current trip offer. Are you sure?', [
                { text: 'Keep Offer', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }
            ]);
        });

        if (!offer?.ride_id) {
            setDetailLoading(false);
            return () => beforeRemoveListener();
        }
        const fetchDetails = async () => {
            const { data } = await supabase.from('rides')
                .select('pickup_address, dropoff_address, total_fare_cents, payment_method, vehicle_type, rider_id, metadata')
                .eq('id', offer.ride_id).single();
            if (data) {
                setRideDetail(data);
                const meta = data.metadata || {};
                const hasNodeId = !!(meta.kiosk_id || meta.node_id || meta.revenue_split?.node_present);
                setHasNode(hasNodeId);
                setIdentityVerified(!!meta.identity_verified);
                const { data: stps } = await supabase.from('ride_stops').select('stop_type').eq('ride_id', offer.ride_id);
                if (stps) setStops(stps);
                if (data.rider_id && driver?.id) {
                    const { data: pref } = await supabase.from('rider_preferences').select('id')
                        .eq('rider_id', data.rider_id).eq('favored_driver_id', driver.id).single();
                    if (pref) setIsPreferred(true);
                }
                if (offer?.ride_id) {
                    const { data: ts } = await supabase.functions.invoke('calculate_ride_trust_score', {
                        body: { ride_id: offer.ride_id }
                    }).catch(() => ({ data: null }));
                    if (ts?.success && ts?.data) {
                        setTrustScore(ts.data.final_score || ts.data.score || 0);
                        setTrustBadge(ts.data.badge || 'STANDARD');
                    }
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
        const { error, statusCode } = await acceptRide(offer?.ride_id, driver?.id);
        if (error) {
            if (statusCode === 429) Alert.alert('Too Many Requests', 'Please slow down and try again.');
            else if (statusCode === 401) Alert.alert('Session Expired', 'Please log in again.');
            else Alert.alert('Offer Expired', 'This trip is no longer available.');
            navigation.goBack();
        } else navigation.replace('ActiveTrip', { rideId: offer?.ride_id });
    };

    const handleDecline = async (auto = false) => {
        if (isHandling) return;
        setIsHandling(true);
        if (auto) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            if (!reducedMotion) shakeX.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(0, { duration: 60 }));
        }
        await declineRide(offer?.id);
        navigation.goBack();
    };

    const driverEarnings = offer?.driver_payout_cents
        ? (offer.driver_payout_cents / 100)
        : (rideDetail?.total_fare_cents || offer?.fare_cents || 0) * DEFAULT_DRIVER_SHARE / 100;
    const distanceKm = offer?.distance_meters ? (offer.distance_meters / 1000).toFixed(1) : '?';
    const arcColor = timeLeft > 5 ? VOICES.driver.accent : timeLeft > 2 ? WARNING : ERROR;

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }, { translateX: shakeX.value }] }));
    const fareStyle = useAnimatedStyle(() => ({ transform: [{ scale: fareScale.value }] }));

    return (
        <View style={s.root} pointerEvents="box-none">
            <LinearGradient colors={[SURFACE.containerLow, SURFACE.base]} style={StyleSheet.absoluteFillObject} />
            <Reanimated.View style={[s.sheet, { paddingBottom: insets.bottom + 20 }, sheetStyle]}>
                <LiquidGlass voice="driver" style={s.cardBlur} tier="chrome">
                    <View style={s.cardInner}>
                        <View style={s.handle} />

                        <View style={s.headerRow}>
                            <Image
                                source={require('../../assets/logo.png')}
                                style={s.headerLogo}
                                resizeMode="contain"
                            />
                            <View style={s.badgeRow}>
                                {isPreferred && (
                                    <View style={s.prefBadge}>
                                        <Ionicons name="star" size={12} color={VOICES.driver.accent} />
                                        <Text style={s.prefBadgeText}>PREFERRED</Text>
                                    </View>
                                )}
                                {hasNode && (
                                    <View style={s.premiumBadge}>
                                        <Ionicons name="storefront" size={12} color="#EAF3F6" />
                                        <Text style={s.premiumBadgeText}>MERCHANT PICKUP</Text>
                                    </View>
                                )}
                                {identityVerified && (
                                    <View style={s.verifiedBadge}>
                                        <Ionicons name="shield-checkmark" size={12} color={SUCCESS} />
                                        <Text style={s.verifiedBadgeText}>VERIFIED</Text>
                                    </View>
                                )}
                                {trustBadge === 'VERIFIED_SAFE' && (
                                    <View style={[s.verifiedBadge, { borderColor: SUCCESS, backgroundColor: 'rgba(0,255,148,0.15)' }]}>
                                        <Ionicons name="shield" size={12} color={SUCCESS} />
                                        <Text style={[s.verifiedBadgeText, { color: SUCCESS }]}>TRUSTED {trustScore}</Text>
                                    </View>
                                )}
                                {trustBadge === 'SAFE_ROUTE' && (
                                    <View style={[s.prefBadge, { borderColor: CYAN, backgroundColor: 'rgba(0,229,255,0.1)' }]}>
                                        <Ionicons name="shield-outline" size={12} color={CYAN} />
                                        <Text style={[s.prefBadgeText, { color: CYAN }]}>SAFE {trustScore}</Text>
                                    </View>
                                )}
                            </View>
                        </View>

                        <View style={s.timerOuter}>
                            <LinearGradient
                                colors={[VOICES.driver.accent + '08', 'transparent']}
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

                        {detailLoading ? (
                            <ActivityIndicator color={VOICES.driver.accent} style={{ marginVertical: 40 }} />
                        ) : (
                            <LiquidGlass voice="driver" style={s.addressLayer} tier="inlay">
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
                            </LiquidGlass>
                        )}

                        <View style={s.statsGrid}>
                            <View style={s.statPill}>
                                <Ionicons name="navigate-outline" size={16} color={VOICES.driver.accent} />
                                <Text style={s.statPillText}>{distanceKm} KM</Text>
                            </View>
                            <View style={s.statPill}>
                                <Ionicons name="time-outline" size={16} color={VOICES.driver.accent} />
                                <Text style={s.statPillText}>{offer?.duration_min || '?'} MIN</Text>
                            </View>
                            <View style={s.statPill}>
                                <Ionicons name={paymentIcon(rideDetail?.payment_method || 'cash') as any} size={16} color={VOICES.driver.accent} />
                                <Text style={s.statPillText}>{paymentLabel(rideDetail?.payment_method || 'cash')}</Text>
                            </View>
                        </View>

                        <View style={s.actionRow}>
                            <TouchableOpacity style={s.declineBtn} onPress={() => handleDecline(false)} disabled={isHandling} accessibilityLabel="Decline trip" accessibilityRole="button">
                                <Text style={s.declineText}>DECLINE</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={s.acceptBtn} onPress={handleAccept} disabled={isHandling} activeOpacity={0.9} accessibilityLabel="Accept trip" accessibilityRole="button">
                                <LinearGradient
                                    colors={[VOICES.driver.accent, VOICES.driver.accentDark]}
                                    style={s.acceptGradient}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    {isHandling ? <ActivityIndicator color={SURFACE.base} /> : (
                                        <>
                                            <Ionicons name="flash" size={20} color={SURFACE.base} />
                                            <Text style={s.acceptText}>ACCEPT TRIP</Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>
                </LiquidGlass>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: SURFACE.base,
        justifyContent: 'flex-end',
    },
    sheet: {
        paddingHorizontal: 16,
    },
    cardBlur: {
        borderWidth: 0,
    },
    cardInner: {
        padding: 24,
    },
    handle: {
        width: 44,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.15)',
        alignSelf: 'center',
        marginBottom: 24,
    },
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
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    prefBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(139,92,246,0.1)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(139,92,246,0.2)',
        gap: 6,
    },
    prefBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: VOICES.driver.accent,
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    premiumBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(139,92,246,0.15)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(139,92,246,0.3)',
        gap: 6,
    },
    premiumBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#EAF3F6',
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    verifiedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,255,148,0.1)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(0,255,148,0.25)',
        gap: 6,
    },
    verifiedBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: SUCCESS,
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    timerOuter: {
        alignItems: 'center',
        marginBottom: 32,
        ...elevationGlow(20),
    },
    arc: {
        width: ARC_SIZE,
        height: ARC_SIZE,
        borderRadius: ARC_SIZE / 2,
        borderWidth: 3,
        alignItems: 'center',
        justifyContent: 'center',
        borderStyle: 'solid',
        backgroundColor: 'rgba(139,92,246,0.05)',
    },
    fareBox: {
        alignItems: 'center',
    },
    earningsLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: VOICES.driver.textMuted,
        letterSpacing: 1.5,
        marginBottom: 4,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    earningsValue: {
        fontSize: 42,
        fontWeight: '800',
        color: VOICES.driver.gold,
        letterSpacing: -1,
        marginBottom: 4,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    countdownText: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 1,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    addressLayer: {
        marginBottom: 28,
        padding: 20,
    },
    addrRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    addrLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: VOICES.driver.textMuted,
        letterSpacing: 0.5,
        marginBottom: 2,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    addrText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#EAF3F6',
        fontFamily: 'Manrope-Medium',
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: VOICES.driver.accent,
        marginRight: 14,
    },
    square: {
        width: 12,
        height: 12,
        borderRadius: 3,
        backgroundColor: WARNING,
        marginRight: 14,
    },
    line: {
        width: 2,
        height: 28,
        backgroundColor: 'rgba(255,255,255,0.1)',
        marginLeft: 5,
        marginVertical: 4,
    },
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
        backgroundColor: 'rgba(139,92,246,0.06)',
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 6,
    },
    statPillText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#EAF3F6',
        fontFamily: 'SpaceGrotesk-Bold',
    },
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
        color: ERROR,
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
    acceptBtn: {
        flex: 2,
        height: 56,
        borderRadius: 16,
        overflow: 'hidden',
        ...elevationGlow(6),
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
        color: SURFACE.base,
        letterSpacing: 0.5,
        fontFamily: 'SpaceGrotesk-Bold',
    },
});
