import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Alert,
    Dimensions, Platform
} from 'react-native';
import MapView, { PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, withDelay, Easing
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
                        paymentMethod: pmOverride || (route.params.paymentMethod),
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
                if (payload.new.status === 'assigned' && payload.new.driver_id) {
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

            if (ride?.status === "assigned" && ride?.driver_id) {
                clearInterval(pollTimer);
                sub.unsubscribe();
                await handleAssignment(ride.driver_id);
            }
        }, 3000);

        return () => {
            clearInterval(dotInterval);
            clearInterval(hapticInterval);
            clearInterval(pollTimer);
            sub.unsubscribe();
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
                    latitude: pickup.latitude,
                    longitude: pickup.longitude,
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
                <View style={s.statusCard}>
                    <Txt variant="displayXL" weight="heavy" color="#FFF" style={{ textAlign: 'center' }}>
                        Finding your Rider{dots}
                    </Txt>
                    <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 12, textAlign: 'center' }}>
                        Contacting drivers nearby...
                    </Txt>
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
    statusCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 32, padding: 32, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    cancelWrap: { marginTop: 40, width: '100%' },
    cancelBtn: { height: 64, borderRadius: 24, backgroundColor: 'rgba(255,69,58,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,69,58,0.2)' },
});
