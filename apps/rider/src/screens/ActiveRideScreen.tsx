import React, { useEffect, useState, useRef } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Alert,
    Linking, Dimensions, Platform, Image as RNImage
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, Easing
} from 'react-native-reanimated';
// Skia removed for Expo Go compatibility
import { Ionicons } from '@expo/vector-icons';
import { ENV } from '../../../../shared/env';
import { supabase } from '../../../../shared/supabase';
import { useRideSubscription } from '../services/realtime';
import { fetchDriverDetails } from '../services/realtime';
import { Txt } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');
const CAR_ASSET = require('../../assets/images/car_gtaxi_standard_v7.png');

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
    green: '#10B981',
    gold: '#F59E0B',
};

export function ActiveRideScreen({ route, navigation }: any) {
    const { rideId, paymentMethod } = route.params;
    const insets = useSafeAreaInsets();

    const [ride, setRide] = useState<any>(null);
    const [driver, setDriver] = useState<any>(null);
    const [driverLocation, setDriverLocation] = useState<any>(null);
    const [isSosLoading, setIsSosLoading] = useState(false);

    const { rideUpdate: updatedRide } = useRideSubscription(rideId);

    // Reanimated Values
    const sosPulse = useSharedValue(1);
    const statusOpacity = useSharedValue(0);

    useEffect(() => {
        fetchInitialData();
        statusOpacity.value = withTiming(1, { duration: 800 });
        sosPulse.value = withRepeat(
            withTiming(1.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            -1, true
        );
    }, []);

    useEffect(() => {
        if (updatedRide) {
            setRide((prev: any) => ({ ...prev, ...updatedRide }));
            if (updatedRide.status === 'completed' || updatedRide.status === 'closed') {
                navigation.replace('Rating', {
                    driver,
                    fare: { total_fare_cents: updatedRide.total_fare_cents || ride?.total_fare_cents },
                    rideId,
                    paymentMethod: paymentMethod || updatedRide.payment_method
                });
            }
        }
    }, [updatedRide]);

    const fetchInitialData = async () => {
        const { data } = await supabase
            .from('rides')
            .select(`
                *,
                driver:driver_id(
                    id, name, vehicle_model, plate_number, vehicle_type, rating, lat, lng
                )
            `)
            .eq('id', rideId)
            .single();

        if (data) {
            setRide(data);
            setDriver(data.driver);
            setDriverLocation({ latitude: data.driver?.lat, longitude: data.driver?.lng });

            // Subscribe to driver location (with cleanup)
            const channel = supabase.channel(`driver_loc_${data.driver?.id}`)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${data.driver?.id}` }, (payload) => {
                    setDriverLocation({ latitude: payload.new.lat, longitude: payload.new.lng });
                })
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        }
    };

    const calculateETA = () => {
        if (!ride || !driverLocation) return null;

        const targetLat = ride.status === 'in_progress' ? ride.dropoff_lat : ride.pickup_lat;
        const targetLng = ride.status === 'in_progress' ? ride.dropoff_lng : ride.pickup_lng;

        if (!targetLat || !targetLng) return null;

        // Haversine distance in meters
        const R_EARTH = 6371e3;
        const φ1 = (driverLocation.latitude * Math.PI) / 180;
        const φ2 = (targetLat * Math.PI) / 180;
        const Δφ = ((targetLat - driverLocation.latitude) * Math.PI) / 180;
        const Δλ = ((targetLng - driverLocation.longitude) * Math.PI) / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R_EARTH * c;

        // Assume avg speed of 40km/h (666m/min) in T&T traffic
        const minutes = Math.ceil(distance / 666);
        return minutes;
    };

    const handleSOS = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Alert.alert("SOS EMERGENCY", "Trigger emergency assistance?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "TRIGGER", style: "destructive", onPress: async () => {
                    setIsSosLoading(true);
                    await supabase.functions.invoke('trigger_emergency', { body: { ride_id: rideId } });
                    Alert.alert("Success", "Security notified.");
                    setIsSosLoading(false);
                }
            }
        ]);
    };

    const getStatusMessage = () => {
        if (!ride) return "Preparing...";
        const eta = calculateETA();

        if (ride.status === 'assigned') {
            return eta !== null ? `Arriving in ${eta} min` : "Driver is on the way";
        }
        if (ride.status === 'arrived') return "Driver has arrived";
        if (ride.status === 'in_progress') {
            return eta !== null ? `${eta} min to destination` : "Heading to destination";
        }
        return "Active Ride";
    };

    const statusStyle = useAnimatedStyle(() => ({ opacity: statusOpacity.value }));
    const sosAnim = useAnimatedStyle(() => ({ transform: [{ scale: sosPulse.value }] }));

    const step = ride?.status === 'assigned' || ride?.status === 'arrived' ? 1 : 2;

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* Map: Mapbox dark-v11 (full screen) */}
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: ride?.pickup_lat || 10.66,
                    longitude: ride?.pickup_lng || -61.51,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                userInterfaceStyle="dark"
            >
                {ENV.MAPBOX_PUBLIC_TOKEN && (
                    <UrlTile
                        urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
                        shouldReplaceMapContent={true}
                    />
                )}

                {/* Markers: Rider (circle), Driver (car icon), Destination (square) */}
                {driverLocation && (
                    <Marker coordinate={driverLocation} anchor={{ x: 0.5, y: 0.5 }}>
                        <RNImage source={CAR_ASSET} style={s.carMarker} resizeMode="contain" />
                    </Marker>
                )}
                <Marker coordinate={{ latitude: ride?.pickup_lat || 0, longitude: ride?.pickup_lng || 0 }}>
                    <View style={s.riderMarker} />
                </Marker>
                <Marker coordinate={{ latitude: ride?.dropoff_lat || 0, longitude: ride?.dropoff_lng || 0 }}>
                    <View style={s.destMarker} />
                </Marker>
            </MapView>

            {/* Top Overlay: Status bubble (Reanimated) */}
            <Reanimated.View style={[s.statusBubble, statusStyle, { top: insets.top + 10 }]}>
                <BlurView tint="dark" intensity={100} style={s.statusBlur}>
                    <View style={s.statusDot} />
                    <Txt variant="bodyBold" color="#FFF">{getStatusMessage()}</Txt>
                </BlurView>
            </Reanimated.View>

            {/* Bottom Card (BlurView) */}
            <View style={[s.bottomCard, { paddingBottom: insets.bottom + 20 }]}>
                <BlurView tint="dark" intensity={90} style={s.cardBlur}>
                    <View style={s.handle} />

                    <View style={s.driverRow}>
                        <View style={s.avatar}>
                            <Txt variant="headingM" color="#FFF">{driver?.name?.charAt(0)}</Txt>
                        </View>
                        <View style={{ flex: 1, marginLeft: 16 }}>
                            <Txt variant="bodyBold" color="#FFF" style={{ fontSize: 18 }}>{driver?.name || 'Partner'}</Txt>
                            <Txt variant="small" color={R.muted}>{driver?.vehicle_model} · {driver?.plate_number}</Txt>
                        </View>
                        <TouchableOpacity style={s.sosBtn} onPress={handleSOS}>
                            <Reanimated.View style={[s.sosRing, sosAnim]} />
                            <Txt variant="caption" weight="heavy" color="#FFF">SOS</Txt>
                        </TouchableOpacity>
                    </View>

                    {/* Progress: 3-step track (Pickup → On Trip → Dropoff) */}
                    <View style={s.track}>
                        <View style={[s.trackNode, step >= 1 && s.trackNodeActive]}>
                            <Ionicons name="location" size={12} color={step >= 1 ? "#FFF" : R.muted} />
                        </View>
                        <View style={[s.trackLine, step >= 2 && s.trackLineActive]} />
                        <View style={[s.trackNode, step >= 2 && s.trackNodeActive]}>
                            <Ionicons name="car" size={12} color={step >= 2 ? "#FFF" : R.muted} />
                        </View>
                        <View style={s.trackLine} />
                        <View style={s.trackNode}>
                            <Ionicons name="flag" size={12} color={R.muted} />
                        </View>
                    </View>

                    <View style={s.actions}>
                        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Chat', { rideId, driver })}>
                            <Ionicons name="chatbubble-ellipses" size={20} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.callBtn} onPress={() => driver?.phone_number && Linking.openURL(`tel:${driver.phone_number}`)}>
                            <Ionicons name="call" size={20} color="#FFF" />
                            <Txt variant="bodyBold" color="#FFF" style={{ marginLeft: 8 }}>Call</Txt>
                        </TouchableOpacity>
                    </View>
                </BlurView>
            </View>

        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    carMarker: { width: 44, height: 44 },
    riderMarker: { width: 12, height: 12, borderRadius: 6, backgroundColor: R.white, borderWidth: 3, borderColor: R.purple },
    destMarker: { width: 12, height: 12, backgroundColor: R.white, borderWidth: 3, borderColor: R.gold },

    statusBubble: { position: 'absolute', alignSelf: 'center', zIndex: 100 },
    statusBlur: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: R.green, marginRight: 10 },

    bottomCard: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20 },
    cardBlur: { borderRadius: 32, padding: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', alignSelf: 'center', marginBottom: 20 },

    driverRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: R.purple, alignItems: 'center', justifyContent: 'center' },
    sosBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: R.red, alignItems: 'center', justifyContent: 'center' },
    sosRing: { position: 'absolute', width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: R.red, opacity: 0.3 },

    track: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, paddingHorizontal: 10 },
    trackNode: { width: 24, height: 24, borderRadius: 12, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    trackNodeActive: { backgroundColor: R.purple, borderColor: R.purpleLight },
    trackLine: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 4 },
    trackLineActive: { backgroundColor: R.purple },

    actions: { flexDirection: 'row', gap: 12 },
    msgBtn: { width: 54, height: 54, borderRadius: 16, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    callBtn: { flex: 1, height: 54, borderRadius: 16, backgroundColor: R.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
});
