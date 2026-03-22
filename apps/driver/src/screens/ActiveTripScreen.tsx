import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity,
    Alert, Linking, Platform, Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withSpring, withTiming, withRepeat, withSequence,
    useAnimatedStyle, interpolate, Easing,
} from 'react-native-reanimated';
import { supabase } from '../../../../shared/supabase';
import { ENV } from '../../../../shared/env';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { updateRideStatus } from '../services/api';
import { Txt } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';

const { height } = Dimensions.get('window');
const CARD_HEIGHT = 230;

// ── Design Tokens (driver app only — never import from rider) ─────────────────
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

// ── Phase track config ────────────────────────────────────────────────────────
const PHASES = ['En Route', 'Arrived', 'In Progress'];
function getPhaseIndex(status: string): number {
    if (status === 'assigned') return 0;
    if (status === 'arrived') return 1;
    if (status === 'in_progress') return 2;
    return 0;
}

// ── Status bubble text ────────────────────────────────────────────────────────
function statusText(status: string): string {
    if (status === 'assigned') return 'En route to pickup';
    if (status === 'arrived') return 'Waiting for rider';
    if (status === 'in_progress') return 'Heading to destination';
    return '';
}

// ── decodePolyline (DO NOT TOUCH) ─────────────────────────────────────────────
function decodePolyline(encoded: string) {
    if (!encoded) return [];
    let poly: { latitude: number; longitude: number }[] = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
        poly.push({ latitude: (lat / 1e5), longitude: (lng / 1e5) });
    }
    return poly;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ActiveTripScreen({ route, navigation }: any) {
    const { rideId } = route.params;
    const insets = useSafeAreaInsets();
    const { location } = useLocationTracking();

    const [ride, setRide] = useState<any>(null);
    const [rider, setRider] = useState<any>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);
    const [isSosLoading, setIsSosLoading] = useState(false);

    // ── Reanimated ────────────────────────────────────────────────────────────
    const cardY = useSharedValue(CARD_HEIGHT);
    const phaseWidth = useSharedValue(0);          // 0 → 1 → 2 as thirds of track
    const statusOp = useSharedValue(1);
    const sosRing = useSharedValue(0);

    // ── Mount ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        cardY.value = withSpring(0, { damping: 18, stiffness: 160 });
        // SOS ring pulse — 4s loop
        sosRing.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }),
                withTiming(0, { duration: 400 })
            ),
            -1, false
        );
    }, []);

    // ── Update phase track when ride status changes ────────────────────────────
    useEffect(() => {
        if (!ride?.status) return;
        const idx = getPhaseIndex(ride.status);
        phaseWidth.value = withSpring(idx / 2, { damping: 16, stiffness: 140 });
        // Fade status bubble text
        statusOp.value = withSequence(
            withTiming(0, { duration: 200 }),
            withTiming(1, { duration: 250 })
        );
    }, [ride?.status]);

    // ── Data fetch + realtime subscription (DO NOT TOUCH) ─────────────────────
    useEffect(() => {
        supabase
            .from('rides')
            .select('*, rider:rider_id(id, raw_user_meta_data, name, phone_number)')
            .eq('id', rideId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setRide(data);
                    setRider(data.rider);
                    if (data.route_geometry) setRouteCoords(decodePolyline(data.route_geometry));
                }
            });

        const sub = supabase.channel(`ride_${rideId}`)
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'rides',
                filter: `id=eq.${rideId}`
            }, (payload) => {
                setRide(payload.new);
            })
            .subscribe();

        return () => { sub.unsubscribe(); };
    }, [rideId]);

    // ── Status updaters ───────────────────────────────────────────────────────
    const handleStatusChange = async (newStatus: 'arrived' | 'in_progress' | 'completed') => {
        const { error } = await updateRideStatus(rideId, newStatus);
        if (!error) setRide((prev: any) => ({ ...prev, status: newStatus }));
    };

    // handleArrived — updates status to arrived
    const handleArrived = async () => {
        await handleStatusChange('arrived');
    };

    // handleComplete — has Alert confirmation, updates to completed
    const handleComplete = async () => {
        Alert.alert(
            'Complete Trip',
            'Are you sure you want to end this trip?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Complete',
                    style: 'default',
                    onPress: async () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        const lat = location?.coords?.latitude;
                        const lng = location?.coords?.longitude;
                        if (!lat || !lng) {
                            Alert.alert('Location Required', 'Cannot complete trip without GPS signal.');
                            return;
                        }
                        const { error } = await updateRideStatus(rideId, 'completed', lat, lng);
                        if (error) {
                            Alert.alert('Error', 'Could not complete trip. Try again.');
                        } else {
                            setRide((prev: any) => ({ ...prev, status: 'completed' }));
                        }
                    }
                }
            ]
        );
    };

    // handleCancel — Alert confirmation guard (kept exactly)
    const handleCancel = () => {
        Alert.alert(
            'Cancel Trip',
            'Are you sure you want to cancel this trip?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: async () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        await supabase.functions.invoke('cancel_ride', { body: { ride_id: rideId } });
                        navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
                    }
                }
            ]
        );
    };

    // handleSOS — double Alert guard, trigger_emergency edge function (DO NOT TOUCH)
    const handleSOS = () => {
        Alert.alert(
            'EMERGENCY SOS',
            'This will immediately text your emergency contact with your live location and flag this ride to Admin Security. Trigger SOS?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'TRIGGER SOS',
                    style: 'destructive',
                    onPress: async () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        setIsSosLoading(true);
                        try {
                            await supabase.functions.invoke('trigger_emergency', { body: { ride_id: rideId } });
                            Alert.alert('SOS Triggered', 'Security monitoring activated. Emergency contacts notified.');
                        } catch {
                            Alert.alert('Alert Failed', 'Unable to trigger network alert. Call 911 directly if in immediate danger.');
                        } finally {
                            setIsSosLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const openNavigation = () => {
        if (!ride) return;
        const dest = ride.status === 'assigned'
            ? `${ride.pickup_lat},${ride.pickup_lng}`
            : `${ride.dropoff_lat},${ride.dropoff_lng}`;
        const url = Platform.select({
            ios: `maps://app?daddr=${dest}`,
            android: `google.navigation:q=${dest}`,
        });
        if (url) Linking.openURL(url);
    };

    const currentLat = location?.coords?.latitude || ride?.pickup_lat || 0;
    const currentLng = location?.coords?.longitude || ride?.pickup_lng || 0;

    // ── Animated styles ───────────────────────────────────────────────────────
    const cardStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: cardY.value }],
    }));
    const phaseBarStyle = useAnimatedStyle(() => ({
        width: `${phaseWidth.value * 100}%` as any,
    }));
    const statusBubbleStyle = useAnimatedStyle(() => ({
        opacity: statusOp.value,
    }));
    const sosRingStyle = useAnimatedStyle(() => ({
        opacity: interpolate(sosRing.value, [0, 1], [0, 0.7]),
        transform: [{ scale: interpolate(sosRing.value, [0, 1], [1, 1.8]) }],
    }));

    // ── Completed screen ──────────────────────────────────────────────────────
    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const fare = ride.total_fare_cents ? ride.total_fare_cents / 100 : 0;
        const earnings = (fare * DRIVER_SHARE).toFixed(2);

        return (
            <View style={[s.root, { justifyContent: 'center', padding: 24 }]}>
                <LinearGradient colors={['#2D1B69', '#1E1040', '#110E22']} style={s.completedCard}>
                    <View style={s.successCircle}>
                        <Ionicons name="checkmark-circle" size={48} color={C.green} />
                    </View>
                    <Txt variant="headingL" weight="bold" color={C.white} style={{ marginBottom: 6, textAlign: 'center' }}>
                        Trip Completed!
                    </Txt>
                    <Txt variant="bodyReg" color={C.muted} style={{ marginBottom: 28, textAlign: 'center' }}>
                        Great job. You made it safely.
                    </Txt>

                    <View style={s.earningsBlock}>
                        <Txt variant="caption" weight="bold" color={C.gold} style={{ letterSpacing: 1 }}>
                            YOUR EARNINGS · 81%
                        </Txt>
                        <Txt style={{ fontSize: 48, fontWeight: '800', color: C.gold, marginVertical: 4 }}>
                            ${earnings}
                        </Txt>
                        <Txt variant="bodyReg" color={C.muted}>
                            {ride.payment_method === 'cash' ? 'Cash' : ride.payment_method === 'wallet' ? 'Wallet' : 'Card'} · TTD
                        </Txt>
                        {ride.payment_method === 'cash' && (
                            <View style={s.cashBadge}>
                                <Txt variant="bodyBold" color={C.bg}>Collect ${fare.toFixed(2)} cash</Txt>
                            </View>
                        )}
                    </View>

                    <TouchableOpacity
                        style={s.dashBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
                        }}
                    >
                        <Txt variant="bodyBold" color={C.white}>Back to Dashboard</Txt>
                    </TouchableOpacity>
                </LinearGradient>
            </View>
        );
    }

    const riderName = rider?.name || rider?.raw_user_meta_data?.name || 'Rider';
    const riderPhone = rider?.phone_number || rider?.raw_user_meta_data?.phone || '';

    return (
        <View style={s.root}>
            {/* ── MAP ──────────────────────────────────────────────────────── */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: currentLat, longitude: currentLng,
                    latitudeDelta: 0.05, longitudeDelta: 0.05,
                }}
                showsUserLocation={false}
            >
                {/* Mapbox dark tiles — matches DashboardScreen */}
                <UrlTile
                    urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                    shouldReplaceMapContent={true}
                    maximumZ={19}
                    flipY={false}
                />

                {/* Driver marker */}
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={s.driverMarker}>
                        <Ionicons name="car-sport" size={22} color={C.purple} />
                    </View>
                </Marker>

                {/* Destination marker */}
                {ride && (
                    <Marker coordinate={{
                        latitude: ride.status === 'assigned' ? ride.pickup_lat : ride.dropoff_lat,
                        longitude: ride.status === 'assigned' ? ride.pickup_lng : ride.dropoff_lng,
                    }}>
                        <View style={s.destMarker} />
                    </Marker>
                )}

                {/* Route polyline */}
                {routeCoords.length > 0 && (
                    <Polyline
                        coordinates={routeCoords}
                        strokeColor={C.purple}
                        strokeWidth={4}
                        lineCap="round"
                    />
                )}
            </MapView>

            {/* ── STATUS BUBBLE — top center ───────────────────────────────── */}
            <Reanimated.View style={[s.statusBubble, { top: insets.top + 16 }, statusBubbleStyle]}>
                <BlurView tint="dark" intensity={70} style={s.statusBlurFill}>
                    <View style={s.statusDot} />
                    <Txt variant="bodyBold" color={C.white}>
                        {statusText(ride?.status || 'assigned')}
                    </Txt>
                </BlurView>
            </Reanimated.View>

            {/* ── SOS BUTTON — top right ───────────────────────────────────── */}
            <View style={[s.sosWrap, { top: insets.top + 12 }]}>
                {/* Pulse ring */}
                <Reanimated.View style={[s.sosRing, sosRingStyle]} />
                <TouchableOpacity
                    style={s.sosBtn}
                    onPress={handleSOS}
                    disabled={isSosLoading}
                    activeOpacity={0.85}
                >
                    <Txt variant="bodyBold" color={C.white} style={{ fontSize: 15, letterSpacing: 1 }}>
                        {isSosLoading ? '...' : 'SOS'}
                    </Txt>
                </TouchableOpacity>
            </View>

            {/* ── CANCEL X — top left nav button ──────────────────────────── */}
            <TouchableOpacity
                style={[s.cancelBtn, { top: insets.top + 12, left: 20 }]}
                onPress={handleCancel}
                activeOpacity={0.8}
            >
                <Ionicons name="close" size={20} color={C.muted} />
            </TouchableOpacity>

            {/* ── BOTTOM CARD ──────────────────────────────────────────────── */}
            <Reanimated.View style={[s.cardOuter, cardStyle]}>
                <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
                <LinearGradient
                    colors={['#1A1530', '#110E22', '#0D0B1A']}
                    style={s.cardInner}
                >
                    {/* ── PHASE TRACK ──────────────────────────────────────── */}
                    <View style={s.phaseTrackWrap}>
                        {/* Background track */}
                        <View style={s.phaseTrackBg} />
                        {/* Animated purple fill */}
                        <Reanimated.View style={[s.phaseTrackFill, phaseBarStyle]} />

                        {/* Phase labels */}
                        <View style={s.phaseLabels}>
                            {PHASES.map((label, i) => {
                                const phaseIdx = getPhaseIndex(ride?.status || 'assigned');
                                const active = i <= phaseIdx;
                                return (
                                    <View key={label} style={s.phaseItem}>
                                        <View style={[s.phaseDot, { backgroundColor: active ? C.purple : C.surfaceHigh, borderColor: active ? C.purple : C.border }]} />
                                        <Txt variant="small" color={active ? C.purpleLight : C.muted} style={{ marginTop: 5 }}>
                                            {label}
                                        </Txt>
                                    </View>
                                );
                            })}
                        </View>
                    </View>

                    {/* ── RIDER INFO ROW ───────────────────────────────────── */}
                    <View style={s.riderRow}>
                        <View style={s.riderAvatar}>
                            <Txt variant="headingM" color={C.purpleLight}>
                                {riderName.charAt(0).toUpperCase()}
                            </Txt>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold" weight="bold" color={C.white}>{riderName}</Txt>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                <Txt variant="small" color={C.muted}>⭐ 5.0</Txt>
                                <View style={s.midDot} />
                                <Ionicons
                                    name={ride?.payment_method === 'cash' ? 'cash-outline' : ride?.payment_method === 'wallet' ? 'wallet-outline' : 'card-outline'}
                                    size={13} color={C.muted}
                                />
                                <Txt variant="small" color={C.muted}>
                                    {ride?.payment_method === 'cash' ? 'Cash' : ride?.payment_method === 'wallet' ? 'Wallet' : 'Card'}
                                </Txt>
                            </View>
                        </View>

                        {/* Message rider */}
                        <TouchableOpacity
                            style={s.msgBtn}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                navigation.navigate('Chat', { rideId, rider });
                            }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.white} />
                        </TouchableOpacity>

                        {/* Call rider */}
                        <TouchableOpacity
                            style={s.callBtn}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                Linking.openURL(`tel:${riderPhone}`);
                            }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="call-outline" size={20} color={C.white} />
                        </TouchableOpacity>
                    </View>

                    {/* ── ACTION BUTTON ROW ────────────────────────────────── */}
                    <View style={s.actionRow}>
                        {/* Navigate button */}
                        <TouchableOpacity
                            style={s.navBtn}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                openNavigation();
                            }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="navigate-outline" size={18} color={C.purpleLight} />
                        </TouchableOpacity>

                        {/* Main status action */}
                        {ride?.status === 'assigned' && (
                            <TouchableOpacity
                                style={[s.mainBtn, { backgroundColor: C.green }]}
                                onPress={async () => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                    await handleArrived();
                                }}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="checkmark-outline" size={20} color={C.white} />
                                <Txt variant="bodyBold" color={C.white}> I've Arrived</Txt>
                            </TouchableOpacity>
                        )}

                        {ride?.status === 'arrived' && (
                            <TouchableOpacity
                                style={[s.mainBtn, { backgroundColor: C.purple }]}
                                onPress={async () => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                    await handleStatusChange('in_progress');
                                }}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="play-outline" size={20} color={C.white} />
                                <Txt variant="bodyBold" color={C.white}> Start Trip</Txt>
                            </TouchableOpacity>
                        )}

                        {ride?.status === 'in_progress' && (
                            <TouchableOpacity
                                style={[s.mainBtn, { backgroundColor: C.gold }]}
                                onPress={handleComplete}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="flag-outline" size={20} color={C.bg} />
                                <Txt variant="bodyBold" color={C.bg}> Complete Trip</Txt>
                            </TouchableOpacity>
                        )}
                    </View>
                </LinearGradient>
            </Reanimated.View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    // Status bubble
    statusBubble: {
        position: 'absolute', alignSelf: 'center',
        borderRadius: 50, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)',
        zIndex: 10,
    },
    statusBlurFill: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 10, gap: 8,
    },
    statusDot: {
        width: 7, height: 7, borderRadius: 3.5,
        backgroundColor: C.green,
    },

    // SOS
    sosWrap: {
        position: 'absolute', right: 20, zIndex: 20,
        alignItems: 'center', justifyContent: 'center',
    },
    sosRing: {
        position: 'absolute',
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: C.red,
    },
    sosBtn: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: C.red,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
        shadowColor: C.red, shadowOpacity: 0.6, shadowRadius: 12,
        elevation: 12,
    },

    // Cancel
    cancelBtn: {
        position: 'absolute', zIndex: 10,
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(7,5,15,0.8)',
        borderWidth: 1, borderColor: C.border,
        alignItems: 'center', justifyContent: 'center',
    },

    // Markers
    driverMarker: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: C.surfaceHigh,
        borderWidth: 2, borderColor: C.purple,
        justifyContent: 'center', alignItems: 'center',
    },
    destMarker: {
        width: 14, height: 14, borderRadius: 3,
        backgroundColor: C.white,
        borderWidth: 2, borderColor: C.bg,
    },

    // Bottom card
    cardOuter: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: CARD_HEIGHT,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        overflow: 'hidden',
        borderTopWidth: 1, borderColor: C.border,
    },
    cardInner: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },

    // Phase track
    phaseTrackWrap: {
        marginBottom: 18, height: 48,
        justifyContent: 'flex-end',
    },
    phaseTrackBg: {
        position: 'absolute', left: 0, right: 0,
        height: 3, borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        top: 10,
    },
    phaseTrackFill: {
        position: 'absolute', left: 0,
        height: 3, borderRadius: 2,
        backgroundColor: C.purple,
        top: 10,
    },
    phaseLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    phaseItem: { alignItems: 'center', flex: 1 },
    phaseDot: {
        width: 12, height: 12, borderRadius: 6,
        borderWidth: 2,
    },

    // Rider row
    riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    riderAvatar: {
        width: 46, height: 46, borderRadius: 23,
        backgroundColor: C.purpleDim,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)',
    },
    midDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.muted },
    msgBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: C.surfaceHigh,
        borderWidth: 1, borderColor: C.border,
        alignItems: 'center', justifyContent: 'center',
    },
    callBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: C.surfaceHigh,
        borderWidth: 1, borderColor: C.border,
        alignItems: 'center', justifyContent: 'center',
    },

    // Actions
    actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    navBtn: {
        width: 46, height: 46, borderRadius: 23,
        backgroundColor: C.surfaceHigh,
        borderWidth: 1, borderColor: C.border,
        alignItems: 'center', justifyContent: 'center',
    },
    mainBtn: {
        flex: 1, flexDirection: 'row', gap: 8,
        alignItems: 'center', justifyContent: 'center',
        height: 46, borderRadius: 23,
    },

    // Completed screen
    completedCard: {
        borderRadius: 28, padding: 32,
        alignItems: 'center', width: '100%',
        borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)',
    },
    successCircle: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: C.greenDim,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
    },
    earningsBlock: {
        width: '100%', alignItems: 'center',
        paddingVertical: 24,
        backgroundColor: 'rgba(245,158,11,0.06)',
        borderRadius: 20,
        borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)',
        marginBottom: 24,
    },
    cashBadge: {
        marginTop: 12,
        backgroundColor: C.gold,
        paddingHorizontal: 20, paddingVertical: 8,
        borderRadius: 20,
    },
    dashBtn: {
        width: '100%', paddingVertical: 16,
        borderRadius: 50, backgroundColor: C.purple,
        alignItems: 'center',
    },
});
