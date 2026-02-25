import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    StyleSheet,
    Animated,
    Alert,
    Dimensions,
    Image,
    Easing,
    Platform,
    ActivityIndicator,
    TouchableOpacity,
} from 'react-native';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { useRideSubscription, fetchDriverDetails } from '../services/realtime';
import { cancelRide, matchDriver, getActiveRide, expireOffer } from '../services/api';
import { supabase } from '../../../../shared/supabase';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Btn, Card } from '../design-system/primitives';
import { DEFAULT_LOCATION } from '../../../../shared/env';

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
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

interface SearchingDriverScreenProps {
    navigation: any;
    route: {
        params: {
            destination: LocationType;
            fare: FareEstimate;
            rideId?: string;
            paymentMethod?: 'cash' | 'card';
            pickup?: LocationType;
        };
    };
}

export function SearchingDriverScreen({ navigation, route }: SearchingDriverScreenProps) {
    const { destination, fare, rideId, paymentMethod = 'cash', pickup } = route.params;
    const insets = useSafeAreaInsets();
    const [cancelling, setCancelling] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const [searchTime, setSearchTime] = useState(0);
    const [queueStatus, setQueueStatus] = useState<boolean>(false);

    const SEARCH_TIMEOUT_SECONDS = 300; // Increased to 5 mins

    // Initial Map Region
    const initialRegion = {
        latitude: pickup?.latitude || DEFAULT_LOCATION.latitude,
        longitude: pickup?.longitude || DEFAULT_LOCATION.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
    };

    // Ride Subscription for assigned/cancelled
    const { rideUpdate, isConnected } = useRideSubscription(rideId || null);

    const performMatch = async () => {
        if (!rideId) return;
        try {
            const res = await matchDriver(rideId);
            // If the backend returns 'waiting_queue', we park the UI in Queue mode
            if (res.data?.status === 'waiting_queue') {
                setQueueStatus(true);
            } else {
                setQueueStatus(false);
            }
        } catch (err) {
            console.error('[Match] request failed:', err);
        }
    };

    // Initial Request & Safety Timer
    useEffect(() => {
        const interval = setInterval(() => {
            setSearchTime(prev => {
                if (prev >= SEARCH_TIMEOUT_SECONDS) {
                    clearInterval(interval);
                    setTimedOut(true);
                    return prev;
                }
                return prev + 1;
            });
        }, 1000);

        performMatch(); // Kick off the cascade!

        return () => clearInterval(interval);
    }, [rideId]);

    // Active Queue Polling (If no drivers are online, check every 15s)
    useEffect(() => {
        let pollInterval: NodeJS.Timeout;
        if (queueStatus && !timedOut) {
            pollInterval = setInterval(() => {
                console.log('Rider in Queue: Polling for new drivers...');
                performMatch();
            }, 15000);
        }
        return () => clearInterval(pollInterval);
    }, [queueStatus, timedOut]);

    // Offer Timeout Heartbeat & Cascade Listener
    useEffect(() => {
        if (!rideId) return;

        console.log('Rider watching ride_offers for cascade heartbeat...');
        const channel = supabase
            .channel(`rider-offers:${rideId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'ride_offers',
                    filter: `ride_id=eq.${rideId}`,
                },
                (payload) => {
                    const offer = payload.new as { id: string; status: string };

                    if (payload.eventType === 'INSERT') {
                        setQueueStatus(false); // An offer was made!
                        console.log('New offer dispatched. Starting 16s heartbeat for offer:', offer.id);
                        setTimeout(() => {
                            console.log('Heartbeat tick. Forcing expiration if untouched...', offer.id);
                            expireOffer(offer.id); // Triggers UPDATE if it was still pending
                        }, 16000);
                    } else if (payload.eventType === 'UPDATE') {
                        if (offer.status === 'declined' || offer.status === 'expired') {
                            console.log(`Offer ${offer.status}. Triggering match_driver cascade...`);
                            performMatch();
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId]);

    useEffect(() => {
        if (rideUpdate) {
            if (rideUpdate.status === 'assigned' && rideUpdate.driver_id) {
                handleDriverAssigned(rideUpdate.driver_id);
            } else if (rideUpdate.status === 'cancelled') {
                Alert.alert('Ride Cancelled', 'Your ride has been cancelled.');
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }
        }
    }, [rideUpdate]);

    const handleDriverAssigned = async (driverId: string) => {
        const driverDetails = await fetchDriverDetails(driverId);
        navigation.replace('ActiveRide', {
            destination,
            fare,
            driver: driverDetails || { name: 'Driver', vehicle: 'Taxi', plate: '...', rating: 5.0 },
            rideId,
            paymentMethod,
        });
    };

    const handleCancel = async () => {
        Alert.alert(
            'Cancel Request',
            'Are you sure?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: async () => {
                        if (rideId) {
                            setCancelling(true);
                            await cancelRide(rideId);
                            setCancelling(false);
                        }
                        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                    }
                },
            ]
        );
    };

    // --- HYBRID UI: Restoration of Sleekness ---
    const radarAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.timing(radarAnim, { toValue: 1, duration: 3000, useNativeDriver: true, easing: Easing.linear })
        ).start();
    }, []);

    const radarScale = radarAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 3] });
    const radarOpacity = radarAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.4, 0] });

    return (
        <View style={styles.container}>
            {/* Map Layer */}
            <MapView
                style={StyleSheet.absoluteFill}
                customMapStyle={DARK_MAP_STYLE}
                provider={PROVIDER_DEFAULT}
                initialRegion={initialRegion}
                showsUserLocation={true}
            />

            {/* Ambient Background Orbs (HYBRID) */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.ambientOrb, { backgroundColor: tokens.colors.primary.purple, top: '20%', left: '10%', opacity: 0.3 }]} />
                <View style={[styles.ambientOrb, { backgroundColor: tokens.colors.primary.cyan, bottom: '30%', right: '5%', opacity: 0.2 }]} />
            </View>

            {/* Premium Radar Animation (HYBRID) */}
            {!timedOut && (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
                    <Animated.View style={[styles.radarCircle, { transform: [{ scale: radarScale }], opacity: radarOpacity }]} />
                    <Animated.View style={[styles.radarCircle, { transform: [{ scale: radarScale.interpolate({ inputRange: [0.5, 3], outputRange: [0.2, 2.5] }) }], opacity: radarOpacity }]} />
                </View>
            )}

            {/* Bottom Status Card (Hybrid Glass Style) */}
            <View style={[styles.bottomCardHybrid, { paddingBottom: insets.bottom + 20 }]}>
                <Surface style={styles.glassContainer} intensity={40}>
                    {timedOut ? (
                        <>
                            <Txt variant="headingM" weight="bold" center>No drivers found</Txt>
                            <Txt variant="bodyReg" color={tokens.colors.text.secondary} center style={{ marginVertical: 12 }}>
                                We couldn't find a ride nearby.
                            </Txt>
                            <Btn title="Try Again" onPress={() => { setTimedOut(false); setSearchTime(0); }} fullWidth style={{ marginBottom: 12 }} />
                            <Btn title="Cancel" variant="glass" onPress={() => navigation.goBack()} fullWidth />
                        </>
                    ) : (
                        <>
                            <View style={styles.findingRowUber}>
                                <ActivityIndicator color={queueStatus ? tokens.colors.primary.purple : "#276EF1"} size="small" style={{ marginRight: 12 }} />
                                <Txt variant="headingM" weight="bold">
                                    {queueStatus ? "You're in the queue..." : "Finding your ride..."}
                                </Txt>
                            </View>
                            {queueStatus && (
                                <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginTop: 4, marginLeft: 32 }}>
                                    Waiting for the next available driver.
                                </Txt>
                            )}

                            <View style={styles.dividerUber} />

                            <View style={styles.tripPreviewUber}>
                                <Txt variant="caption" weight="bold" color={tokens.colors.text.tertiary}>DESTINATION</Txt>
                                <Txt variant="bodyBold" numberOfLines={1}>{(destination.address || 'Destination').split(',')[0]}</Txt>
                            </View>

                            <TouchableOpacity onPress={handleCancel} style={styles.cancelBtnUber}>
                                <Txt variant="bodyBold" color="#FF453A">Cancel Request</Txt>
                            </TouchableOpacity>
                        </>
                    )}
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
    ambientOrb: {
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: 150,
    },
    radarCircle: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 1,
        borderColor: tokens.colors.primary.purple,
    },
    bottomCardHybrid: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'transparent',
    },
    glassContainer: {
        backgroundColor: 'rgba(10, 10, 21, 0.9)',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    findingRowUber: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    dividerUber: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginBottom: 20,
    },
    tripPreviewUber: {
        marginBottom: 24,
    },
    cancelBtnUber: {
        alignItems: 'center',
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.05)',
        marginTop: 10,
    },
});
