import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity,
    ActivityIndicator, Dimensions, Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withSequence, withRepeat,
    useAnimatedStyle, useDerivedValue, interpolate, runOnJS,
    Easing,
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { Txt } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

// ── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    surface: '#110E22',
    surfaceHigh: '#1A1530',
    border: 'rgba(139,92,246,0.15)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    purpleDim: 'rgba(124,58,237,0.18)',
    gold: '#F59E0B',
    goldDim: 'rgba(245,158,11,0.12)',
    green: '#10B981',
    greenDim: 'rgba(16,185,129,0.12)',
    red: '#EF4444',
    redDim: 'rgba(239,68,68,0.12)',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.08)',
};

const DRIVER_SHARE = 0.81;
const ARC_SIZE = 160;
const ARC_CX = ARC_SIZE / 2;
const ARC_CY = ARC_SIZE / 2;
const ARC_R = 62;
const ARC_SW = 10; // stroke width

// ── Helpers ───────────────────────────────────────────────────────────────────
function paymentLabel(method: string | null): string {
    if (method === 'card') return 'Card';
    if (method === 'wallet') return 'Wallet';
    return 'Cash';
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
}

// ── Skia arc path builder ─────────────────────────────────────────────────────
// Standard arc helper removed for simplicity

// ── Component ─────────────────────────────────────────────────────────────────
export function TripRequestScreen({ navigation, route }: any) {
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const insets = useSafeAreaInsets();

    const [timeLeft, setTimeLeft] = useState(offer?.timeout_seconds ?? 15);
    const [isHandling, setIsHandling] = useState(false);
    const [rideDetail, setRideDetail] = useState<RideDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);
    const [glowVisible, setGlowVisible] = useState(false);

    const totalSeconds = offer?.timeout_seconds ?? 15;

    // ── Reanimated values ─────────────────────────────────────────────────────
    const sheetY = useSharedValue(height);
    const sweepDeg = useSharedValue(360);          // arc: 360→0
    const fareScale = useSharedValue(1);
    const glowR = useSharedValue(0);
    const shakeX = useSharedValue(0);
    const pickupX = useSharedValue(40);
    const dropoffX = useSharedValue(40);
    const pickupOp = useSharedValue(0);
    const dropoffOp = useSharedValue(0);
    const btnScale = useSharedValue(1);
    const declineOp = useSharedValue(1);

    // ── Mount animations ──────────────────────────────────────────────────────
    useEffect(() => {
        // Sheet springs up
        sheetY.value = withSpring(0, { damping: 18, stiffness: 120 });

        // Fare pulse on arrival
        fareScale.value = withSequence(
            withSpring(1.12, { damping: 6, stiffness: 300 }),
            withSpring(1.0, { damping: 10, stiffness: 200 })
        );

        // Address rows slide in left stagger
        pickupX.value = withSpring(0, { damping: 14, stiffness: 120 });
        pickupOp.value = withTiming(1, { duration: 300 });
        setTimeout(() => {
            dropoffX.value = withSpring(0, { damping: 14, stiffness: 120 });
            dropoffOp.value = withTiming(1, { duration: 300 });
        }, 120);
    }, []);

    // ── Fetch ride details (DO NOT TOUCH) ────────────────────────────────────
    useEffect(() => {
        if (!offer?.ride_id) { setDetailLoading(false); return; }
        supabase
            .from('rides')
            .select('pickup_address, dropoff_address, total_fare_cents, payment_method, vehicle_type')
            .eq('id', offer.ride_id)
            .single()
            .then(({ data, error }) => {
                if (data && !error) setRideDetail(data);
                setDetailLoading(false);
            });
    }, [offer?.ride_id]);

    // ── Countdown timer (DO NOT TOUCH) ────────────────────────────────────────
    useEffect(() => {
        if (!offer?.expires_at) return;

        const totalMs = new Date(offer.expires_at).getTime() - Date.now();
        // Drive the Skia arc sweep from 360→0 over the remaining time
        sweepDeg.value = withTiming(0, { duration: Math.max(0, totalMs), easing: Easing.linear });

        const tick = () => {
            const secondsLeft = Math.max(
                0,
                Math.floor((new Date(offer.expires_at).getTime() - Date.now()) / 1000)
            );
            setTimeLeft(secondsLeft);
            if (secondsLeft <= 0 && !isHandling) handleDecline(true);
        };

        tick();
        const timer = setInterval(tick, 500);
        return () => clearInterval(timer);
    }, [offer?.expires_at, isHandling]);

    // ── handleAccept (DO NOT INLINE) ─────────────────────────────────────────
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

    // ── handleDecline (DO NOT INLINE) ────────────────────────────────────────
    const handleDecline = async (auto = false) => {
        if (!offer || isHandling) return;
        setIsHandling(true);

        if (auto) {
            // Shake animation on timeout
            shakeX.value = withSequence(
                withTiming(-10, { duration: 60 }),
                withTiming(10, { duration: 60 }),
                withTiming(-8, { duration: 60 }),
                withTiming(8, { duration: 60 }),
                withTiming(0, { duration: 60 }),
            );
        }
        await declineRide(offer.id);
        navigation.goBack();
    };

    // ── Derived values ────────────────────────────────────────────────────────
    const distanceKm = offer?.distance_meters
        ? (offer.distance_meters / 1000).toFixed(1) : '?';

    const driverEarningsCents = rideDetail?.total_fare_cents
        ? Math.round(rideDetail.total_fare_cents * DRIVER_SHARE)
        : offer?.fare_cents
            ? Math.round(offer.fare_cents * DRIVER_SHARE) : null;

    const fareDisplay = driverEarningsCents !== null
        ? `$${(driverEarningsCents / 100).toFixed(2)}` : '--';

    // Arc color based on time remaining
    const pct = timeLeft / totalSeconds;
    const arcColor = pct > 0.5 ? C.green : pct > 0.3 ? C.gold : C.red;
    const timerBgColor = pct > 0.5 ? C.greenDim : pct > 0.3 ? C.goldDim : C.redDim;

    // ── Animated styles ───────────────────────────────────────────────────────
    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: sheetY.value }, { translateX: shakeX.value }] as any,
    }));
    const fareStyle = useAnimatedStyle(() => ({
        transform: [{ scale: fareScale.value }],
    }));
    const glowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(glowR.value, [0, 80], [0, 1]),
    }));
    const pickupStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: pickupX.value }],
        opacity: pickupOp.value,
    }));
    const dropoffStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: dropoffX.value }],
        opacity: dropoffOp.value,
    }));
    const declineStyle = useAnimatedStyle(() => ({
        opacity: declineOp.value,
    }));

    // Skia arc path removed

    // ── Accept with glow ──────────────────────────────────────────────────────
    const onAcceptPress = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        // Green glow ring expands
        setGlowVisible(true);
        glowR.value = withTiming(80, { duration: 300 });
        setTimeout(() => setGlowVisible(false), 400);
        handleAccept();
    };

    const onDeclinePress = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Dim the decline button
        declineOp.value = withTiming(0.4, { duration: 200 });
        handleDecline(false);
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <View style={s.overlay}>
            {/* Dark background */}
            <BlurView tint="dark" intensity={20} style={StyleSheet.absoluteFill} />

            {/* Slide-up sheet */}
            <Reanimated.View style={[s.sheet, { paddingBottom: insets.bottom + 20 }, sheetStyle]}>
                <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
                <LinearGradient
                    colors={['#1A1530', '#110E22', '#0D0B1A']}
                    style={StyleSheet.absoluteFill}
                />

                {/* Drag handle */}
                <View style={s.handle} />

                {/* ── STANDARD TIMER CIRCLE + FARE INSIDE ─────────────────── */}
                <View style={[s.arcWrap, { backgroundColor: timerBgColor, borderRadius: ARC_SIZE / 2, borderWidth: 2, borderColor: arcColor }]}>
                    {/* Fare and countdown centered */}
                    <Reanimated.View style={[s.arcCenter, fareStyle]}>
                        <Text style={[s.fareText, { color: C.gold }]}>{fareDisplay}</Text>
                        <Text style={[s.fareSub, { color: C.muted }]}>TTD</Text>
                        <Text style={[s.timerSec, { color: arcColor }]}>{timeLeft}s</Text>
                    </Reanimated.View>
                </View>

                {/* ── ADDRESSES ─────────────────────────────────────────── */}
                {detailLoading ? (
                    <ActivityIndicator color={C.purpleLight} style={{ marginVertical: 16 }} />
                ) : (
                    <View style={s.addressBlock}>
                        {/* Pickup */}
                        <Reanimated.View style={[s.addrRow, pickupStyle]}>
                            <View style={[s.addrDot, { backgroundColor: C.purple }]} />
                            <View style={{ flex: 1 }}>
                                <Txt variant="small" color={C.muted} style={{ letterSpacing: 0.5 }}>PICKUP</Txt>
                                <Txt variant="bodyBold" color={C.white} numberOfLines={1} style={{ marginTop: 2 }}>
                                    {rideDetail?.pickup_address || offer?.pickup_address || 'Address unavailable'}
                                </Txt>
                            </View>
                        </Reanimated.View>

                        <View style={s.addrLine} />

                        {/* Dropoff */}
                        <Reanimated.View style={[s.addrRow, dropoffStyle]}>
                            <View style={[s.addrSquare, { backgroundColor: C.white }]} />
                            <View style={{ flex: 1 }}>
                                <Txt variant="small" color={C.muted} style={{ letterSpacing: 0.5 }}>DROPOFF</Txt>
                                <Txt variant="bodyBold" color={C.white} numberOfLines={1} style={{ marginTop: 2 }}>
                                    {rideDetail?.dropoff_address || offer?.dropoff_address || 'Address unavailable'}
                                </Txt>
                            </View>
                        </Reanimated.View>
                    </View>
                )}

                {/* ── STAT PILLS (display only — no onPress) ────────────── */}
                <View style={s.pillRow}>
                    <View style={s.pill}>
                        <Ionicons name="navigate-outline" size={13} color={C.purpleLight} />
                        <Txt variant="small" color={C.white} style={{ marginLeft: 4 }}>{distanceKm} km</Txt>
                    </View>
                    <View style={s.pill}>
                        <Ionicons name="time-outline" size={13} color={C.purpleLight} />
                        <Txt variant="small" color={C.white} style={{ marginLeft: 4 }}>
                            {offer?.duration_min ?? '?'} min
                        </Txt>
                    </View>
                    <View style={s.pill}>
                        <Ionicons name={paymentIcon(rideDetail?.payment_method ?? null) as any} size={13} color={C.purpleLight} />
                        <Txt variant="small" color={C.white} style={{ marginLeft: 4 }}>
                            {paymentLabel(rideDetail?.payment_method ?? null)}
                        </Txt>
                    </View>
                    <View style={s.pill}>
                        <Ionicons name="flash-outline" size={13} color={C.gold} />
                        <Txt variant="small" color={C.gold} style={{ marginLeft: 4 }}>1.0x</Txt>
                    </View>
                </View>

                {/* ── ACCEPT BUTTON ─────────────────────────────────────── */}
                <View style={{ position: 'relative', marginBottom: 10 }}>
                    {/* Standard glow on accept */}
                    {glowVisible && (
                        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', zIndex: 0 }]}>
                            <View style={{ width: 200, height: 80, borderRadius: 40, backgroundColor: 'rgba(16,185,129,0.2)' }} />
                        </View>
                    )}
                    <TouchableOpacity
                        style={[s.acceptBtn, isHandling && { opacity: 0.6 }]}
                        onPress={onAcceptPress}
                        disabled={isHandling}
                        activeOpacity={0.85}
                    >
                        {isHandling ? (
                            <ActivityIndicator color={C.white} />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle-outline" size={22} color={C.white} />
                                <Txt variant="headingM" weight="bold" color={C.white}> Accept Trip</Txt>
                            </>
                        )}
                    </TouchableOpacity>
                </View>

                {/* ── DECLINE BUTTON ─────────────────────────────────────── */}
                <Reanimated.View style={declineStyle}>
                    <TouchableOpacity
                        style={s.declineBtn}
                        onPress={onDeclinePress}
                        disabled={isHandling}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="close-outline" size={18} color={C.red} />
                        <Txt variant="bodyBold" color={C.red}> Decline</Txt>
                    </TouchableOpacity>
                </Reanimated.View>
            </Reanimated.View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(3,2,8,0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderTopWidth: 1,
        borderColor: 'rgba(139,92,246,0.2)',
        paddingHorizontal: 20,
        paddingTop: 12,
        overflow: 'hidden',
    },
    handle: {
        width: 40, height: 4,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 2, alignSelf: 'center',
        marginBottom: 20,
    },

    // Arc
    arcWrap: {
        alignSelf: 'center',
        marginBottom: 20,
        position: 'relative',
        width: ARC_SIZE,
        height: ARC_SIZE,
    },
    arcCenter: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fareText: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
    fareSub: { fontSize: 11, marginTop: -2 },
    timerSec: { fontSize: 12, fontWeight: '700', marginTop: 2 },

    // Addresses
    addressBlock: {
        backgroundColor: C.surfaceHigh,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        marginBottom: 14,
        gap: 6,
    },
    addrRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    addrDot: {
        width: 10, height: 10,
        borderRadius: 5,
    },
    addrSquare: {
        width: 10, height: 10,
        borderRadius: 2,
    },
    addrLine: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        marginVertical: 4,
        marginLeft: 22,
    },

    // Stat pills
    pillRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: C.surfaceHigh,
        borderRadius: 50,
        borderWidth: 1,
        borderColor: C.border,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },

    // Buttons
    acceptBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.green,
        borderRadius: 50,
        paddingVertical: 18,
        gap: 8,
    },
    declineBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.35)',
        paddingVertical: 14,
        gap: 6,
    },
});
