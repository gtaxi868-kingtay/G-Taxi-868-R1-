import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Alert,
    Dimensions, Platform, BackHandler
} from 'react-native';
import MapView, { PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, withDelay, Easing,
    FadeIn,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ENV } from '../../../../shared/env';
import { supabase } from '../../../../shared/supabase';
import { cancelRide } from '../services/api';
import { fetchDriverDetails } from '../services/realtime';
import { Txt } from '../design-system/primitives';

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    red: tokens.colors.status.error,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function SearchingDriverScreen({ route, navigation }: any) {
    const { rideId, destination, fare, pickup, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [dots, setDots] = useState('');
    const [isCanceling, setIsCanceling] = useState(false);
    const [preferredDriver, setPreferredDriver] = useState<any>(null);
    const [isPriorityContact, setIsPriorityContact] = useState(false);
    const [showNegotiation, setShowNegotiation] = useState(false);
    const [negotiationType, setNegotiationType] = useState<'none' | 'busy'>('none');
    // FIX 7: Track queue state so rider knows they are waiting, not broken
    const [isInQueue, setIsInQueue] = useState(false);

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
        cancelOpacity.value = withDelay(3000, withTiming(1, { duration: 800 }));

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

        // Haptics: Light pulse every 2.5s
        const hapticInterval = setInterval(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }, 2500);

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
                    rating: driverData.rating || 4.8,
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
                if (payload.new.status === 'assigned' && payload.new.driver_id) {
                    setIsInQueue(false);
                    clearInterval(pollTimer);
                    await handleAssignment(payload.new.driver_id);
                }
            })
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

            if (ride?.status === "assigned" && ride?.driver_id) {
                setIsInQueue(false);
                clearInterval(pollTimer);
                sub.unsubscribe();
                await handleAssignment(ride.driver_id);
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
            clearInterval(hapticInterval);
            clearInterval(pollTimer);
            sub.unsubscribe();
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

    const handleCancel = async (silent = false) => {
        if (isCanceling) return;
        setIsCanceling(true);
        await cancelRide(rideId);
        if (!silent) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.navigate('Home');
        }
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Background: Mapbox dark-v11 (full screen) */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: pickup?.latitude || 10.66,
                    longitude: pickup?.longitude || -61.51,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05
                }}
                userInterfaceStyle="dark"
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}
            </MapView>

            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <LinearGradient colors={['rgba(7,5,15,0.6)', 'transparent', 'rgba(7,5,15,0.8)']} style={StyleSheet.absoluteFill} />
            </View>

            <Radar animation={radarRadius} opacity={radarOpacity} />

            {/* Status Overlay */}
            <View style={[s.content, { bottom: insets.bottom + 40 }]}>
                {isPriorityContact && preferredDriver && (
                    <Reanimated.View entering={FadeIn} style={s.priorityCard}>
                        <LinearGradient colors={['rgba(255, 215, 0, 0.1)', 'rgba(0, 255, 255, 0.05)']} style={StyleSheet.absoluteFill} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Ionicons name="star" size={24} color="#F59E0B" />
                            <View>
                                <Txt variant="bodyBold" color="#F59E0B">CONTACTING PREFERRED DRIVER</Txt>
                                <Txt variant="small" color="rgba(255,255,255,0.6)">{preferredDriver?.name} is nearby</Txt>
                            </View>
                        </View>
                    </Reanimated.View>
                )}

                <View style={s.statusCard}>
                    {/* FIX 7: Queue state feedback — never leave the rider guessing */}
                    {isInQueue ? (
                        <>
                            <Txt variant="displayXL" weight="heavy" color="#F59E0B" style={{ textAlign: 'center' }}>
                                You're in the queue ⏳
                            </Txt>
                            <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                                No drivers are available near you right now. We'll notify you the moment one becomes free — no need to cancel or restart.
                            </Txt>
                        </>
                    ) : (
                        <>
                            <Txt variant="displayXL" weight="heavy" color="#FFF" style={{ textAlign: 'center' }}>
                                {isPriorityContact ? 'Priority Match' : 'Finding your Rider'}{dots}
                            </Txt>
                            <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 12, textAlign: 'center' }}>
                                {isPriorityContact 
                                    ? `Securing ${preferredDriver?.name} for your trip...` 
                                    : 'Contacting drivers nearby...'}
                            </Txt>
                        </>
                    )}
                </View>

                <Reanimated.View style={[s.cancelWrap, { opacity: cancelOpacity }]}>
                    <TouchableOpacity 
                        style={s.cancelBtn} 
                        onPress={() => handleCancel()}
                        disabled={isCanceling}
                    >
                        <Txt variant="bodyBold" color={R.red}>Cancel Engagement</Txt>
                    </TouchableOpacity>
                </Reanimated.View>
            </View>

            {/* AI NEGOTIATION OVERLAY */}
            {showNegotiation && (
                <Reanimated.View entering={FadeIn} style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
                    <BlurView intensity={90} tint="dark" style={s.lockBlur}>
                        <View style={s.negotiationCard}>
                            <View style={s.aiAvatar}>
                                <LinearGradient colors={['#7B61FF', '#00FFFF']} style={StyleSheet.absoluteFill} />
                                <Ionicons name="sparkles" size={24} color="#FFF" />
                            </View>
                            
                            <Txt variant="headingM" color="#FFF" style={{ marginTop: 20, textAlign: 'center' }}>
                                CONCIERGE UPDATE
                            </Txt>
                            
                            <Txt variant="bodyReg" color="rgba(255,255,255,0.7)" style={{ marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                                Your favored driver, <Txt variant="bodyBold" color="#00FFFF">{preferredDriver?.name}</Txt>, is finishing a trip 8 mins away.
                                {"\n\n"}Would you like to wait for them, or find the nearest driver (2 mins)?
                            </Txt>

                            <View style={{ width: '100%', gap: 12, marginTop: 32 }}>
                                <TouchableOpacity 
                                    style={s.waitBtn} 
                                    onPress={() => {
                                        setShowNegotiation(false);
                                        setIsPriorityContact(true);
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    }}
                                >
                                    <Txt variant="bodyBold" color="#000">Wait for {preferredDriver?.name}</Txt>
                                </TouchableOpacity>
                                
                                <TouchableOpacity 
                                    style={s.skipBtn} 
                                    onPress={() => {
                                        setShowNegotiation(false);
                                        setPreferredDriver(null);
                                        setIsPriorityContact(false);
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    }}
                                >
                                    <Txt variant="bodyBold" color="#FFF">Find Nearest Driver</Txt>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </BlurView>
                </Reanimated.View>
            )}

        </View>
    );
}

