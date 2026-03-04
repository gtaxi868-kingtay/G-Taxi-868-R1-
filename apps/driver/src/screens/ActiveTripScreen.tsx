import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { supabase } from '../../../../shared/supabase';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { updateRideStatus } from '../services/api';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';

function decodePolyline(encoded: string) {
    if (!encoded) return [];
    let poly = [];
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

const DRIVER_SHARE = 0.81;

export function ActiveTripScreen({ route, navigation }: any) {
    const { rideId } = route.params;
    const { location } = useLocationTracking(rideId);
    const [ride, setRide] = useState<any>(null);
    const [rider, setRider] = useState<any>(null);
    const [routeCoords, setRouteCoords] = useState<any[]>([]);

    useEffect(() => {
        supabase
            .from('rides')
            .select('*, rider:rider_id(id, raw_user_meta_data)')
            .eq('id', rideId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setRide(data);
                    setRider(data.rider);
                    if (data.route_geometry) {
                        setRouteCoords(decodePolyline(data.route_geometry));
                    }
                }
            });

        const sub = supabase.channel(`ride_${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (payload) => {
                setRide(payload.new);
            })
            .subscribe();

        return () => { sub.unsubscribe(); };
    }, [rideId]);

    const handleStatusChange = async (newStatus: string) => {
        const { error } = await updateRideStatus(rideId, newStatus);
        if (!error) setRide({ ...ride, status: newStatus });
    };

    const handleComplete = async () => {
        Alert.alert(
            "Complete Trip",
            "Are you sure you want to end this trip?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Complete",
                    style: "default",
                    onPress: async () => {
                        const { error } = await updateRideStatus(rideId, 'completed');
                        if (error) {
                            Alert.alert("Error", "Could not complete trip. Try again.");
                        } else {
                            setRide({ ...ride, status: 'completed' });
                        }
                    }
                }
            ]
        );
    };

    const openNavigation = () => {
        if (!ride) return;
        const dest = ride.status === 'assigned' ? `${ride.pickup_lat},${ride.pickup_lng}` : `${ride.dropoff_lat},${ride.dropoff_lng}`;
        const url = Platform.select({
            ios: `maps://app?daddr=${dest}`,
            android: `google.navigation:q=${dest}`,
        });
        if (url) Linking.openURL(url);
    };

    const currentLat = location?.coords.latitude || ride?.pickup_lat || 0;
    const currentLng = location?.coords.longitude || ride?.pickup_lng || 0;

    if (ride?.status === 'completed' || ride?.status === 'closed') {
        const fare = ride.total_fare_cents ? ride.total_fare_cents / 100 : 0;
        const earnings = (fare * DRIVER_SHARE).toFixed(2);

        return (
            <View style={[styles.container, { justifyContent: 'center', padding: 24 }]}>
                <Card padding="xl" elevation="level3" radius="xl" style={{ alignItems: 'center', width: '100%' }}>
                    <View style={styles.successIcon}>
                        <Txt variant="headingL">✅</Txt>
                    </View>
                    <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} style={{ marginBottom: 8 }}>
                        Trip Completed
                    </Txt>
                    <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginBottom: 32 }}>
                        Great job! You made it safely.
                    </Txt>

                    <View style={styles.summaryBox}>
                        <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>YOUR EARNINGS</Txt>
                        <Txt variant="displayXL" weight="bold" color={tokens.colors.status.success} style={{ marginVertical: 8 }}>
                            ${earnings}
                        </Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.tertiary}>
                            Paid via {ride.payment_method === 'card' ? 'Card' : ride.payment_method === 'wallet' ? 'Wallet' : 'Cash'}
                        </Txt>

                        {ride.payment_method === 'cash' && (
                            <View style={styles.cashNotice}>
                                <Txt variant="bodyBold" color={tokens.colors.background.base}>Collect ${fare.toFixed(2)} Cash</Txt>
                            </View>
                        )}
                    </View>

                    <TouchableOpacity
                        style={[styles.btn, { backgroundColor: tokens.colors.primary.purple, width: '100%', marginTop: 24 }]}
                        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] })}
                    >
                        <Txt variant="bodyBold" color={tokens.colors.text.primary}>Back to Map</Txt>
                    </TouchableOpacity>
                </Card>
            </View>
        );
    }

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
                showsUserLocation={false}
            >
                <Marker coordinate={{ latitude: currentLat, longitude: currentLng }}>
                    <View style={styles.carMarker}>
                        <Txt style={{ fontSize: 24 }}>🚘</Txt>
                    </View>
                </Marker>

                {ride && (
                    <Marker coordinate={{
                        latitude: ride.status === 'assigned' ? ride.pickup_lat : ride.dropoff_lat,
                        longitude: ride.status === 'assigned' ? ride.pickup_lng : ride.dropoff_lng
                    }}>
                        <View style={styles.destMarker}>
                            <Txt style={{ fontSize: 20 }}>📍</Txt>
                        </View>
                    </Marker>
                )}

                {routeCoords.length > 0 && (
                    <Polyline coordinates={routeCoords} strokeColor={tokens.colors.primary.cyan} strokeWidth={4} lineCap="round" />
                )}
            </MapView>

            <SafeAreaView style={styles.safeArea} pointerEvents="box-none">

                <Surface intensity={60} style={styles.topNav}>
                    <View style={{ flex: 1, marginRight: 16 }}>
                        <Txt variant="caption" weight="bold" color={tokens.colors.primary.cyan} style={{ marginBottom: 4 }}>
                            {ride?.status === 'assigned' ? 'NAVIGATE TO PICKUP' : 'NAVIGATE TO DROPOFF'}
                        </Txt>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary} numberOfLines={1}>
                            {ride?.status === 'assigned' ? ride?.pickup_address : ride?.dropoff_address}
                        </Txt>
                    </View>
                    <TouchableOpacity style={styles.navBtn} onPress={openNavigation}>
                        <Txt style={{ fontSize: 20 }}>↗️</Txt>
                    </TouchableOpacity>
                </Surface>

                <Card style={styles.bottomCard} padding="lg" elevation="level3">
                    <View style={styles.riderInfo}>
                        <View style={styles.riderAvatar}>
                            <Txt variant="headingM">{rider?.raw_user_meta_data?.name?.charAt(0) || 'R'}</Txt>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary}>{rider?.raw_user_meta_data?.name || 'Rider'}</Txt>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary}>⭐ 5.0</Txt>
                                <View style={styles.dot} />
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary}>
                                    {ride?.payment_method === 'cash' ? '💵 Cash' : ride?.payment_method === 'wallet' ? '👛 Wallet' : '💳 Card'}
                                </Txt>
                            </View>
                        </View>
                        <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL(`tel:${rider?.raw_user_meta_data?.phone}`)}>
                            <Txt style={{ fontSize: 20 }}>📞</Txt>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.actionContainer}>
                        {ride?.status === 'assigned' && (
                            <TouchableOpacity style={[styles.mainActionBtn, { backgroundColor: tokens.colors.primary.cyan }]} onPress={() => handleStatusChange('arrived')}>
                                <Txt variant="bodyBold" weight="bold" color={tokens.colors.background.base}>I've Arrived</Txt>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'arrived' && (
                            <TouchableOpacity style={[styles.mainActionBtn, { backgroundColor: tokens.colors.status.success }]} onPress={() => handleStatusChange('in_progress')}>
                                <Txt variant="bodyBold" weight="bold" color={tokens.colors.background.base}>Start Trip</Txt>
                            </TouchableOpacity>
                        )}
                        {ride?.status === 'in_progress' && (
                            <TouchableOpacity style={[styles.mainActionBtn, { backgroundColor: tokens.colors.status.error }]} onPress={handleComplete}>
                                <Txt variant="bodyBold" weight="bold" color={tokens.colors.text.primary}>Complete Trip</Txt>
                            </TouchableOpacity>
                        )}
                    </View>
                </Card>

            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    safeArea: { flex: 1, justifyContent: 'space-between', padding: 20 },
    carMarker: { width: 48, height: 48, backgroundColor: tokens.colors.background.ambient, borderRadius: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: tokens.colors.primary.cyan, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, elevation: 5 },
    destMarker: { width: 40, height: 40, backgroundColor: tokens.colors.background.base, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: tokens.colors.text.secondary },
    topNav: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 24, marginTop: 10, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    bottomCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginHorizontal: -20, marginBottom: -20, paddingTop: 24 },
    riderInfo: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
    riderAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    callBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: tokens.colors.text.tertiary },
    actionContainer: { paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 20 : 0 },
    mainActionBtn: { paddingVertical: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(50, 215, 75, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    summaryBox: { width: '100%', alignItems: 'center', paddingVertical: 24, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, borderWidth: 1, borderColor: tokens.colors.border.subtle },
    cashNotice: { marginTop: 16, backgroundColor: tokens.colors.status.warning, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
    btn: { paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
