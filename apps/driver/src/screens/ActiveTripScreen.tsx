import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { updateRideStatus, getRide } from '../services/api';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Btn } from '../design-system/primitives';

// ── Locked commission rule ─────────────────────────────────────────────────
// Driver keeps 81% of total fare. 19% is platform commission.
const DRIVER_SHARE = 0.81;

type TripState = 'driving_to_pickup' | 'arrived' | 'in_progress';

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

function paymentLabel(method: string | null): string {
    if (method === 'card') return '💳 Card';
    if (method === 'wallet') return '👛 Wallet';
    return '💵 Cash';
}

export function ActiveTripScreen({ navigation, route }: any) {
    const { rideId } = route.params;
    const { location } = useLocationTracking();
    const [status, setStatus] = useState<TripState>('driving_to_pickup');
    const [loading, setLoading] = useState(false);
    const [rideData, setRideData] = useState<any>(null);

    useEffect(() => {
        getRide(rideId).then(({ data, error }) => {
            if (data) setRideData(data);
            if (error) Alert.alert('Error', 'Could not load ride data');
        });
    }, [rideId]);

    // ── UI-B3: Earnings summary before navigating to Dashboard ──────────────
    //
    // When the driver taps COMPLETE RIDE:
    //   1. Call updateRideStatus('completed') — same as before.
    //   2. Show an Alert with:
    //      - Net earning (81% of total_fare_cents, or the locked minimum if not available)
    //      - Payment method
    //      - Pickup → Dropoff addresses
    //   3. On OK → navigation.replace('Dashboard')
    //
    // This is a simple, non-blocking informational alert before stack replacement.
    const showEarningsSummary = (ride: any) => {
        const fareCents = ride?.total_fare_cents ?? 0;
        const earned = Math.round(fareCents * DRIVER_SHARE);
        const earnedStr = `$${(earned / 100).toFixed(2)} TTD`;
        const payment = paymentLabel(ride?.payment_method ?? null);
        const pickup = ride?.pickup_address || 'Pickup';
        const dropoff = ride?.dropoff_address || 'Dropoff';

        Alert.alert(
            '✅ Ride Completed!',
            `You earned: ${earnedStr}\nPayment: ${payment}\n\nFrom: ${pickup}\nTo: ${dropoff}`,
            [
                {
                    text: 'View Dashboard',
                    onPress: () => navigation.replace('Dashboard'),
                },
            ],
            { cancelable: false }
        );
    };

    const handleAction = async () => {
        setLoading(true);
        try {
            const driverLat = location?.coords.latitude;
            const driverLng = location?.coords.longitude;

            if (status === 'driving_to_pickup') {
                await updateRideStatus(rideId, 'arrived', driverLat, driverLng);
                setStatus('arrived');
            } else if (status === 'arrived') {
                await updateRideStatus(rideId, 'in_progress', driverLat, driverLng);
                setStatus('in_progress');
            } else if (status === 'in_progress') {
                try {
                    await updateRideStatus(rideId, 'completed', driverLat, driverLng);
                } catch (apiError: any) {
                    // Dead-Zone Offline Caching — preserve completion for background retry
                    const msg = apiError.message || '';
                    if (msg.includes('Network') || msg.includes('fetch')) {
                        await AsyncStorage.setItem(`pending_completion_${rideId}`, JSON.stringify({
                            rideId, driverLat, driverLng, timestamp: new Date().toISOString()
                        }));
                        Alert.alert('Offline Mode', 'Completion saved locally. It will upload when service returns.');
                        setLoading(false);
                        return;
                    } else {
                        throw apiError;
                    }
                }
                // UI-B3: Show earnings summary before going to Dashboard.
                // rideData may have stale total_fare_cents if the server calculated
                // the final fare on completion — use what we have as best estimate.
                showEarningsSummary(rideData);
            }
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to update status');
        } finally {
            setLoading(false);
        }
    };

    const openNavigation = () => {
        if (!targetCoordinate) return;
        const { latitude, longitude } = targetCoordinate;
        const wazeUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
        const googleUrl = `google.navigation:q=${latitude},${longitude}`;
        const appleUrl = `maps://?daddr=${latitude},${longitude}`;

        Linking.canOpenURL(wazeUrl).then(supported => {
            if (supported) {
                Linking.openURL(wazeUrl);
            } else {
                Linking.openURL(Platform.OS === 'ios' ? appleUrl : googleUrl);
            }
        }).catch(() => {
            Linking.openURL(Platform.OS === 'ios' ? appleUrl : googleUrl);
        });
    };

    const getButtonText = () => {
        if (loading) return 'Updating...';
        switch (status) {
            case 'driving_to_pickup': return 'ARRIVED AT PICKUP';
            case 'arrived': return 'START RIDE';
            case 'in_progress': return 'COMPLETE RIDE';
        }
    };

    const targetCoordinate = (() => {
        if (!rideData) return null;
        if (status === 'driving_to_pickup' || status === 'arrived') {
            return { latitude: rideData.pickup_lat, longitude: rideData.pickup_lng };
        }
        return { latitude: rideData.dropoff_lat, longitude: rideData.dropoff_lng };
    })();

    const driverCoord = location ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null;

    if (!rideData) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={tokens.colors.primary.cyan} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            <MapView
                style={StyleSheet.absoluteFillObject}
                provider={PROVIDER_DEFAULT}
                customMapStyle={DARK_MAP_STYLE}
                region={{
                    latitude: driverCoord?.latitude || rideData.pickup_lat,
                    longitude: driverCoord?.longitude || rideData.pickup_lng,
                    latitudeDelta: 0.04,
                    longitudeDelta: 0.04,
                }}
            >
                {/* Target Pin */}
                {targetCoordinate && (
                    <Marker coordinate={targetCoordinate}>
                        <View style={[styles.targetPin, { backgroundColor: status === 'in_progress' ? tokens.colors.status.error : tokens.colors.status.success }]} />
                    </Marker>
                )}

                {/* Driver Pin */}
                {driverCoord && (
                    <Marker coordinate={driverCoord}>
                        <View style={styles.driverPin}>
                            <View style={[styles.driverDot, { backgroundColor: tokens.colors.primary.cyan }]} />
                        </View>
                    </Marker>
                )}

                {/* Straight line route */}
                {driverCoord && targetCoordinate && (
                    <Polyline
                        coordinates={[driverCoord, targetCoordinate]}
                        strokeWidth={4}
                        strokeColor={tokens.colors.primary.purple}
                    />
                )}
            </MapView>

            <SafeAreaView style={styles.safeContainer} pointerEvents="box-none">

                <View style={styles.header}>
                    <Surface style={styles.headerPill} intensity={40}>
                        <Txt variant="bodyBold" color={tokens.colors.text.primary} style={{ letterSpacing: 1 }}>
                            {status.replace(/_/g, ' ').toUpperCase()}
                        </Txt>
                    </Surface>
                </View>

                <View style={styles.footer} pointerEvents="box-none">
                    <Surface style={styles.bottomCard} intensity={40}>
                        <View style={styles.tripInfo}>
                            <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary} style={{ marginBottom: 4 }}>
                                {status === 'in_progress' ? 'DROPOFF' : 'PICKUP'}
                            </Txt>
                            <Txt variant="headingM" weight="bold" color={tokens.colors.text.primary} numberOfLines={2}>
                                {status === 'in_progress' ? rideData.dropoff_address : rideData.pickup_address}
                            </Txt>
                        </View>

                        <Btn
                            title="NAVIGATE (WAZE/MAPS)"
                            onPress={openNavigation}
                            disabled={loading || !targetCoordinate}
                            fullWidth
                            variant="glass"
                            style={{ marginBottom: 12 }}
                        />

                        <Btn
                            title={getButtonText()}
                            onPress={handleAction}
                            disabled={loading}
                            fullWidth
                            variant={status === 'in_progress' ? 'glass' : 'primary'}
                            style={{
                                backgroundColor: status === 'in_progress' ? tokens.colors.status.error : tokens.colors.primary.purple
                            }}
                        />
                    </Surface>
                </View>

            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: tokens.colors.background.base },
    safeContainer: { flex: 1, justifyContent: 'space-between' },
    header: { padding: 24, alignItems: 'center' },
    headerPill: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    footer: { padding: 24 },
    bottomCard: {
        borderRadius: 24,
        padding: 24,
    },
    tripInfo: { marginBottom: 24 },
    targetPin: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: tokens.colors.text.primary },
    driverPin: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    driverDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: tokens.colors.text.primary },
});
