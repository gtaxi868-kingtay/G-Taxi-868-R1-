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

const { width, height } = Dimensions.get('window');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
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

        // Helper: navigate to ActiveRide with driver details
        const goToActiveRide = async (driverId: string, pmOverride?: string) => {
            try {
                const { data: driverData, error: driverErr } = await supabase
                    .from("drivers")
                    .select("id, name, vehicle_model, plate_number, vehicle_type, rating, lat, lng")
                    .eq("id", driverId)
                    .single();

                if (driverErr) throw driverErr;

                navigation.replace("ActiveRide", {
                    destination,
                    fare,
                    driver: {
                        name: driverData.name,
                        vehicle: driverData.vehicle_model,
                        id: driverData.id,
                        phone: '', // Will be fetched in ActiveRide or via another call
                        photo_url: undefined,
                        plate: driverData.plate_number,
                        rating: driverData.rating || 4.8,
                    },
                    rideId,
                    pickup,
                    paymentMethod: pmOverride || (route.params.paymentMethod)
                });
            } catch (e) {
                console.warn("goToActiveRide failed:", e);
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

    const cancelStyle = useAnimatedStyle(() => ({
        opacity: cancelOpacity.value,
        transform: [{ translateY: withTiming(cancelOpacity.value === 1 ? 0 : 20) }]
    }));

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

            {/* Hero Element: Reanimated radar pulse in center */}
            <View style={s.centerSection}>
                <Reanimated.View style={[{
                    width: 200, height: 200,
                    borderRadius: 100,
                    borderWidth: 2,
                    borderColor: R.purpleLight,
                    opacity: radarOpacity,
                    position: 'absolute',
                    transform: [{ scale: radarRadius.value / 40 }]
                }]} />

                <View style={s.core}>
                    <Ionicons name="car" size={32} color="#FFF" />
                </View>
            </View>

            {/* Bottom Panel: Flat glass BlurView */}
            <View style={[s.bottomPanel, { paddingBottom: insets.bottom + 40 }]}>
                <BlurView tint="dark" intensity={80} style={s.blurBox}>
                    <Txt variant="headingM" weight="heavy" color="#FFF" style={{ textAlign: 'center' }}>
                        Searching for Driver{dots}
                    </Txt>
                    <Txt variant="bodyReg" color={R.muted} style={{ textAlign: 'center', marginTop: 8 }}>
                        We're finding the nearest driver for you...
                    </Txt>

                    {/* Cancel button: Red ghost style, delayed 3s */}
                    <Reanimated.View style={[s.cancelWrap, cancelStyle]}>
                        <TouchableOpacity style={s.cancelBtn} onPress={() => handleCancel()}>
                            <Txt variant="bodyBold" color={R.red}>Cancel Request</Txt>
                        </TouchableOpacity>
                    </Reanimated.View>
                </BlurView>
            </View>

        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    centerSection: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    canvas: { width: 300, height: 300 },
    core: { width: 80, height: 80, borderRadius: 40, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center', shadowColor: R.purple, shadowRadius: 20, shadowOpacity: 0.5, elevation: 10 },

    bottomPanel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
    blurBox: { borderRadius: 32, padding: 32, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    cancelWrap: { marginTop: 24, width: '100%' },
    cancelBtn: { height: 54, borderRadius: 27, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.05)' },
});
