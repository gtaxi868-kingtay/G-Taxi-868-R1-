import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity,
    ActivityIndicator, Dimensions, Text, Alert
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
import { GlassCard, BRAND, VOICES, RADIUS, SEMANTIC, GRADIENTS, StatusBadge } from '../design-system';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

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
        if (!offer?.ride_id) { setDetailLoading(false); return; }
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
    const arcColor = timeLeft > 5 ? BRAND.cyan : timeLeft > 2 ? SEMANTIC.warning : SEMANTIC.danger;

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }, { translateX: shakeX.value }] }));
    const fareStyle = useAnimatedStyle(() => ({ transform: [{ scale: fareScale.value }] }));

    return (
        <View style={s.overlay}>
             <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFill} />
            
            <Reanimated.View style={[s.sheet, { paddingBottom: insets.bottom + 20 }, sheetStyle]}>
                <GlassCard variant="driver" style={s.content}>
                    <View style={s.handle} />
                    
                    <View style={s.headerRow}>
                        <StatusBadge status="searching" label="NEW LOGISTICS OFFER" />
                        {isPreferred && (
                            <View style={s.prefBadge}>
                                <Ionicons name="star" size={12} color={BRAND.cyan} />
                                <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ marginLeft: 6 }}>PREFERRED</Txt>
                            </View>
                        )}
                    </View>

                    <View style={s.timerOuter}>
                        <View style={[s.arc, { borderColor: arcColor }]}>
                            <Reanimated.View style={[s.fareBox, fareStyle]}>
                                <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted} style={{ letterSpacing: 1.5 }}>EARNINGS</Txt>
                                <Txt variant="displayXL" weight="heavy" color={BRAND.cyan}>${driverEarnings.toFixed(2)}</Txt>
                                <Txt variant="caption" weight="heavy" color={arcColor}>{timeLeft}S REMAINING</Txt>
                            </Reanimated.View>
                        </View>
                    </View>

                    {detailLoading ? <ActivityIndicator color={BRAND.cyan} style={{ marginVertical: 40 }} /> : (
                        <View style={s.addressLayer}>
                            <Reanimated.View style={[s.addrRow, useAnimatedStyle(() => ({ transform: [{ translateX: pickupX.value }], opacity: pickupOp.value }))]}>
                                <View style={s.dot} />
                                <View style={{ flex: 1 }}>
                                    <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted}>PICKUP</Txt>
                                    <Txt variant="bodyBold" weight="heavy" color="#FFF" numberOfLines={1}>{rideDetail?.pickup_address || offer?.pickup_address || 'Current Location'}</Txt>
                                </View>
                            </Reanimated.View>
                            <View style={s.line} />
                            <Reanimated.View style={[s.addrRow, useAnimatedStyle(() => ({ transform: [{ translateX: dropoffX.value }], opacity: dropoffOp.value }))]}>
                                <View style={s.square} />
                                <View style={{ flex: 1 }}>
                                    <Txt variant="caption" weight="regular" color={VOICES.driver.textMuted}>DROPOFF</Txt>
                                    <Txt variant="bodyBold" weight="heavy" color="#FFF" numberOfLines={1}>{rideDetail?.dropoff_address || offer?.dropoff_address || 'Destination'}</Txt>
                                </View>
                            </Reanimated.View>
                        </View>
                    )}

                    <View style={s.statsGrid}>
                        <View style={s.statPill}>
                            <Ionicons name="navigate-outline" size={16} color={BRAND.cyan} />
                            <Txt variant="bodyReg" weight="heavy" color="#FFF" style={{ marginLeft: 8 }}>{distanceKm} KM</Txt>
                        </View>
                        <View style={s.statPill}>
                            <Ionicons name="time-outline" size={16} color={BRAND.cyan} />
                            <Txt variant="bodyReg" weight="heavy" color="#FFF" style={{ marginLeft: 8 }}>{offer?.duration_min || '?'} MIN</Txt>
                        </View>
                        <View style={s.statPill}>
                            <Ionicons name={paymentIcon(rideDetail?.payment_method || 'cash') as any} size={16} color={BRAND.cyan} />
                            <Txt variant="bodyReg" weight="heavy" color="#FFF" style={{ marginLeft: 8 }}>{paymentLabel(rideDetail?.payment_method || 'cash')}</Txt>
                        </View>
                    </View>

                    <View style={s.actionRow}>
                        <TouchableOpacity style={s.declineBtn} onPress={() => handleDecline(false)} disabled={isHandling}>
                            <Txt variant="bodyReg" weight="heavy" color={SEMANTIC.danger}>DECLINE</Txt>
                        </TouchableOpacity>
                        
                        <TouchableOpacity style={s.acceptBtn} onPress={handleAccept} disabled={isHandling} activeOpacity={0.9}>
                            <LinearGradient 
                                colors={[BRAND.cyan, '#0099FF']} 
                                style={s.acceptGradient}
                                start={GRADIENTS.primaryStart}
                                end={GRADIENTS.primaryEnd}
                            >
                                {isHandling ? <ActivityIndicator color="#0A0718" /> : (
                                    <>
                                        <Ionicons name="flash" size={20} color="#0A0718" />
                                        <Txt variant="bodyReg" weight="heavy" color="#0A0718" style={{ marginLeft: 8 }}>ACCEPT TRIP</Txt>
                                    </>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </GlassCard>
            </Reanimated.View>
        </View>
    );
}

const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
    sheet: { paddingHorizontal: 16 },
    content: { padding: 24, borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' },
    handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', alignSelf: 'center', marginBottom: 28 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 },
    prefBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,255,194,0.06)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,255,194,0.1)' },
    
    timerOuter: { alignItems: 'center', marginBottom: 44, shadowColor: BRAND.cyan, shadowRadius: 20, shadowOpacity: 0.1 },
    arc: { width: ARC_SIZE, height: ARC_SIZE, borderRadius: ARC_SIZE / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center', borderStyle: 'solid', backgroundColor: 'rgba(0,255,194,0.02)' },
    fareBox: { alignItems: 'center' },
    
    addressLayer: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 24, padding: 20, marginBottom: 36, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    addrRow: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: BRAND.cyan, marginRight: 16, shadowColor: BRAND.cyan, shadowRadius: 4, shadowOpacity: 0.5 },
    square: { width: 12, height: 12, borderRadius: 3, backgroundColor: SEMANTIC.warning, marginRight: 16, shadowColor: SEMANTIC.warning, shadowRadius: 4, shadowOpacity: 0.5 },
    line: { width: 2, height: 28, backgroundColor: 'rgba(255,255,255,0.05)', marginLeft: 5, marginVertical: 4 },

    statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 44 },
    statPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)', paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    actionRow: { flexDirection: 'row', gap: 16 },
    declineBtn: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.05)' },
    acceptBtn: { flex: 2, height: 64, borderRadius: 32, overflow: 'hidden', shadowColor: BRAND.cyan, shadowRadius: 15, shadowOpacity: 0.4, elevation: 8 },
    acceptGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
