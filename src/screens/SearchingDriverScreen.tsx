import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    Animated,
    Platform,
    Alert,
} from 'react-native';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { useRideSubscription, fetchDriverDetails } from '../services/realtime';
import { cancelRide, matchDriver, getActiveRide } from '../services/api';
import { supabase } from '../services/supabase';
import { theme } from '../theme';
import { RadarScanner } from '../components/RadarScanner';

interface SearchingDriverScreenProps {
    navigation: any;
    route: {
        params: {
            destination: LocationType;
            fare: FareEstimate;
            rideId?: string;
            paymentMethod?: 'cash' | 'card';
        };
    };
}

export function SearchingDriverScreen({ navigation, route }: SearchingDriverScreenProps) {
    const { destination, fare, rideId, paymentMethod = 'cash' } = route.params;
    const [dots, setDots] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const pulseAnim = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0.4)).current;
    const floatAnim = useRef(new Animated.Value(0)).current;

    // REALTIME SUBSCRIPTION - Listen for ride status updates
    const { rideUpdate, isConnected } = useRideSubscription(rideId || null);

    // Handle realtime ride updates
    useEffect(() => {
        if (rideUpdate) {
            console.log('Ride update:', rideUpdate);

            if (rideUpdate.status === 'assigned' && rideUpdate.driver_id) {
                // Driver assigned! Fetch driver details and navigate
                handleDriverAssigned(rideUpdate.driver_id);
            } else if (rideUpdate.status === 'cancelled') {
                Alert.alert('Ride Cancelled', 'Your ride has been cancelled.');
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Home' }],
                });
            }
        }
    }, [rideUpdate]);

    const handleDriverAssigned = async (driverId: string) => {
        const driverDetails = await fetchDriverDetails(driverId);

        navigation.replace('ActiveRide', {
            destination,
            fare,
            driver: driverDetails || {
                name: 'Your Driver',
                vehicle: 'G-Taxi Vehicle',
                plate: 'Loading...',
                rating: 4.8,
            },
            rideId,
            paymentMethod,
        });
    };

    // Animations
    useEffect(() => {
        // Pulse animation
        Animated.loop(
            Animated.sequence([
                Animated.parallel([
                    Animated.timing(pulseAnim, {
                        toValue: 1.5,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseOpacity, {
                        toValue: 0,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                ]),
                Animated.parallel([
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 0,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseOpacity, {
                        toValue: 0.4,
                        duration: 0,
                        useNativeDriver: true,
                    }),
                ]),
            ])
        ).start();

        // Float animation for background
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: 1,
                    duration: 3000,
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 3000,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    // Animate dots
    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        return () => clearInterval(interval);
    }, []);

    // POLLING FALLBACK: Check status every 4s in case Realtime fails
    useEffect(() => {
        if (!rideId) return;

        const checkStatus = async () => {
            // Don't poll if we are already seeing success
            if (rideUpdate?.status === 'assigned') return;

            try {
                const response = await getActiveRide();
                if (response.success && response.data) {
                    const ride = response.data;
                    if (ride.ride_id === rideId && ride.status === 'assigned') {
                        console.log("Polling found assigned driver! (Recovering from lost packet)");

                        // We need driver_id, but getActiveRide might not have it. Fetch it.
                        const { data: rideData, error } = await supabase
                            .from('rides')
                            .select('driver_id')
                            .eq('id', rideId)
                            .single();

                        if (!error && rideData?.driver_id) {
                            handleDriverAssigned(rideData.driver_id);
                        }
                    } else if (ride.status === 'cancelled') {
                        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                    }
                }
            } catch (e) {
                console.log("Polling check failed", e);
            }
        };

        const pollInterval = setInterval(checkStatus, 4000);
        return () => clearInterval(pollInterval);
    }, [rideId, rideUpdate]);

    // Trigger matching process on mount
    useEffect(() => {
        const startMatching = async () => {
            if (!rideId) return;

            console.log('Requesting driver match for:', rideId);
            try {
                const response = await matchDriver(rideId);

                // HANDLE FAILURE (Crucial Fix)
                if (!response.success) {
                    console.error('Match driver API failed:', response.error);
                    Alert.alert(
                        'Connection Error',
                        'Could not reach the driver network. Please try again.',
                        [{ text: 'OK', onPress: () => navigation.goBack() }]
                    );
                    return;
                }

                // IMMEDIATE HANDOFF (Uber Pattern)
                if (response.data && response.data.driver) {
                    const driverData = response.data.driver;
                    console.log('Match success (Synchronous):', driverData.name);

                    navigation.replace('ActiveRide', {
                        destination,
                        fare,
                        driver: {
                            name: driverData.name,
                            vehicle: driverData.vehicle,
                            plate: driverData.plate,
                            rating: driverData.rating
                        },
                        rideId,
                        paymentMethod,
                    });
                }
            } catch (error) {
                console.error('Unexpected error requesting match:', error);
                Alert.alert('Error', 'An unexpected error occurred.');
                navigation.goBack();
            }
        };

        startMatching();
    }, [rideId]);

    const handleCancel = async () => {
        Alert.alert(
            'Cancel Ride',
            'Are you sure you want to cancel this ride?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: async () => {
                        if (rideId) {
                            setCancelling(true);
                            const response = await cancelRide(rideId);
                            setCancelling(false);

                            if (!response.success) {
                                Alert.alert('Error', response.error || 'Failed to cancel ride');
                                return;
                            }
                        }
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'Home' }],
                        });
                    }
                },
            ]
        );
    };

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 15],
    });

    return (
        <View style={styles.container}>
            {/* Background orbs */}
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.backgroundOrb,
                    styles.orbTop,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />

            <SafeAreaView style={styles.safeArea}>
                {/* Map area with pulsing car */}
                <View style={styles.mapContainer}>
                    <View style={styles.glassMap}>


                        {/* Connection status indicator */}
                        <View style={[
                            styles.connectionIndicator,
                            isConnected ? styles.connected : styles.disconnected
                        ]}>
                            <View style={styles.connectionDot} />
                            <Text style={styles.connectionText}>
                                {isConnected ? 'Live' : 'Connecting...'}
                            </Text>
                        </View>

                        {/* Radar Animation */}
                        <RadarScanner />

                        <View style={styles.carContainer}>
                            <Text style={styles.carIcon}>🚗</Text>
                        </View>
                    </View>
                </View>

                {/* Bottom glass sheet */}
                <View style={styles.bottomSheet}>
                    <View style={styles.glassHighlight} />

                    <View style={styles.searchingContainer}>
                        <View style={styles.dotsRow}>
                            <View style={[styles.dot, { opacity: dots.length >= 1 ? 1 : 0.3 }]} />
                            <View style={[styles.dot, { opacity: dots.length >= 2 ? 1 : 0.3 }]} />
                            <View style={[styles.dot, { opacity: dots.length >= 3 ? 1 : 0.3 }]} />
                        </View>
                        <Text style={styles.searchingText}>
                            Finding your driver{dots}
                        </Text>
                        <Text style={styles.searchingSubtext}>
                            This usually takes less than a minute
                        </Text>
                    </View>

                    {/* Trip summary - Glass card */}
                    <View style={styles.tripSummary}>
                        <View style={styles.summaryRow}>
                            <View style={styles.summaryIcon}>
                                <Text style={styles.summaryEmoji}>📍</Text>
                            </View>
                            <View style={styles.summaryContent}>
                                <Text style={styles.summaryLabel}>Drop-off</Text>
                                <Text style={styles.summaryValue} numberOfLines={1}>
                                    {destination.address}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.summaryRow}>
                            <View style={styles.summaryIcon}>
                                <Text style={styles.summaryEmoji}>💰</Text>
                            </View>
                            <View style={styles.summaryContent}>
                                <Text style={styles.summaryLabel}>Estimated fare</Text>
                                <Text style={styles.summaryPrice}>
                                    ${(fare.total_fare_cents / 100).toFixed(2)} TTD
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Cancel button - Glass style */}
                    <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={handleCancel}
                        disabled={cancelling}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.cancelButtonText}>
                            {cancelling ? 'Cancelling...' : 'Cancel ride'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
    },
    safeArea: {
        flex: 1,
    },
    backgroundOrb: {
        position: 'absolute',
        width: 400,
        height: 400,
        borderRadius: 200,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -100,
        left: -100,
        opacity: 0.5,
    },
    orbTop: {},
    mapContainer: {
        flex: 1,
        margin: theme.spacing.lg,
        borderRadius: theme.borderRadius.xxl,
        overflow: 'hidden',
    },
    glassMap: {
        flex: 1,
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        borderRadius: theme.borderRadius.xxl,
        justifyContent: 'center',
        alignItems: 'center',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
        } : {}),
    },
    connectionIndicator: {
        position: 'absolute',
        top: theme.spacing.lg,
        right: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.borderRadius.pill,
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    connected: {},
    disconnected: {},
    connectionDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.brand.primary,
        marginRight: theme.spacing.xs,
    },
    connectionText: {
        fontSize: theme.typography.sizes.xs,
        color: theme.colors.text.secondary,
    },
    pulseCircle: {
        position: 'absolute',
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: theme.colors.brand.primary,
    },
    carContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...theme.shadows.glow,
    },
    carIcon: {
        fontSize: 36,
    },
    bottomSheet: {
        backgroundColor: theme.colors.glass.background,
        borderTopLeftRadius: theme.borderRadius.xxl,
        borderTopRightRadius: theme.borderRadius.xxl,
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
        paddingBottom: Platform.OS === 'ios' ? 34 : theme.spacing.xxl,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
        } : {}),
    },
    glassHighlight: {
        position: 'absolute',
        top: 0,
        left: 40,
        right: 40,
        height: 1,
        backgroundColor: theme.colors.glass.highlight,
    },
    searchingContainer: {
        alignItems: 'center',
        marginBottom: theme.spacing.xxl,
    },
    dotsRow: {
        flexDirection: 'row',
        marginBottom: theme.spacing.md,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.brand.primary,
        marginHorizontal: 4,
    },
    searchingText: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.semibold,
        marginBottom: theme.spacing.xs,
    },
    searchingSubtext: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    tripSummary: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.sm,
    },
    summaryIcon: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    summaryEmoji: {
        fontSize: 18,
    },
    summaryContent: {
        flex: 1,
    },
    summaryLabel: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        marginBottom: 2,
    },
    summaryValue: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.medium,
    },
    summaryPrice: {
        color: theme.colors.brand.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.bold,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.glass.border,
        marginVertical: theme.spacing.sm,
    },
    cancelButton: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.lg,
        paddingVertical: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 107, 107, 0.3)',
    },
    cancelButtonText: {
        color: theme.colors.status.error,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.semibold,
    },
});