function Radar({ animation, opacity }: any) {
    const ringStyle = useAnimatedStyle(() => ({
        width: animation.value,
        height: animation.value,
        borderRadius: animation.value / 2,
        opacity: opacity.value,
        borderWidth: 2,
        borderColor: tokens.colors.primary.cyan,
    }));

    return (
        <View style={s.radarContainer}>
            <Reanimated.View style={[s.radarRing, ringStyle]} />
            <View style={s.radarCore}>
                <LinearGradient 
                    colors={[tokens.colors.primary.purple, tokens.colors.primary.cyan]} 
                    style={StyleSheet.absoluteFill} 
                />
                <Ionicons name="radio" size={24} color="#FFF" />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    radarContainer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    radarRing: { position: 'absolute' },
    radarCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center', shadowColor: R.purpleLight, shadowRadius: 20, shadowOpacity: 0.6, overflow: 'hidden' },

    content: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
    priorityCard: { width: '100%', padding: 20, borderRadius: 24, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)' },
    statusCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, padding: 32, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    cancelWrap: { marginTop: 40, width: '100%' },
    cancelBtn: { height: 64, borderRadius: 24, backgroundColor: 'rgba(255,69,58,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,69,58,0.2)' },

    negotiationCard: { width: width * 0.85, padding: 32, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
    aiAvatar: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#00FFFF', shadowRadius: 15, shadowOpacity: 0.5 },
    waitBtn: { width: '100%', height: 64, borderRadius: 24, backgroundColor: '#00FFFF', alignItems: 'center', justifyContent: 'center' },
    skipBtn: { width: '100%', height: 64, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    lockBlur: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20 },
});
