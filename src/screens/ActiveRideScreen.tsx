import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    Platform,
    Animated,
} from 'react-native';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { useRideSubscription, useDriverLocationSubscription } from '../services/realtime';
import { theme } from '../theme';
import { RainBackground } from '../components/RainBackground';
import { GlassView } from '../components/GlassView';
import { GlassButton } from '../components/GlassButton';

interface Driver {
    name: string;
    vehicle: string;
    plate: string;
    rating: number;
}

interface ActiveRideScreenProps {
    navigation: any;
    route: {
        params: {
            destination: LocationType;
            fare: FareEstimate;
            driver: Driver;
            rideId?: string;
        };
    };
}

type RidePhase = 'arriving' | 'arrived' | 'in_progress';

export function ActiveRideScreen({ navigation, route }: ActiveRideScreenProps) {
    const { destination, fare, driver, rideId } = route.params;
    const [phase, setPhase] = useState<RidePhase>('arriving');
    const [eta, setEta] = useState(3);

    // REALTIME: Subscribe to ride updates
    const { rideUpdate } = useRideSubscription(rideId || null);

    // REALTIME: Subscribe to driver location (for future map integration)
    const driverLocation = useDriverLocationSubscription(rideUpdate?.driver_id || null);

    // Handle realtime ride status changes
    useEffect(() => {
        if (rideUpdate) {
            switch (rideUpdate.status) {
                case 'in_progress':
                    setPhase('in_progress');
                    break;
                case 'completed':
                    navigation.replace('Rating', { driver, fare });
                    break;
                case 'cancelled':
                    navigation.popToTop();
                    break;
            }
        }
    }, [rideUpdate]);

    // DEMO: Simulate ride progression if no rideId
    useEffect(() => {
        if (!rideId) {
            const timers: NodeJS.Timeout[] = [];

            timers.push(setTimeout(() => setPhase('arrived'), 3000));
            timers.push(setTimeout(() => setPhase('in_progress'), 6000));
            timers.push(setTimeout(() => {
                navigation.replace('Rating', { driver, fare });
            }, 10000));

            const etaInterval = setInterval(() => {
                setEta(prev => Math.max(0, prev - 1));
            }, 1000);

            return () => {
                timers.forEach(clearTimeout);
                clearInterval(etaInterval);
            };
        }
    }, [rideId]);

    const getPhaseInfo = () => {
        switch (phase) {
            case 'arriving':
                return {
                    title: 'Driver is on the way',
                    subtitle: `${eta} min away`,
                    icon: '🚗',
                };
            case 'arrived':
                return {
                    title: 'Driver has arrived',
                    subtitle: 'Meet at pickup point',
                    icon: '📍',
                };
            case 'in_progress':
                return {
                    title: 'On your way',
                    subtitle: destination.address,
                    icon: '🛣️',
                };
        }
    };

    const phaseInfo = getPhaseInfo();

    return (
        <View style={styles.container}>
            <RainBackground />

            <SafeAreaView style={styles.safeArea}>
                {/* Map area */}
                <View style={styles.mapContainer}>
                    <GlassView style={styles.glassMap} intensity="medium">
                        <View style={styles.phaseIconContainer}>
                            <Text style={styles.phaseIcon}>{phaseInfo.icon}</Text>
                        </View>
                        <Text style={styles.phaseTitle}>{phaseInfo.title}</Text>
                        <Text style={styles.phaseSubtitle}>{phaseInfo.subtitle}</Text>
                    </GlassView>
                </View>

                {/* Bottom glass sheet */}
                <GlassView style={styles.bottomSheet} intensity="medium">
                    {/* Driver info card */}
                    <GlassView style={styles.driverCard} intensity="light">
                        <View style={styles.driverAvatar}>
                            <Text style={styles.avatarText}>👤</Text>
                        </View>
                        <View style={styles.driverInfo}>
                            <Text style={styles.driverName}>{driver.name}</Text>
                            <View style={styles.ratingRow}>
                                <Text style={styles.ratingStar}>⭐</Text>
                                <Text style={styles.ratingText}>{driver.rating}</Text>
                            </View>
                        </View>
                        <View style={styles.vehicleInfo}>
                            <Text style={styles.vehicleName}>{driver.vehicle}</Text>
                            <View style={styles.plateContainer}>
                                <Text style={styles.vehiclePlate}>{driver.plate}</Text>
                            </View>
                        </View>
                    </GlassView>

                    {/* Trip progress */}
                    <View style={styles.tripProgress}>
                        <View style={styles.progressStep}>
                            <View style={[styles.progressDot, styles.progressDotComplete]} />
                            <Text style={styles.progressLabel}>Pickup</Text>
                        </View>
                        <View style={[
                            styles.progressLine,
                            phase !== 'arriving' && styles.progressLineComplete
                        ]} />
                        <View style={styles.progressStep}>
                            <View style={[
                                styles.progressDot,
                                phase === 'in_progress' && styles.progressDotComplete
                            ]} />
                            <Text style={styles.progressLabel}>Drop-off</Text>
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.actionButton}>
                            <GlassView style={styles.actionGlass} intensity="light">
                                <Text style={styles.actionIcon}>📞</Text>
                            </GlassView>
                            <Text style={styles.actionText}>Call</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton}>
                            <GlassView style={styles.actionGlass} intensity="light">
                                <Text style={styles.actionIcon}>💬</Text>
                            </GlassView>
                            <Text style={styles.actionText}>Message</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton}>
                            <GlassView style={[styles.actionGlass, styles.actionSafety]} intensity="light">
                                <Text style={styles.actionIcon}>🛡️</Text>
                            </GlassView>
                            <Text style={styles.actionText}>Safety</Text>
                        </TouchableOpacity>
                    </View>
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
        marginBottom: theme.spacing.xl,
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
    phaseIconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.lg,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    phaseIcon: {
        fontSize: 48,
    },
    phaseTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xxl,
        fontWeight: theme.typography.weights.bold,
        marginBottom: theme.spacing.xs,
    },
    phaseSubtitle: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    bottomSheet: {
        borderTopLeftRadius: theme.borderRadius.xxl,
        borderTopRightRadius: theme.borderRadius.xxl,
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
        paddingBottom: Platform.OS === 'ios' ? 34 : theme.spacing.xxl,
        borderBottomWidth: 0,
    },
    driverCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
    },
    driverAvatar: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
    },
    avatarText: {
        fontSize: 28,
    },
    driverInfo: {
        flex: 1,
    },
    driverName: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.semibold,
        marginBottom: 4,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    ratingStar: {
        fontSize: 14,
        marginRight: 4,
    },
    ratingText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
    },
    vehicleInfo: {
        alignItems: 'flex-end',
    },
    vehicleName: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
        marginBottom: 4,
    },
    plateContainer: {
        backgroundColor: theme.colors.brand.primary,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.borderRadius.sm,
    },
    vehiclePlate: {
        color: theme.colors.text.inverse,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.bold,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    tripProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing.xxl,
        paddingVertical: theme.spacing.md,
    },
    progressStep: {
        alignItems: 'center',
    },
    progressDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderWidth: 2,
        borderColor: theme.colors.glass.border,
        marginBottom: theme.spacing.sm,
    },
    progressDotComplete: {
        backgroundColor: theme.colors.brand.primary,
        borderColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    progressLine: {
        width: 100,
        height: 3,
        backgroundColor: theme.colors.glass.border,
        marginHorizontal: theme.spacing.sm,
        marginBottom: theme.spacing.xxl,
    },
    progressLineComplete: {
        backgroundColor: theme.colors.brand.primary,
    },
    progressLabel: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    actionButton: {
        alignItems: 'center',
    },
    actionGlass: {
        width: 60,
        height: 60,
        borderRadius: theme.borderRadius.lg,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.sm,
    },
    actionSafety: {
        borderColor: 'rgba(255, 107, 107, 0.3)',
    },
    actionIcon: {
        fontSize: 24,
    },
    actionText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.medium,
    },
});
