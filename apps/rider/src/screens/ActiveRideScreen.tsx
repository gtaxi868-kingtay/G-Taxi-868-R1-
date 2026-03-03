import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { supabase } from '../../../../shared/supabase';
import { cancelRide } from '../services/api';
import { useRideSubscription } from '../services/realtime';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { DEFAULT_LOCATION } from '../../../../shared/env';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';

// Helper for parsing polyline string to coordinate array
function decodePolyline(encoded: string) {
    if (!encoded) return [];
    let poly = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        poly.push({ latitude: (lat / 1e5), longitude: (lng / 1e5) });
    }
    return poly;
}

const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: tokens.colors.background.base }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: tokens.colors.text.secondary }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

export function ActiveRideScreen({ route, navigation }: any) {
    const { rideId, paymentMethod } = route.params;
    const { location: riderLocation } = useLocationTracking(rideId);
    const [ride, setRide] = useState<any>(null);
    const [driver, setDriver] = useState<any>(null);
    const [driverLocation, setDriverLocation] = useState<any>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);

    const { rideUpdate: updatedRide } = useRideSubscription(rideId);

    useEffect(() => {
        if (updatedRide) {
            setRide((prev: any) => ({ ...prev, ...updatedRide }));
            if (updatedRide.status === 'completed' || updatedRide.status === 'closed') {
                const pm = paymentMethod || updatedRide.payment_method || 'cash';
                if (pm === 'card') {
                    navigation.replace('Payment', {
                        ride_id: rideId,
                        payment_method: pm,
                        fare_cents: updatedRide.total_fare_cents || ride?.total_fare_cents
                    });
                } else {
                    // Pass driver and fare from route.params or state
                    navigation.replace('Rating', {
                        driver: route.params.driver || driver,
                        fare: route.params.fare || { total_fare_cents: updatedRide.total_fare_cents || ride?.total_fare_cents },
                        rideId,
                        paymentMethod: pm
                    });
                }
            }
        }
    }, [updatedRide]);

    useEffect(() => {
        let sub: any;
        const fetchInitialData = async () => {
            const { data } = await supabase
                .from('rides')
                .select(`
          *,
          driver:driver_id(
            id,
            raw_user_meta_data,
            car_make,
            car_model,
            car_color,
            license_plate,
            rating,
            lat,
            lng
          )
        `)
                .eq('id', rideId)
                .single();

            if (data) {
                setRide(data);
                setDriver(data.driver);
                setDriverLocation({ latitude: data.driver?.lat, longitude: data.driver?.lng });
                if (data.route_geometry) {
                    setRouteCoords(decodePolyline(data.route_geometry));
                }

                sub = supabase.channel(`driver_loc_${data.driver?.id}`)
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${data.driver?.id}` }, (payload) => {
                        setDriverLocation({ latitude: payload.new.lat, longitude: payload.new.lng });
                    })
                    .subscribe();
            }
        };
        fetchInitialData();
        return () => { if (sub) sub.unsubscribe(); };
    }, [rideId]);

    const handleCancel = () => {
        Alert.alert(
            "Cancel Ride",
            "Are you sure you want to cancel this ride? A fee may apply.",
            [
                { text: "No", style: "cancel" },
                {
                    text: "Yes, Cancel",
                    style: "destructive",
                    onPress: async () => {
                        const { error } = await cancelRide(rideId);
                        if (!error) navigation.navigate('Home');
                    }
                }
            ]
        );
    };

    const getStatusText = () => {
        switch (ride?.status) {
            case 'assigned': return 'Driver is on the way';
            case 'arrived': return 'Driver has arrived';
            case 'in_progress': return 'Heading to destination';
            default: return 'Active Ride';
        }
    };

    const currentLat = riderLocation?.coords.latitude || DEFAULT_LOCATION.latitude;
    const currentLng = riderLocation?.coords.longitude || DEFAULT_LOCATION.longitude;

    return (
        <View style={styles.container}>
            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
                initialRegion={{
                    latitude: currentLat,
                    longitude: currentLng,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
            >
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={styles.riderMarker}>
                        <View style={styles.riderMarkerCore} />
                    </View>
                </Marker>

                {driverLocation?.latitude && driverLocation?.longitude && (
                    <Marker coordinate={driverLocation}>
                        <View style={styles.carMarker}>
                            <Txt style={{ fontSize: 24 }}>🚘</Txt>
                        </View>
                    </Marker>
                )}

                {ride && (
                    <Marker coordinate={{ latitude: ride.dropoff_lat, longitude: ride.dropoff_lng }}>
                        <View style={styles.destMarker}>
                            <Txt style={{ fontSize: 20 }}>📍</Txt>
                        </View>
                    </Marker>
                )}

                {routeCoords.length > 0 && (
                    <Polyline coordinates={routeCoords} strokeColor={tokens.colors.primary.purple} strokeWidth={4} lineCap="round" />
                )}
            </MapView>

            <SafeAreaView style={styles.safeArea} pointerEvents="box-none">

                {/* Status Bubble */}
                <Surface intensity={60} style={styles.statusBubble}>
                    <Txt variant="bodyBold" weight="bold" color={tokens.colors.text.primary}>{getStatusText()}</Txt>
                    {ride?.status === 'assigned' && <Txt variant="caption" color={tokens.colors.primary.purple}>5 min away</Txt>}
                </Surface>

                {/* Bottom Drawer */}
                <Card style={styles.bottomCard} padding="lg" elevation="level3">

                    <View style={styles.driverInfoRow}>
                        <View style={styles.driverAvatar}>
                            <Txt variant="headingM">{driver?.raw_user_meta_data?.name?.charAt(0) || 'D'}</Txt>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>
                                {driver?.raw_user_meta_data?.name || 'Your Driver'}
                            </Txt>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary}>⭐ {driver?.rating ? driver.rating.toFixed(1) : '5.0'}</Txt>
                                <View style={styles.dot} />
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary}>{driver?.license_plate || 'ABC 1234'}</Txt>
                            </View>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Txt variant="bodyBold" color={tokens.colors.text.primary}>{driver?.car_make || 'Toyota'}</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>{driver?.car_model || 'Aqua'} • {driver?.car_color || 'White'}</Txt>
                        </View>
                    </View>

                    <View style={styles.actionContainer}>
                        <TouchableOpacity
                            style={[styles.btn, { flex: 1, backgroundColor: tokens.colors.primary.cyan }]}
                            onPress={() => driver?.raw_user_meta_data?.phone && Linking.openURL(`tel:${driver.raw_user_meta_data.phone}`)}
                        >
                            <Txt variant="bodyBold" color={tokens.colors.background.base}>Call Driver</Txt>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.btn, { width: 56, backgroundColor: 'rgba(255, 69, 58, 0.1)' }]}
                            onPress={handleCancel}
                        >
                            <Txt style={{ fontSize: 20 }}>✕</Txt>
                        </TouchableOpacity>
                    </View>
                </Card>

            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    safeArea: { flex: 1, justifyContent: 'space-between', padding: 20 },
    statusBubble: { alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    riderMarker: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(159, 85, 255, 0.3)', justifyContent: 'center', alignItems: 'center' },
    riderMarkerCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: tokens.colors.primary.purple, borderWidth: 2, borderColor: tokens.colors.background.base },
    carMarker: { width: 48, height: 48, backgroundColor: tokens.colors.background.ambient, borderRadius: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: tokens.colors.primary.cyan, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, elevation: 5 },
    destMarker: { width: 40, height: 40, backgroundColor: tokens.colors.background.base, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: tokens.colors.text.secondary },
    bottomCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginHorizontal: -20, marginBottom: -20, paddingTop: 24 },
    driverInfoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
    driverAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: tokens.colors.text.tertiary },
    actionContainer: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 20 : 0 },
    btn: { paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
