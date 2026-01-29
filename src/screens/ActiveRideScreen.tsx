import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    Platform,
    Animated,
    Alert,
} from 'react-native';
import { Location as LocationType, FareEstimate } from '../types/ride';
import { useRideSubscription, useDriverLocationSubscription } from '../services/realtime';
import { supabase } from '../services/supabase';
import { theme } from '../theme';
import { RainBackground } from '../components/RainBackground';
import { GlassView } from '../components/GlassView';
import { GlassButton } from '../components/GlassButton';
import { RideProgressBar } from '../components/RideProgressBar';

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
            paymentMethod?: 'cash' | 'card';
        };
    };
}

type RidePhase = 'arriving' | 'arrived' | 'in_progress';

export function ActiveRideScreen({ navigation, route }: ActiveRideScreenProps) {
    const { destination, fare, driver, rideId, paymentMethod = 'cash' } = route.params;
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
                case 'arrived':
                    setPhase('arrived');
                    break;
                case 'in_progress':
                    setPhase('in_progress');
                    break;
                case 'completed':
                    navigation.replace('Rating', { driver, fare });
                    break;
                case 'cancelled':
                    navigation.reset({
                        index: 0,
                        routes: [{ name: 'Home' }],
                    });
                    break;
            }
        }
    }, [rideUpdate]);

    // AUTOMATIC BOT SIMULATION: Progress ride through states
    // Since we don't have a Driver App yet, auto-trigger ride progression
    useEffect(() => {
        if (!rideId) {
            // No rideId = pure frontend demo (legacy fallback)
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
        } else {
            // Real rideId = trigger backend simulation via RPC
            const runBotSimulation = async () => {
                try {
                    // Step 1: Wait 5 seconds, then "arrive"
                    await new Promise(r => setTimeout(r, 5000));
                    console.log('🤖 Bot: Arriving at pickup...');
                    await supabase.rpc('simulate_ride_update', {
                        p_ride_id: rideId,
                        p_status: 'arrived',
                        p_lat: destination.latitude - 0.001,
                        p_lng: destination.longitude - 0.001
                    });

                    // Step 2: Wait 5 seconds, then start ride
                    await new Promise(r => setTimeout(r, 5000));
                    console.log('🤖 Bot: Starting ride...');
                    await supabase.rpc('simulate_ride_update', {
                        p_ride_id: rideId,
                        p_status: 'in_progress'
                    });

                    // Step 3: Wait 10 seconds, then complete
                    await new Promise(r => setTimeout(r, 10000));
                    console.log('🤖 Bot: Completing ride...');
                    await supabase.rpc('simulate_ride_update', {
                        p_ride_id: rideId,
                        p_status: 'completed'
                    });
                } catch (e) {
                    console.error('Bot simulation error:', e);
                }
            };

            runBotSimulation();

            // ETA countdown
            const etaInterval = setInterval(() => {
                setEta(prev => Math.max(0, prev - 1));
            }, 1000);

            return () => clearInterval(etaInterval);
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

    // SIMULATION CONTROLS (Dev Only)
    const handleSimulation = async (status: string) => {
        if (!rideId) return;
        try {
            const { error } = await supabase.rpc('simulate_ride_update', {
                p_ride_id: rideId,
                p_status: status,
                // Optional: Teleport driver to destination if 'arrived'
                p_lat: status === 'arrived' ? destination.latitude - 0.001 : undefined,
                p_lng: status === 'arrived' ? destination.longitude - 0.001 : undefined
            });
            if (error) throw error;
        } catch (e) {
            console.error('Simulation failed:', e);
            Alert.alert('Sim Error', 'Could not update ride state');
        }
    };

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

                    {/* Payment Badge */}
                    <View style={styles.badgeContainer}>
                        <View style={styles.paymentBadge}>
                            <Text style={styles.paymentIcon}>{paymentMethod === 'cash' ? '💵' : '💳'}</Text>
                            <Text style={styles.paymentText}>{paymentMethod === 'cash' ? 'Cash' : 'Card'}</Text>
                        </View>
                    </View>

                    {/* Trip progress */}
                    <RideProgressBar phase={phase} />

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


    // ... existing code

    // New Styles for Badge
    badgeContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: theme.spacing.lg,
    },
    paymentBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.glass.backgroundLight,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    paymentIcon: {
        fontSize: 14,
        marginRight: 6,
    },
    paymentText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
        fontWeight: theme.typography.weights.medium,
    },

    bottomSheet: {
        borderTopLeftRadius: theme.borderRadius.xxl,
        borderTopRightRadius: theme.borderRadius.xxl,
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.xl, // Reduced top padding
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
