import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    StyleSheet,
    Animated,
    Image,
    SafeAreaView,
    Platform,
    TouchableOpacity,
    Dimensions,
    Linking,
    Alert,
    Share,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRideSubscription, useDriverLocationSubscription } from '../services/realtime';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');

// --- DARK MAP STYLE (Premium) ---
const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: tokens.colors.background.base }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: tokens.colors.text.secondary }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
];

interface Driver {
    id: string;
    name: string;
    vehicle: string;
    plate: string;
    rating: number;
    phone?: string;
    photo_url?: string;
}

interface ActiveRideScreenProps {
    navigation: any;
    route: {
        params: {
            destination: any;
            fare: any;
            driver: Driver;
            rideId?: string;
            // UI-A3: Added 'wallet' to the type union.
            // All three methods must be handled in the completion handler.
            paymentMethod?: 'cash' | 'wallet' | 'card';
        };
    };
}

const CAR_ASSETS = {
    standard: require('../../assets/images/car_gtaxi_standard_v7.png'),
    suv: require('../../assets/images/car_gtaxi_suv_v9.png'),
};

export function ActiveRideScreen({ navigation, route }: ActiveRideScreenProps) {
    const { destination, fare, driver, rideId, paymentMethod = 'cash' } = route.params;
    const [eta, setEta] = useState(fare.duration_min || 5);
    const mapRef = useRef<MapView>(null);
    const { rideUpdate } = useRideSubscription(rideId || null);
    const driverLocation = useDriverLocationSubscription(driver.id);

    const carSource = driver.vehicle.toLowerCase().includes('suv') || driver.vehicle.toLowerCase().includes('xl')
        ? CAR_ASSETS.suv
        : CAR_ASSETS.standard;

    // Background animation
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (rideUpdate?.status === 'completed') {
            handleRideCompleted();
        }
    }, [rideUpdate]);

    // ── UI-A3: Payment-aware completion routing ────────────────────────────────
    //
    // card   → Navigate to PaymentScreen so the rider can confirm card charge
    //          via Stripe PaymentSheet before leaving the ride context.
    //          After payment (or goBack()), RatingScreen follows.
    //
    // wallet → Wallet deduction happened server-side automatically (via
    //          process_wallet_payment RPC called by complete_ride edge function).
    //          Go straight to Rating.
    //
    // cash   → Rider pays driver directly. No in-app transaction needed.
    //          Go straight to Rating.
    const handleRideCompleted = () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        if (paymentMethod === 'card') {
            // Navigate to PaymentScreen with all context needed to charge the card.
            // PaymentScreen will call goBack() on success, returning here briefly,
            // then RatingScreen must be navigated to next. We use navigate (not replace)
            // so the stack allows goBack() to work, then we push Rating after payment.
            navigation.navigate('Payment', {
                ride_id: rideId,
                payment_method: 'card',
                fare_cents: rideUpdate?.total_fare_cents ?? fare.total_fare_cents,
            });
        } else {
            // cash and wallet both go direct to Rating
            navigation.replace('Rating', {
                driver,
                fare: {
                    ...fare,
                    // If the server sent back an updated fare embed it
                    total_fare_cents: rideUpdate?.total_fare_cents ?? fare.total_fare_cents,
                },
                rideId,
                paymentMethod,
            });
        }
    };

    useEffect(() => {
        if (driverLocation) {
            const { lat, lng } = driverLocation;
            if (mapRef.current) {
                mapRef.current.fitToCoordinates(
                    [
                        { latitude: lat, longitude: lng },
                        { latitude: destination.latitude, longitude: destination.longitude },
                    ],
                    {
                        edgePadding: { top: 100, right: 50, bottom: height * 0.4, left: 50 },
                        animated: true,
                    }
                );
            }
        }

        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, { toValue: 1, duration: 8000, useNativeDriver: true }),
                Animated.timing(floatAnim, { toValue: 0, duration: 8000, useNativeDriver: true }),
            ])
        ).start();
    }, [driverLocation]);

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 30],
    });

    const handleCall = () => {
        const phoneNumber = driver.phone || '999';
        Linking.openURL(`tel:${phoneNumber}`).catch(() => Alert.alert('Error', 'Could not open dialer.'));
    };

    const handleMessage = () => {
        const phoneNumber = driver.phone || '';
        if (phoneNumber) Linking.openURL(`sms:${phoneNumber}`);
        else Alert.alert('Error', 'Contact unavailable.');
    };

    return (
        <View style={styles.container}>
            {/* Map Background */}
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                customMapStyle={DARK_MAP_STYLE}
                provider={PROVIDER_DEFAULT}
                initialRegion={{
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                showsUserLocation
                userInterfaceStyle="dark"
            >
                {driverLocation && (
                    <Polyline
                        coordinates={[
                            { latitude: driverLocation.lat, longitude: driverLocation.lng },
                            { latitude: destination.latitude, longitude: destination.longitude }
                        ]}
                        strokeWidth={4}
                        strokeColor="#276EF1"
                    />
                )}
                {driverLocation && (
                    <Marker coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }} anchor={{ x: 0.5, y: 0.5 }}>
                        <Image source={carSource} style={styles.carMarker} resizeMode="contain" />
                    </Marker>
                )}
                <Marker coordinate={destination}>
                    <View style={styles.destSquare} />
                </Marker>
            </MapView>



            {/* Header: ETA Badge */}
            <SafeAreaView style={styles.header}>
                <View style={styles.etaBadge}>
                    <Txt variant="headingL" weight="heavy" color="#FFF">{eta}</Txt>
                    <Txt variant="bodyBold" style={{ marginLeft: 4 }} color="#FFF">min</Txt>
                </View>
            </SafeAreaView>

            {/* Hybrid Glass Card */}
            <View style={[styles.bottomCard, { paddingBottom: 30 }]}>
                <Surface style={styles.glassSheet} intensity={40}>
                    <View style={styles.sheetHeader}>
                        <View>
                            <Txt variant="headingL" weight="bold">{driver.name}</Txt>
                            <Txt variant="bodyBold" color="#FFD700">★ {driver.rating.toFixed(1)}</Txt>
                        </View>
                        <View style={styles.photoContainer}>
                            {driver.photo_url ? (
                                <Image source={{ uri: driver.photo_url }} style={styles.photo} />
                            ) : (
                                <View style={[styles.photo, { backgroundColor: '#333' }]} />
                            )}
                        </View>
                    </View>

                    <View style={styles.carInfo}>
                        <View style={styles.plate}>
                            <Txt variant="bodyBold" style={{ color: 'black' }}>{driver.plate}</Txt>
                        </View>
                        <Txt variant="bodyReg" color="rgba(255,255,255,0.6)" style={{ marginLeft: 12 }}>{driver.vehicle}</Txt>
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.actionBtn} onPress={handleCall}>
                            <Txt variant="bodyBold" center>Call</Txt>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, styles.secondaryAction]} onPress={handleMessage}>
                            <Txt variant="bodyBold" center>Message</Txt>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, styles.shareAction]} onPress={() => {
                            Share.share({
                                message: `I'm on a G-Taxi ride with ${driver.name} (${driver.plate}). Heading to ${destination.address || 'my destination'}. Track me!`,
                            });
                        }}>
                            <Txt variant="bodyBold" center>Share Trip</Txt>
                        </TouchableOpacity>
                    </View>
                </Surface>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    carMarker: {
        width: tokens.markers.car.width,
        height: tokens.markers.car.height,
    },
    destSquare: {
        width: 12,
        height: 12,
        backgroundColor: '#000',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    header: {
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 10,
    },
    etaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#276EF1',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    bottomCard: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
    },
    glassSheet: {
        backgroundColor: 'rgba(10, 10, 21, 0.9)',
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    photoContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    photo: {
        flex: 1,
    },
    carInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    plate: {
        backgroundColor: '#FDB813',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
    },
    actionBtn: {
        flex: 1,
        backgroundColor: '#276EF1',
        height: 52,
        borderRadius: 12,
        justifyContent: 'center',
    },
    secondaryAction: {
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    shareAction: {
        backgroundColor: tokens.colors.primary.purple,
    },
});
