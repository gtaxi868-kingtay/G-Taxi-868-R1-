import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    Platform,
    Animated,
    Dimensions,
} from 'react-native';
import { FareEstimate } from '../types/ride';
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

interface RatingScreenProps {
    navigation: any;
    route: {
        params: {
            driver: Driver;
            fare: FareEstimate;
        };
    };
}

export function RatingScreen({ navigation, route }: RatingScreenProps) {
    const { driver, fare } = route.params;
    const [selectedRating, setSelectedRating] = useState(5);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = () => {
        setSubmitted(true);
        setTimeout(() => {
            navigation.popToTop();
        }, 1500);
    };

    if (submitted) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.thankYouContainer}>
                    <View style={styles.successIcon}>
                        <Text style={styles.checkmark}>✓</Text>
                    </View>
                    <Text style={styles.thankYouTitle}>Thank you!</Text>
                    <Text style={styles.thankYouText}>Your ride is complete</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <View style={styles.container}>
            <RainBackground />

            <SafeAreaView style={styles.safeArea}>
                <View style={styles.content}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Rate your ride</Text>
                        <Text style={styles.headerSubtitle}>How was your trip?</Text>
                    </View>

                    {/* Glass Driver Card */}
                    <View style={styles.driverSection}>
                        <GlassView style={styles.glassDriverCard} intensity="medium">
                            <View style={styles.driverAvatar}>
                                <Text style={styles.avatarText}>👤</Text>
                            </View>
                            <Text style={styles.driverName}>{driver.name}</Text>
                            <GlassView style={styles.vehicleTag} intensity="light">
                                <Text style={styles.vehicleInfo}>
                                    {driver.vehicle} • {driver.plate}
                                </Text>
                            </GlassView>
                        </GlassView>
                    </View>

                    {/* Stars */}
                    <View style={styles.starsSection}>
                        <View style={styles.starsContainer}>
                            {[1, 2, 3, 4, 5].map((star) => (
                                <TouchableOpacity
                                    key={star}
                                    onPress={() => setSelectedRating(star)}
                                    activeOpacity={0.7}
                                    style={styles.starButton}
                                >
                                    <Text style={[
                                        styles.star,
                                        star <= selectedRating && styles.starSelected
                                    ]}>
                                        ★
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        <View style={styles.ratingLabelContainer}>
                            <Text style={styles.ratingLabel}>
                                {selectedRating === 5 ? 'Excellent!' :
                                    selectedRating === 4 ? 'Good' :
                                        selectedRating === 3 ? 'Okay' :
                                            selectedRating === 2 ? 'Poor' : 'Very poor'}
                            </Text>
                        </View>
                    </View>

                    {/* Glass Trip Summary */}
                    <GlassView style={styles.glassTripSummary} intensity="medium">
                        <Text style={styles.summaryTitle}>Trip Summary</Text>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Trip fare</Text>
                            <Text style={styles.summaryPrice}>
                                ${(fare.total_fare_cents / 100).toFixed(2)} TTD
                            </Text>
                        </View>
                        <View style={styles.divider} />
                        <View style={styles.summaryStats}>
                            <View style={styles.stat}>
                                <Text style={styles.statValue}>{fare.distance_km} km</Text>
                                <Text style={styles.statLabel}>Distance</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.stat}>
                                <Text style={styles.statValue}>{fare.duration_min} min</Text>
                                <Text style={styles.statLabel}>Duration</Text>
                            </View>
                        </View>
                    </GlassView>

                    {/* Submit button */}
                    <GlassButton
                        title="Submit Rating"
                        onPress={handleSubmit}
                        variant="primary"
                        style={styles.submitButton}
                    />
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
    content: {
        flex: 1,
        padding: theme.spacing.xl,
    },
    header: {
        alignItems: 'center',
        paddingVertical: theme.spacing.xl,
    },
    headerTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xxxl,
        fontWeight: theme.typography.weights.bold,
        marginBottom: theme.spacing.xs,
        letterSpacing: 1,
    },
    headerSubtitle: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    driverSection: {
        alignItems: 'center',
        marginBottom: theme.spacing.xxl,
    },
    glassDriverCard: {
        alignItems: 'center',
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.xxl,
        width: '100%',
    },
    driverAvatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.md,
        borderWidth: 2,
        borderColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    avatarText: {
        fontSize: 40,
    },
    driverName: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.semibold,
        marginBottom: theme.spacing.sm,
    },
    vehicleTag: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.pill,
    },
    vehicleInfo: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
    },
    starsSection: {
        marginBottom: theme.spacing.xxl,
    },
    starsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: theme.spacing.md,
    },
    starButton: {
        paddingHorizontal: 4,
    },
    star: {
        fontSize: 44,
        color: theme.colors.glass.border, // Inactive stars look like glass etchings
    },
    starSelected: {
        color: '#FFD700',
        textShadowColor: 'rgba(255, 215, 0, 0.5)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
    },
    ratingLabelContainer: {
        alignItems: 'center',
    },
    ratingLabel: {
        color: theme.colors.brand.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.medium,
        letterSpacing: 1,
    },
    glassTripSummary: {
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.xxl,
    },
    summaryTitle: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        textTransform: 'uppercase',
        marginBottom: theme.spacing.md,
        letterSpacing: 1,
        fontWeight: theme.typography.weights.bold,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.md,
    },
    summaryLabel: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    summaryPrice: {
        color: theme.colors.brand.primary,
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.glass.border,
        marginBottom: theme.spacing.md,
    },
    summaryStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    stat: {
        alignItems: 'center',
    },
    statValue: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.semibold,
    },
    statLabel: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        marginTop: 2,
    },
    statDivider: {
        width: 1,
        backgroundColor: theme.colors.glass.border,
    },
    submitButton: {
        marginTop: theme.spacing.sm,
    },
    thankYouContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    successIcon: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: theme.colors.brand.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.xxl,
        ...theme.shadows.glow,
    },
    checkmark: {
        fontSize: 48,
        color: theme.colors.text.inverse,
        fontWeight: theme.typography.weights.bold,
    },
    thankYouTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xxxl,
        fontWeight: theme.typography.weights.bold,
        marginBottom: theme.spacing.sm,
    },
    thankYouText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.lg,
    },
});
