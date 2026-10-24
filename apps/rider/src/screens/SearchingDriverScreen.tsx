import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, Modal, useWindowDimensions } from 'react-native';
import MapView, { PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, withDelay, Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandBadge, Button, Card, GUTTER, RADIUS, SPACE, Txt, useTheme } from '../ui/kit';
import { ENV } from '@g868/shared/env';
import { supabase } from '@gtaxi/core';
import { cancelRide, matchDriver } from '../services/api';
import { fetchDriverDetails } from '../services/realtime';
import { CancelReasonSheet } from '../components/CancelReasonSheet';

const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0B0814' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#B9AEFF' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0B0814' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1C1626' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0E1A24' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] }
];

export function SearchingDriverScreen({ route, navigation }: any) {
    const { height } = useWindowDimensions();
    const { rideId, destination, fare, pickup, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [dots, setDots] = useState('');
    const [reasonOpen, setReasonOpen] = useState(false);
    const [isCanceling, setIsCanceling] = useState(false);
    const [preferredDriver, setPreferredDriver] = useState<any>(null);
    const [isPriorityContact, setIsPriorityContact] = useState(false);
    const [showNegotiation, setShowNegotiation] = useState(false);
    const [negotiationType, setNegotiationType] = useState<'none' | 'busy'>('none');
    // FIX 7: Track queue state so rider knows they are waiting, not broken
    const [isInQueue, setIsInQueue] = useState(false);
    // FIX F6: Track driver rejections for toast and auto-retry
    const [showRejectionToast, setShowRejectionToast] = useState(false);
    const [rejectionCount, setRejectionCount] = useState(0);

    // Reanimated Values
    const radarRadius = useSharedValue(0);
    const radarOpacity = useSharedValue(1);
    const cancelOpacity = useSharedValue(0);

    useEffect(() => {
        // Radar Animation: Ring expanding 0 to 200, withRepeat -1
        radarRadius.value = withRepeat(
            withTiming(200, { duration: 2500, easing: Easing.out(Easing.quad) }),
            -1, false
        );
        radarOpacity.value = withRepeat(
            withTiming(0, { duration: 2500, easing: Easing.out(Easing.quad) }),
            -1, false
        );

        // Cancel button: Delayed 3s before appearing
        cancelOpacity.value = withDelay(1500, withTiming(1, { duration: 400 }));

        // Dots Animation
        const dotInterval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);

        // CHECK FAVORED DRIVER
        const checkPreferred = async () => {
            const { data: pref } = await supabase
                .from('user_preferred_drivers')
                .select('driver_id, drivers(name, is_online, rating)')
                .order('rank', { ascending: true })
                .limit(1);
            
            if (pref && pref.length > 0) {
                const driver = pref[0].drivers as any;
                if (driver.is_online) {
                    setPreferredDriver(driver);
                    
                    if (driver.status === 'busy') {
                        // FAVORED IS BUSY: Trigger Negotiation
                        setNegotiationType('busy');
                        setShowNegotiation(true);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    } else {
                        setIsPriorityContact(true);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        // Turn off priority after 30s
                        setTimeout(() => setIsPriorityContact(false), 30000);
                    }
                }
            }
        };
        checkPreferred();


        // Helper: navigate to DriverFound confirmation, which then routes to ActiveRide
        const goToActiveRide = async (driverId: string, pmOverride?: string) => {
            try {
                const { data: driverData, error: driverErr } = await supabase
                    .from("drivers")
                    .select("id, name, vehicle_model, plate_number, vehicle_type, rating, lat, lng")
                    .eq("id", driverId)
                    .single();

                if (driverErr) throw driverErr;

                const driverParams = {
                    name: driverData.name,
                    vehicle: driverData.vehicle_model,
                    id: driverData.id,
                    plate: driverData.plate_number,
                    // No invented rating: DriverFound shows "New" when this is null.
                    rating: typeof driverData.rating === 'number' && driverData.rating > 0 ? driverData.rating : null,
                };

                // Navigate to DriverFound confirmation first
                navigation.replace("DriverFound", {
                    rideId,
                    driver: driverParams,
                    // DriverFoundScreen passes these through to ActiveRide
                    _activeRideParams: {
                        destination,
                        fare,
                        driver: driverParams,
                        rideId,
                        pickup,
                        paymentMethod: pmOverride || (route.params?.paymentMethod),
                    },
                });
            } catch (e) {
                // Fallback: go straight to ActiveRide if DriverFound fails
                console.warn("goToActiveRide failed, falling back to ActiveRide:", e);
                navigation.replace("ActiveRide", { destination, fare, rideId, pickup });
            }
        };


        // Polling/Subscription for Assignment
        const sub = supabase.channel(`ride_${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, async (payload) => {
                // FIX 7: Detect waiting_queue status and show rider feedback immediately
                if (payload.new.status === 'waiting_queue') {
                    setIsInQueue(true);
                }
                if (payload.new.status === 'requested' || payload.new.status === 'searching') {
                    setIsInQueue(false);
                }
                if (payload.new.status === 'assigned' && payload.new.driver_id) {
                    setIsInQueue(false);
                    clearInterval(pollTimer);
                    await handleAssignment(payload.new.driver_id);
                }
                if (payload.new.status === 'cancelled') {
                    clearInterval(pollTimer);
                    sub.unsubscribe();
                    setIsCanceling(true);
                    Alert.alert('Ride Cancelled', 'Your request timed out or was cancelled.');
                    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }
            })
            .subscribe();

        // FIX F6: Watch for driver rejections and auto-retry
        const offersChannel = supabase.channel(`ride_offers_${rideId}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'ride_offers', filter: `ride_id=eq.${rideId}` },
                (payload) => {
                    if (payload.new.status === 'declined') {
                        setRejectionCount(prev => prev + 1);
                        setShowRejectionToast(true);

                        // Auto-retry matching after 10 seconds. Was routed through a
                        // server-side RPC (retry_ride_matching) that called
                        // net.http_post with a body type mismatch against this
                        // project's real pg_net signature — it always threw, and
                        // the call wasn't even awaited, so the failure was silent.
                        // Every driver decline left the rider stuck in "searching"
                        // with no real retry. matchDriver() is the same real,
                        // working call the initial dispatch already uses.
                        setTimeout(() => {
                            matchDriver(rideId).catch(() => {});
                            setShowRejectionToast(false);
                        }, 10000);
                    }
                }
            )
            .subscribe();

        // Polling fallback (backup path — runs every 3 seconds)
        const pollTimer = setInterval(async () => {
            const { data: ride, error } = await supabase
                .from("rides")
                .select("id, status, driver_id, payment_method")
                .eq("id", rideId)
                .single();

            // FIX 7: Surface the queue state to the rider on each poll
            if (ride?.status === "waiting_queue") {
                setIsInQueue(true);
            }
            if (ride?.status === 'requested' || ride?.status === 'searching') {
                setIsInQueue(false);
            }

            if (ride?.status === "assigned" && ride?.driver_id) {
                setIsInQueue(false);
                clearInterval(pollTimer);
                sub.unsubscribe();
                await handleAssignment(ride.driver_id);
            }
            if (ride?.status === "cancelled") {
                clearInterval(pollTimer);
                sub.unsubscribe();
                setIsCanceling(true);
                Alert.alert('Ride Cancelled', 'Your request timed out or was cancelled.');
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }
        }, 3000);

        const beforeRemoveListener = navigation.addListener('beforeRemove', (e: any) => {
            if (isCanceling) return; // Allow navigation if explicitly canceling

            // Prevent default behavior of leaving the screen
            e.preventDefault();

            Alert.alert(
                'Cancel Ride?',
                'Are you sure you want to stop searching for a ride?',
                [
                    { text: "Don't Cancel", style: 'cancel', onPress: () => { } },
                    {
                        text: 'Cancel Ride',
                        style: 'destructive',
                        onPress: () => {
                            handleCancel();
                            navigation.dispatch(e.data.action);
                        },
                    },
                ]
            );
        });

        return () => {
            clearInterval(dotInterval);
            clearInterval(pollTimer);
            sub.unsubscribe();
            // Fix 3: Unsubscribe offersChannel to prevent state updates on unmounted component
            offersChannel.unsubscribe();
            beforeRemoveListener();
        };
    }, []);

    const handleAssignment = async (driverId: string) => {
        const driverData = await fetchDriverDetails(driverId);
        navigation.replace('ActiveRide', {
            rideId,
            destination,
            fare,
            pickup,
            driver: driverData,
            paymentMethod
        });
    };

    const handleCancel = async (silent = false, reasonCode: string | null = null) => {
        if (isCanceling) return;
        setIsCanceling(true);
        setReasonOpen(false);
        await cancelRide(rideId, reasonCode);
        if (!silent) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.navigate('Home');
        }
    };

    const cancelStyle = useAnimatedStyle(() => ({ opacity: cancelOpacity.value }));
    const m = useTheme();
    const night = m.key === 'night';
    const tileStyle = night ? 'navigation-night-v1' : 'light-v11';

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />

            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={night ? DARK_MAP_STYLE : []}
                initialRegion={{ latitude: pickup?.latitude || 10.66, longitude: pickup?.longitude || -61.51, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
                userInterfaceStyle={night ? 'dark' : 'light'}
                scrollEnabled={false}
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile key={tileStyle} urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/${tileStyle}/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`} shouldReplaceMapContent={true} />
                )}
            </MapView>
            <LinearGradient pointerEvents="none" colors={[m.page + 'CC', 'transparent', m.page]} locations={[0, 0.4, 0.75]} style={StyleSheet.absoluteFillObject} />

            {/* Pulse over the pickup point */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.5, alignItems: 'center', justifyContent: 'center' }}>
                <Radar animation={radarRadius} opacity={radarOpacity} />
            </View>

            {/* Status + cancel, at the bottom */}
            <View style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                {isPriorityContact && preferredDriver && (
                    <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.md }}>
                        <Ionicons name="star" size={20} color={m.accent} />
                        <View style={{ marginLeft: SPACE.md, flex: 1 }}>
                            <Txt variant="bodyStrong">Asking your favourite driver first</Txt>
                            <Txt variant="caption" tone="dim">{preferredDriver?.name} is nearby</Txt>
                        </View>
                    </Card>
                )}

                {showRejectionToast && (
                    <Card style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.md }}>
                        <Ionicons name="people-outline" size={18} color={m.accent} />
                        <Txt variant="body" style={{ marginLeft: SPACE.md, flex: 1 }}>Drivers nearby are busy. Looking a little further{dots}</Txt>
                    </Card>
                )}

                <Card style={{ padding: SPACE.xl, alignItems: 'center' }}>
                    {isInQueue ? (
                        <>
                            <Txt variant="title" style={{ textAlign: 'center' }}>You're next in line</Txt>
                            <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>
                                Every driver nearby is on a trip. We'll match you the moment one is free. No need to cancel or try again.
                            </Txt>
                        </>
                    ) : (
                        <>
                            <Txt variant="hero" style={{ textAlign: 'center', fontSize: 30, lineHeight: 36 }}>
                                {isPriorityContact ? 'Asking your driver' : 'Finding your driver'}{dots}
                            </Txt>
                            <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>
                                {destination?.address ? `To ${destination.address.split(',')[0]}` : 'Contacting drivers near you'}
                                {fare?.total_fare_cents ? ` · about $${(fare.total_fare_cents / 100).toFixed(2)}` : ''}
                            </Txt>
                        </>
                    )}
                </Card>

                <Reanimated.View style={[{ marginTop: SPACE.md }, cancelStyle]}>
                    <Button title="Cancel request" variant="ghost" disabled={isCanceling} onPress={() => setReasonOpen(true)} />
                </Reanimated.View>
                <CancelReasonSheet visible={reasonOpen} onPick={(code) => handleCancel(false, code)} onClose={() => setReasonOpen(false)} />
            </View>

            {/* Favourite driver is on another trip */}
            <Modal visible={showNegotiation} transparent animationType="fade" onRequestClose={() => setShowNegotiation(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(10,6,20,0.55)', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: m.sheet[1], borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: GUTTER, paddingBottom: Math.max(insets.bottom, SPACE.lg) + SPACE.sm }}>
                        <Txt variant="title">{preferredDriver?.name} is on another trip</Txt>
                        <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>
                            You can wait for your favourite driver, or take the nearest driver now.
                        </Txt>
                        <Button title="Take the nearest driver" style={{ marginTop: SPACE.xl }} onPress={() => {
                            setShowNegotiation(false); setPreferredDriver(null); setIsPriorityContact(false);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }} />
                        <Button title={`Wait for ${preferredDriver?.name || 'my driver'}`} variant="ghost" style={{ marginTop: SPACE.md }} onPress={() => {
                            setShowNegotiation(false); setIsPriorityContact(true);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }} />
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function Radar({ animation, opacity }: any) {
    const ring = (scale: number, alpha: number, color: string) => useAnimatedStyle(() => ({
        position: 'absolute',
        width: animation.value * scale,
        height: animation.value * scale,
        borderRadius: (animation.value * scale) / 2,
        opacity: opacity.value * alpha,
        borderWidth: 2,
        borderColor: color,
    }));
    const r1 = ring(1, 1, '#3FD9E8');
    const r2 = ring(0.7, 0.7, '#8B7CFF');
    const r3 = ring(0.4, 0.5, '#3FD9E8');
    return (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Reanimated.View style={r1} />
            <Reanimated.View style={r2} />
            <Reanimated.View style={r3} />
            <BrandBadge icon="car-sport" size={64} round />
        </View>
    );
}
