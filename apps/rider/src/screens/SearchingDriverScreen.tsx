import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Alert,
    Dimensions, Platform, BackHandler, Image
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

const { width, height } = Dimensions.get('window');

// Blueberry Luxe Color System
const COLORS = {
    bgPrimary: '#0D0B1E',
    bgSecondary: '#160B32',
    purple: '#7B5CF0',
    purpleDark: '#5B3FD0',
    cyan: '#00E5FF',
    white: '#FFFFFF',
    textSecondary: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.5)',
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(123,92,240,0.3)',
    error: '#FF4D6D',
    warning: '#F59E0B',
};

// Custom Dark Map Style for Blueberry Luxe
const DARK_MAP_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0d0b1e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7B5CF0' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0b1e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1040' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#7B5CF0', weight: 0.5 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#00E5FF', lightness: -80 }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] }
];

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

                        // Auto-trigger match_driver after 10 seconds
                        setTimeout(() => {
                            supabase.functions.invoke('match_driver', {
                                body: { ride_id: rideId }
                            });
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

            {/* Background: Full Screen Map with Blueberry Luxe Dark Style */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
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

            {/* Deep Gradient Overlay */}
            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <LinearGradient 
                    colors={['rgba(13,11,30,0.7)', 'transparent', 'rgba(13,11,30,0.9)']} 
                    style={StyleSheet.absoluteFillObject} 
                />
            </View>

            <Radar animation={radarRadius} opacity={radarOpacity} />

            {/* Status Overlay */}
            <View style={[s.content, { bottom: insets.bottom + 40 }]}>
                {isPriorityContact && preferredDriver && (
                    <Reanimated.View entering={FadeIn} style={s.priorityCard}>
                        <LinearGradient 
                            colors={['rgba(245, 158, 11, 0.15)', 'rgba(0, 229, 255, 0.08)']} 
                            style={StyleSheet.absoluteFillObject} 
                        />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <Ionicons name="star" size={24} color={COLORS.warning} />
                            <View>
                                <Text style={s.priorityTitle}>CONTACTING PREFERRED DRIVER</Text>
                                <Text style={s.prioritySubtitle}>{preferredDriver?.name} is nearby</Text>
                            </View>
                        </View>
                    </Reanimated.View>
                )}

                {/* Status Card - Glassmorphism */}
                <View style={s.statusCard}>
                    {isInQueue ? (
                        <>
                            <Text style={s.queueTitle}>
                                You're in the queue ⏳
                            </Text>
                            <Text style={s.statusSubtitle}>
                                No drivers are available near you right now. We'll notify you the moment one becomes free — no need to cancel or restart.
                            </Text>
                        </>
                    ) : (
                        <>
                            <Text style={s.statusTitle}>
                                {isPriorityContact ? 'Priority Match' : 'Finding your G-Taxi'}{dots}
                            </Text>
                            <Text style={s.statusSubtitle}>
                                {isPriorityContact 
                                    ? `Securing ${preferredDriver?.name} for your trip...` 
                                    : 'Contacting drivers nearby...'}
                            </Text>
                        </>
                    )}
                </View>

                {/* Cancel Button - Ghost Style */}
                <Reanimated.View style={[s.cancelWrap, { opacity: cancelOpacity }]}>
                    <TouchableOpacity 
                        style={s.cancelBtn} 
                        onPress={() => handleCancel()}
                        disabled={isCanceling}
                    >
                        <Text style={s.cancelText}>Cancel Request</Text>
                    </TouchableOpacity>
                </Reanimated.View>
            </View>

            {/* FIX F6: Rejection Toast */}
            {showRejectionToast && (
                <View style={s.rejectionToast}>
                    <Ionicons name="people-outline" size={20} color="#0D0B1E" />
                    <Text style={s.rejectionToastText}>
                        Drivers are busy. Expanding search{dots}
                    </Text>
                </View>
            )}

            {/* AI NEGOTIATION OVERLAY */}
            {showNegotiation && (
                <Reanimated.View entering={FadeIn} style={[StyleSheet.absoluteFillObject, { zIndex: 1000 }]}>
                    <BlurView intensity={90} tint="dark" style={s.lockBlur}>
                        <View style={s.negotiationCard}>
                            <View style={s.aiAvatar}>
                                <LinearGradient 
                                    colors={[COLORS.purple, COLORS.cyan]} 
                                    style={StyleSheet.absoluteFillObject} 
                                />
                                <Ionicons name="star" size={24} color="#FFF" />
                            </View>
                            
                            <Text style={s.negotiationTitle}>CONCIERGE UPDATE</Text>
                            
                            <Text style={s.negotiationText}>
                                Your favored driver, <Text style={s.negotiationHighlight}>{preferredDriver?.name}</Text>, is finishing a trip 8 mins away.
                                {"\n\n"}Would you like to wait for them, or find the nearest driver (2 mins)?
                            </Text>

                            <View style={{ width: '100%', gap: 12, marginTop: 32 }}>
                                <TouchableOpacity 
                                    style={s.waitBtn} 
                                    onPress={() => {
                                        setShowNegotiation(false);
                                        setIsPriorityContact(true);
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    }}
                                >
                                    <Text style={s.waitBtnText}>Wait for {preferredDriver?.name}</Text>
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
                                    <Text style={s.skipBtnText}>Find Nearest Driver</Text>
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
    const ring1Style = useAnimatedStyle(() => ({
        width: animation.value,
        height: animation.value,
        borderRadius: animation.value / 2,
        opacity: opacity.value,
        borderWidth: 2,
        borderColor: COLORS.cyan,
    }));
    
    const ring2Style = useAnimatedStyle(() => ({
        width: animation.value * 0.7,
        height: animation.value * 0.7,
        borderRadius: (animation.value * 0.7) / 2,
        opacity: opacity.value * 0.7,
        borderWidth: 1.5,
        borderColor: COLORS.purple,
    }));
    
    const ring3Style = useAnimatedStyle(() => ({
        width: animation.value * 0.4,
        height: animation.value * 0.4,
        borderRadius: (animation.value * 0.4) / 2,
        opacity: opacity.value * 0.4,
        borderWidth: 1,
        borderColor: COLORS.cyan,
    }));

    return (
        <View style={s.radarContainer}>
            <Reanimated.View style={[s.radarRing, ring1Style]} />
            <Reanimated.View style={[s.radarRing, ring2Style]} />
            <Reanimated.View style={[s.radarRing, ring3Style]} />
            <View style={s.radarCore}>
                <LinearGradient 
                    colors={[COLORS.purple, COLORS.purpleDark]} 
                    style={StyleSheet.absoluteFillObject} 
                />
                <Image 
                    source={require('../../assets/logo.png')} 
                    style={s.radarLogo}
                    resizeMode="contain"
                />
                {/* Glow effect */}
                <View style={s.radarGlow} />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.bgPrimary },
    
    // Radar Animation
    radarContainer: { 
        ...StyleSheet.absoluteFillObject, 
        alignItems: 'center', 
        justifyContent: 'center' 
    },
    radarRing: { 
        position: 'absolute',
        borderStyle: 'dashed',
    },
    radarCore: { 
        width: 80, 
        height: 80, 
        borderRadius: 40, 
        backgroundColor: COLORS.purple, 
        alignItems: 'center', 
        justifyContent: 'center', 
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 30, 
        shadowOpacity: 0.8,
        overflow: 'hidden',
        elevation: 10,
    },
    radarLogo: {
        width: 50,
        height: 50,
        zIndex: 10,
    },
    radarGlow: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: COLORS.purple,
        opacity: 0.3,
    },

    // Content Positioning
    content: { 
        position: 'absolute', 
        left: 24, 
        right: 24, 
        alignItems: 'center' 
    },
    
    // Priority Card
    priorityCard: { 
        width: '100%', 
        padding: 18, 
        borderRadius: 20, 
        marginBottom: 16, 
        overflow: 'hidden', 
        borderWidth: 1, 
        borderColor: 'rgba(245, 158, 11, 0.3)',
        backgroundColor: 'rgba(245, 158, 11, 0.05)',
    },
    priorityTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: COLORS.warning,
        letterSpacing: 0.5,
    },
    prioritySubtitle: {
        fontSize: 13,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    
    // Status Card - Glassmorphism
    statusCard: { 
        backgroundColor: COLORS.glassBg, 
        borderRadius: 28, 
        padding: 28, 
        width: '100%', 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder,
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 6,
    },
    statusTitle: {
        fontSize: 26,
        fontWeight: '800',
        color: COLORS.white,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    queueTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: COLORS.warning,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    statusSubtitle: {
        fontSize: 15,
        fontWeight: '500',
        color: COLORS.textSecondary,
        textAlign: 'center',
        marginTop: 12,
        lineHeight: 22,
    },

    // Cancel Button
    cancelWrap: { 
        marginTop: 32, 
        width: '100%' 
    },
    cancelBtn: { 
        height: 56, 
        borderRadius: 18, 
        backgroundColor: 'rgba(255,77,109,0.1)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: 'rgba(255,77,109,0.25)',
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.error,
        letterSpacing: 0.5,
    },

    // Negotiation Overlay
    lockBlur: { 
        ...StyleSheet.absoluteFillObject, 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: 20,
        backgroundColor: 'rgba(13,11,30,0.95)',
    },
    negotiationCard: { 
        width: width * 0.85, 
        padding: 28, 
        borderRadius: 32, 
        backgroundColor: COLORS.glassBg, 
        borderWidth: 1, 
        borderColor: COLORS.glassBorder, 
        alignItems: 'center',
        shadowColor: COLORS.purple,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    aiAvatar: { 
        width: 56, 
        height: 56, 
        borderRadius: 28, 
        overflow: 'hidden', 
        alignItems: 'center', 
        justifyContent: 'center', 
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 15, 
        shadowOpacity: 0.5,
    },
    negotiationTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.white,
        marginTop: 20,
        textAlign: 'center',
        letterSpacing: 1,
    },
    negotiationText: {
        fontSize: 15,
        fontWeight: '400',
        color: COLORS.textSecondary,
        marginTop: 12,
        textAlign: 'center',
        lineHeight: 22,
    },
    negotiationHighlight: {
        fontWeight: '700',
        color: COLORS.cyan,
    },
    
    // Buttons
    waitBtn: { 
        width: '100%', 
        height: 56, 
        borderRadius: 16, 
        backgroundColor: COLORS.cyan, 
        alignItems: 'center', 
        justifyContent: 'center',
        shadowColor: COLORS.cyan,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    waitBtnText: {
        fontSize: 16,
        fontWeight: '800',
        color: COLORS.bgPrimary,
    },
    skipBtn: { 
        width: '100%', 
        height: 56, 
        borderRadius: 16, 
        backgroundColor: 'rgba(255,255,255,0.05)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        borderWidth: 1, 
        borderColor: 'rgba(255,255,255,0.1)',
    },
    skipBtnText: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.white,
    },

    // FIX F6: Rejection Toast
    rejectionToast: {
        position: 'absolute',
        bottom: 200,
        left: 20, right: 20,
        backgroundColor: 'rgba(245, 158, 11, 0.95)',
        paddingVertical: 16, paddingHorizontal: 20,
        borderRadius: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        zIndex: 100,
    },
    rejectionToastText: {
        color: '#0D0B1E',
        fontSize: 14, fontWeight: '700', flex: 1,
    },
});
