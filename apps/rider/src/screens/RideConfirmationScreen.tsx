import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    ScrollView,
    Dimensions,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { estimateFare, createRide, formatCurrency, getWalletBalance } from '../services/api';
import { DEFAULT_LOCATION } from '../../../../shared/env';
import { tokens } from '../design-system/tokens';
import { Txt, Card, Btn, Surface } from '../design-system/primitives';
import { VehicleSelection, VehicleType } from '../components/VehicleSelection';
import { PaymentSelector, PaymentMethod } from '../components/PaymentSelector';

const { width } = Dimensions.get('window');

// Reusing the Dark Map Style (could actally be centralized in config or tokens)
const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: tokens.colors.background.base }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
];

interface RideConfirmationScreenProps {
    navigation: any;
    route: {
        params: {
            destination: LocationType;
            pickup?: LocationType;
        };
    };
}

type LoadingState = 'loading' | 'success' | 'error';

export function RideConfirmationScreen({ navigation, route }: RideConfirmationScreenProps) {
    const { destination, pickup } = route.params;
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapView>(null);

    const pickupLocation = pickup || {
        latitude: DEFAULT_LOCATION.latitude,
        longitude: DEFAULT_LOCATION.longitude,
        address: 'Current Location',
    };

    const [loadingState, setLoadingState] = useState<LoadingState>('loading');
    const [fare, setFare] = useState<FareEstimate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>('Standard');
    const [priceMultiplier, setPriceMultiplier] = useState(1.0);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
    const [walletBalance, setWalletBalance] = useState<number | undefined>(undefined);

    useEffect(() => {
        fetchFare();
        fetchBalance();
    }, []);

    const fetchBalance = async () => {
        const response = await getWalletBalance();
        if (response.success && response.data !== null) {
            setWalletBalance(response.data);
        }
    };

    const fetchFare = async () => {
        setLoadingState('loading');
        setError(null);
        const response = await estimateFare({
            pickup_lat: pickupLocation.latitude,
            pickup_lng: pickupLocation.longitude,
            dropoff_lat: destination.latitude,
            dropoff_lng: destination.longitude,
        });

        if (response.success && response.data) {
            setFare(response.data);
            setLoadingState('success');
            // Fit map to markers
            setTimeout(() => {
                mapRef.current?.fitToCoordinates([
                    { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
                    { latitude: destination.latitude, longitude: destination.longitude },
                ], {
                    edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
                    animated: true,
                });
            }, 500);
        } else {
            setError(response.error || 'Failed to get estimate');
            setLoadingState('error');
        }
    };

    const handleConfirmRide = async () => {
        if (!fare) return;

        // Wallet Balance Check
        if (paymentMethod === 'wallet' && walletBalance !== undefined) {
            const cost = (fare.total_fare_cents * priceMultiplier) / 100;
            if (walletBalance < cost) {
                Alert.alert('Insufficient Funds', 'Please top up your G-Coin wallet or select another payment method.');
                return;
            }
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setConfirming(true);

        const response = await createRide({
            pickup_lat: pickupLocation.latitude,
            pickup_lng: pickupLocation.longitude,
            pickup_address: pickupLocation.address || 'Current Location',
            dropoff_lat: destination.latitude,
            dropoff_lng: destination.longitude,
            dropoff_address: destination.address || 'Unknown',
            vehicle_type: selectedVehicle,
            payment_method: paymentMethod,
        });

        setConfirming(false);

        if (response.success && response.data) {
            console.log('[RideConfirmation] Response:', response.data.status, response.data.driver ? 'Driver assigned!' : 'No driver yet');

            // UBER-LIKE: If driver was assigned synchronously, go directly to ActiveRide
            if (response.data.status === 'assigned' && response.data.driver) {
                navigation.replace('ActiveRide', {
                    destination,
                    fare,
                    driver: response.data.driver,
                    rideId: response.data.ride_id,
                    paymentMethod,
                });
            } else {
                // No driver available yet - go to searching screen with polling fallback
                navigation.navigate('SearchingDriver', {
                    rideId: response.data.ride_id,
                    destination,
                    fare,
                    pickup: pickupLocation,
                    paymentMethod
                });
            }
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Error', response.error || 'Failed to create ride');
        }
    };

    return (
        <View style={styles.container}>
            {/* 1. Map Layer */}
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                customMapStyle={DARK_MAP_STYLE}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: pickupLocation.latitude,
                    longitude: pickupLocation.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
            >
                <Marker coordinate={pickupLocation}>
                    <View style={styles.uberMarkerDot} />
                </Marker>
                <Marker coordinate={destination}>
                    <View style={styles.uberMarkerSquare} />
                </Marker>
            </MapView>

            {/* Header Overlay */}
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtnUber}>
                    <Txt style={{ fontSize: 24, color: '#FFF' }}>←</Txt>
                </TouchableOpacity>
            </View>

            {/* Bottom Sheet (Uber Style) */}
            <View style={styles.bottomSheetUber}>
                <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
                    <View style={styles.sheetHandleUber} />

                    {loadingState === 'loading' && (
                        <View style={{ padding: 40, alignItems: 'center' }}>
                            <ActivityIndicator color="#276EF1" />
                            <Txt style={{ marginTop: 16 }}>Finding the best ride...</Txt>
                        </View>
                    )}

                    {loadingState === 'error' && (
                        <View style={{ padding: 20, alignItems: 'center' }}>
                            <Txt color={tokens.colors.status.error}>{error}</Txt>
                            <Btn title="Retry" onPress={fetchFare} variant="primary" style={{ marginTop: 10 }} />
                        </View>
                    )}

                    {fare && (
                        <>
                            {/* Route Stats */}
                            <View style={styles.statsRow}>
                                <View style={styles.statGroup}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>TIME</Txt>
                                    <Txt variant="headingL" weight="heavy">{fare.duration_min} min</Txt>
                                </View>
                                <View style={styles.statDivider} />
                                <View style={styles.statGroup}>
                                    <Txt variant="caption" weight="bold" color={tokens.colors.text.secondary}>DISTANCE</Txt>
                                    <Txt variant="headingL" weight="heavy">{fare.distance_km} km</Txt>
                                </View>
                            </View>

                            <View style={styles.dividerUber} />

                            {/* Vehicle Selection */}
                            <VehicleSelection
                                basePrice={fare.total_fare_cents}
                                selectedType={selectedVehicle}
                                onSelect={(t, m) => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setSelectedVehicle(t);
                                    setPriceMultiplier(m);
                                }}
                            />

                            {/* Payment Method Selector */}
                            <PaymentSelector
                                selected={paymentMethod}
                                onSelect={setPaymentMethod}
                                walletBalance={walletBalance}
                                requiredAmount={fare ? (fare.total_fare_cents * priceMultiplier) / 100 : undefined}
                            />

                            <View style={{ height: 24 }} />

                            <Btn
                                title={confirming ? "Requesting..." : `Confirm ${selectedVehicle}`}
                                onPress={handleConfirmRide}
                                disabled={confirming}
                                fullWidth
                                variant="primary"
                            />
                        </>
                    )}
                </ScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 20,
        zIndex: 10,
    },
    backBtnUber: {
        marginTop: 10,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 22,
    },
    uberMarkerDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#FFF',
        borderWidth: 2,
        borderColor: '#000',
    },
    uberMarkerSquare: {
        width: 12,
        height: 12,
        backgroundColor: '#000',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    bottomSheetUber: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#05050A',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    sheetHandleUber: {
        width: 40,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 20,
    },
    statsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        marginBottom: 20,
    },
    statGroup: {
        flex: 1,
        alignItems: 'center',
    },
    statDivider: {
        width: 1,
        height: 30,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    dividerUber: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginBottom: 20,
    },
});
