import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    ActivityIndicator,
    Platform,
    Alert,
    Animated,
    Dimensions,
} from 'react-native';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { estimateFare, createRide, formatCurrency } from '../services/api';
import { DEFAULT_LOCATION } from '../config/env';
import { theme } from '../theme';
import { RainBackground } from '../components/RainBackground';
import { GlassView } from '../components/GlassView';
import { GlassButton } from '../components/GlassButton';

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

    const pickupLocation = pickup || {
        latitude: DEFAULT_LOCATION.latitude,
        longitude: DEFAULT_LOCATION.longitude,
    };

    const [loadingState, setLoadingState] = useState<LoadingState>('loading');
    const [fare, setFare] = useState<FareEstimate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    // Glow Animation
    const glowAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        fetchFare();

        // Glow animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(glowAnim, {
                    toValue: 1,
                    duration: 2000,
                    useNativeDriver: true,
                }),
                Animated.timing(glowAnim, {
                    toValue: 0,
                    duration: 2000,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

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
        } else {
            setError(response.error || 'Failed to get fare estimate');
            setLoadingState('error');
        }
    };

    const handleConfirmRide = async () => {
        if (!fare) return;

        setConfirming(true);
        setError(null);

        const response = await createRide({
            pickup_lat: pickupLocation.latitude,
            pickup_lng: pickupLocation.longitude,
            pickup_address: pickupLocation.address || 'Current Location',
            dropoff_lat: destination.latitude,
            dropoff_lng: destination.longitude,
            dropoff_address: destination.address,
        });

        if (response.success && response.data) {
            navigation.navigate('SearchingDriver', {
                destination,
                fare,
                pickup: pickupLocation,
                rideId: response.data.ride_id,
            });
        } else {
            Alert.alert('Error', response.error || 'Failed to create ride');
        }

        setConfirming(false);
    };

    const renderContent = () => {
        if (loadingState === 'loading') {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.brand.primary} />
                    <Text style={styles.loadingText}>Calculating fare...</Text>
                </View>
            );
        }

        if (loadingState === 'error') {
            return (
                <GlassView style={styles.errorGlass}>
                    <Text style={styles.errorIcon}>⚠️</Text>
                    <Text style={styles.errorText}>{error}</Text>
                    <GlassButton
                        title="RETRY"
                        onPress={fetchFare}
                        variant="glass"
                        style={styles.retryButton}
                        textStyle={styles.buttonTextSmall}
                    />
                </GlassView>
            );
        }

        if (!fare) return null;

        return (
            <>
                {/* Glass Route Card */}
                <GlassView style={styles.glassCard} intensity="medium">
                    <View style={styles.routePoint}>
                        <View style={styles.routeDotStart} />
                        <View style={styles.routeTextContainer}>
                            <Text style={styles.routeLabel}>PICKUP</Text>
                            <Text style={styles.routeAddress} numberOfLines={1}>Current location</Text>
                        </View>
                    </View>
                    <View style={styles.routeConnector}>
                        <View style={styles.routeLine} />
                    </View>
                    <View style={styles.routePoint}>
                        <View style={styles.routeDotEnd} />
                        <View style={styles.routeTextContainer}>
                            <Text style={styles.routeLabel}>DROP-OFF</Text>
                            <Text style={styles.routeAddress} numberOfLines={1}>{destination.address}</Text>
                        </View>
                    </View>
                </GlassView>

                {/* Glass Stats Row */}
                <GlassView style={styles.glassStatsRow} intensity="medium">
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{fare.distance_km}</Text>
                        <Text style={styles.statUnit}>KM</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{fare.duration_min}</Text>
                        <Text style={styles.statUnit}>MIN</Text>
                    </View>
                </GlassView>

                {/* Vehicle Option with Price */}
                <GlassView style={styles.glassVehicleCard} intensity="light">
                    <View style={styles.vehicleIconContainer}>
                        <Text style={styles.vehicleIcon}>🚗</Text>
                    </View>
                    <View style={styles.vehicleInfo}>
                        <Text style={styles.vehicleName}>G-Taxi Standard</Text>
                        <Text style={styles.vehicleTime}>Arrives in ~{fare.duration_min} min</Text>
                    </View>
                    <View style={styles.priceContainer}>
                        <Text style={styles.priceValue}>{formatCurrency(fare.total_fare_cents)}</Text>
                        <Text style={styles.priceCurrency}>TTD</Text>
                    </View>
                </GlassView>

                {/* Confirm button */}
                <GlassButton
                    title="CONFIRM RIDE"
                    onPress={handleConfirmRide}
                    loading={confirming}
                    variant="primary"
                    style={styles.primaryButton}
                />
            </>
        );
    };

    return (
        <View style={styles.container}>
            <RainBackground />

            <SafeAreaView style={styles.safeArea}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.glassButtonIcon}
                        onPress={() => navigation.goBack()}
                    >
                        <GlassView style={styles.glassButtonIconInner} intensity="medium">
                            <Text style={styles.backText}>←</Text>
                        </GlassView>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>CONFIRM RIDE</Text>
                    <View style={styles.placeholder} />
                </View>

                {/* Map placeholder - Glass Style */}
                <View style={styles.mapContainer}>
                    <GlassView style={styles.glassMap} intensity="medium">
                        <View style={styles.routeVisualization}>
                            <View style={styles.mapDotStart} />
                            <View style={styles.mapLine} />
                            <View style={styles.mapDotEnd} />
                        </View>
                    </GlassView>
                </View>

                {/* Ride details sheet - Glass Panel */}
                <GlassView style={styles.glassBottomSheet} intensity="heavy">
                    {renderContent()}
                </GlassView>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
    },
    glassButtonIcon: {
        width: 44,
        height: 44,
    },
    glassButtonIconInner: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: theme.borderRadius.md,
    },
    backText: {
        color: theme.colors.text.primary,
        fontSize: 22,
    },
    headerTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.bold,
        letterSpacing: 2,
    },
    placeholder: {
        width: 44,
    },
    mapContainer: {
        flex: 1,
        margin: theme.spacing.lg,
        borderRadius: theme.borderRadius.xxl,
        overflow: 'hidden',
    },
    glassMap: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: theme.borderRadius.xxl,
    },
    routeVisualization: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    mapDotStart: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.text.secondary,
    },
    mapLine: {
        width: 120,
        height: 3,
        backgroundColor: theme.colors.brand.primary,
        marginHorizontal: theme.spacing.md,
    },
    mapDotEnd: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    glassBottomSheet: {
        borderTopLeftRadius: theme.borderRadius.xxl,
        borderTopRightRadius: theme.borderRadius.xxl,
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
        paddingBottom: Platform.OS === 'ios' ? 34 : theme.spacing.xxl,
        borderBottomWidth: 0,
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: theme.spacing.xxxl,
    },
    loadingText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
        marginTop: theme.spacing.lg,
    },
    errorGlass: {
        alignItems: 'center',
        paddingVertical: theme.spacing.xxl,
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: 'rgba(255, 107, 107, 0.3)',
    },
    errorIcon: {
        fontSize: 48,
        marginBottom: theme.spacing.md,
    },
    errorText: {
        color: theme.colors.status.error,
        fontSize: theme.typography.sizes.md,
        textAlign: 'center',
        marginBottom: theme.spacing.lg,
    },
    retryButton: {
        marginTop: theme.spacing.lg,
        paddingHorizontal: theme.spacing.xxl,
    },
    buttonTextSmall: {
        fontSize: theme.typography.sizes.sm,
        letterSpacing: 1,
    },
    glassCard: {
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
    },
    routePoint: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    routeDotStart: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.text.secondary,
        marginRight: theme.spacing.md,
    },
    routeDotEnd: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.brand.primary,
        marginRight: theme.spacing.md,
    },
    routeTextContainer: {
        flex: 1,
    },
    routeLabel: {
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.tertiary,
        letterSpacing: 1,
    },
    routeAddress: {
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.primary,
        marginTop: 2,
    },
    routeConnector: {
        paddingLeft: 5,
        paddingVertical: theme.spacing.sm,
    },
    routeLine: {
        width: 2,
        height: 20,
        backgroundColor: theme.colors.glass.border,
    },
    glassStatsRow: {
        flexDirection: 'row',
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
    },
    stat: {
        flex: 1,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    statValue: {
        color: theme.colors.brand.primary,
        fontSize: theme.typography.sizes.xxxl,
        fontWeight: theme.typography.weights.bold,
    },
    statUnit: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.sm,
        fontWeight: theme.typography.weights.bold,
        marginLeft: theme.spacing.xs,
        letterSpacing: 1,
    },
    statDivider: {
        width: 1,
        backgroundColor: theme.colors.glass.border,
    },
    glassVehicleCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary, // Active selection border
        ...theme.shadows.glow,
    },
    vehicleIconContainer: {
        width: 52,
        height: 52,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.glass.background,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    vehicleIcon: {
        fontSize: 28,
    },
    vehicleInfo: {
        flex: 1,
    },
    vehicleName: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.bold,
        marginBottom: 2,
    },
    vehicleTime: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
    },
    priceContainer: {
        alignItems: 'flex-end',
    },
    priceValue: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xxl,
        fontWeight: theme.typography.weights.bold,
    },
    priceCurrency: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        letterSpacing: 1,
    },
    primaryButton: {
        marginTop: theme.spacing.sm,
    },
});
