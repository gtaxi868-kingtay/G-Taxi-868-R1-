// Premium Glass Card - EXACTLY matches mockup's frosted glass with rainbow refraction edge
// Used for: Driver info card, fare card, vehicle selection

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Image,
    ViewStyle,
    Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

// RAINBOW GLASS CARD - The frosted card with rainbow edge on left (like driver card in mockup)
interface RainbowGlassCardProps {
    children: React.ReactNode;
    style?: ViewStyle;
}

export function RainbowGlassCard({ children, style }: RainbowGlassCardProps) {
    return (
        <View style={[styles.rainbowCardContainer, style]}>
            {/* Rainbow refraction edge - left side prismatic effect */}
            <View style={styles.rainbowEdge}>
                <View style={styles.rainbowCyan} />
                <View style={styles.rainbowMagenta} />
                <View style={styles.rainbowYellow} />
            </View>

            {/* Glass body */}
            <View style={styles.rainbowCardBody}>
                {/* Top frosted shine */}
                <View style={styles.cardTopShine} />

                {/* Bottom rainbow reflection */}
                <View style={styles.bottomRainbow} />

                {/* Content */}
                <View style={styles.cardContent}>
                    {children}
                </View>
            </View>
        </View>
    );
}

// DRIVER INFO CARD - Matches mockup exactly with photo, name, rating, vehicle
interface DriverCardProps {
    name: string;
    rating: number;
    vehicle: string;
    plate: string;
    photoUri?: string;
    onCall?: () => void;
    onMessage?: () => void;
}

export function DriverCard({
    name,
    rating,
    vehicle,
    plate,
    photoUri,
    onCall,
    onMessage,
}: DriverCardProps) {
    return (
        <RainbowGlassCard style={styles.driverCardContainer}>
            {/* Photo with purple glowing ring */}
            <View style={styles.driverPhotoSection}>
                <View style={styles.photoRingOuter}>
                    <View style={styles.photoRingInner}>
                        {photoUri ? (
                            <Image source={{ uri: photoUri }} style={styles.driverPhoto} />
                        ) : (
                            <View style={styles.photoPlaceholder}>
                                <Text style={styles.photoInitial}>{name.charAt(0).toUpperCase()}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </View>

            {/* Driver Info */}
            <View style={styles.driverInfoSection}>
                <View style={styles.nameRatingRow}>
                    <Text style={styles.driverName}>{name}</Text>
                    <View style={styles.ratingBadge}>
                        <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
                        <Text style={styles.ratingStar}>★</Text>
                    </View>
                </View>
                <Text style={styles.vehicleInfo}>{vehicle} - {plate}</Text>
            </View>

            {/* Action buttons - glass orbs */}
            <View style={styles.actionButtonsRow}>
                <View style={styles.glassOrb}>
                    <Text style={styles.orbIcon}>📞</Text>
                </View>
                <View style={styles.glassOrb}>
                    <Text style={styles.orbIcon}>💬</Text>
                </View>
            </View>
        </RainbowGlassCard>
    );
}

// FARE DISPLAY CARD - Matches the ride complete screen
interface FareCardProps {
    amount: string;
    paymentMethod: 'cash' | 'card';
}

export function FareCard({ amount, paymentMethod }: FareCardProps) {
    return (
        <View style={styles.fareCardContainer}>
            {/* Glass background */}
            <View style={styles.fareCardGlass}>
                <Text style={styles.fareAmount}>{amount}</Text>
                <View style={styles.paymentConfirmRow}>
                    <Text style={styles.paymentLabel}>Payment: </Text>
                    <Text style={styles.paymentMethod}>{paymentMethod === 'cash' ? 'Cash' : 'Card'}</Text>
                    <Text style={styles.paymentCheck}> ✓</Text>
                </View>
            </View>
        </View>
    );
}

// VEHICLE SELECTION CARD - Matches G-Standard/G-Premium cards in mockup
interface VehicleCardProps {
    name: string;
    selected: boolean;
    onPress: () => void;
}

export function VehicleCard({ name, selected }: VehicleCardProps) {
    return (
        <View style={[styles.vehicleCardContainer, selected && styles.vehicleCardSelected]}>
            {/* Purple glow border when selected */}
            {selected && <View style={styles.vehicleGlowBorder} />}

            {/* Card body */}
            <View style={styles.vehicleCardBody}>
                <Text style={styles.vehicleCardName}>{name}</Text>

                {/* Car image placeholder - styled to look 3D */}
                <View style={styles.vehicleImageArea}>
                    <View style={styles.car3DPlaceholder}>
                        <Text style={styles.carEmoji}>🚗</Text>
                        {/* Reflection underneath */}
                        <View style={styles.carReflection} />
                    </View>
                </View>

                {/* Dots indicator */}
                <View style={styles.dotsIndicator}>
                    <View style={[styles.dot, selected && styles.dotActive]} />
                    <View style={[styles.dot, selected && styles.dotActive]} />
                    <View style={[styles.dot, selected && styles.dotActive]} />
                </View>
            </View>
        </View>
    );
}

// CHECKMARK ORB - The glass orb with checkmark from "Ride Complete" mockup
export function CheckmarkOrb() {
    return (
        <View style={styles.checkmarkOrbContainer}>
            {/* Outer glow */}
            <View style={styles.checkmarkGlow} />

            {/* Glass orb */}
            <View style={styles.checkmarkOrb}>
                {/* Rainbow refraction arc */}
                <View style={styles.rainbowArc} />

                {/* Top shine */}
                <View style={styles.orbTopShine} />

                {/* Checkmark */}
                <Text style={styles.checkmarkIcon}>✓</Text>
            </View>
        </View>
    );
}

// 3D STAR RATING - Matches the glassmorphic stars in mockup
interface StarRatingProps {
    rating: number;
    onRate: (stars: number) => void;
}

export function StarRating({ rating, onRate }: StarRatingProps) {
    return (
        <View style={styles.starRatingContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
                <View key={star} style={styles.starContainer}>
                    <Text
                        style={[
                            styles.starIcon,
                            star <= rating && styles.starActive
                        ]}
                        onPress={() => onRate(star)}
                    >
                        ★
                    </Text>
                    {/* Star glow when active */}
                    {star <= rating && <View style={styles.starGlow} />}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    // RAINBOW GLASS CARD
    rainbowCardContainer: {
        position: 'relative',
        borderRadius: 20,
        overflow: 'hidden',
    },
    rainbowEdge: {
        position: 'absolute',
        left: 0,
        top: '15%',
        bottom: '15%',
        width: 4,
        borderRadius: 2,
        overflow: 'hidden',
        zIndex: 10,
    },
    rainbowCyan: {
        flex: 1,
        backgroundColor: '#00FFFF',
        opacity: 0.8,
    },
    rainbowMagenta: {
        flex: 1,
        backgroundColor: '#FF00FF',
        opacity: 0.6,
    },
    rainbowYellow: {
        flex: 1,
        backgroundColor: '#FFFF00',
        opacity: 0.5,
    },
    rainbowCardBody: {
        backgroundColor: 'rgba(40, 40, 60, 0.85)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.15)',
        overflow: 'hidden',
    },
    cardTopShine: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '30%',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    bottomRainbow: {
        position: 'absolute',
        bottom: 0,
        left: '10%',
        right: '60%',
        height: 3,
        backgroundColor: '#00FFFF',
        opacity: 0.3,
        borderRadius: 2,
    },
    cardContent: {
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },

    // DRIVER CARD
    driverCardContainer: {
        width: '100%',
    },
    driverPhotoSection: {
        marginRight: 12,
    },
    photoRingOuter: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(168, 85, 247, 0.3)',
        padding: 3,
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 12,
    },
    photoRingInner: {
        flex: 1,
        borderRadius: 29,
        borderWidth: 2,
        borderColor: '#A855F7',
        overflow: 'hidden',
    },
    driverPhoto: {
        width: '100%',
        height: '100%',
    },
    photoPlaceholder: {
        flex: 1,
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoInitial: {
        color: '#FFFFFF',
        fontSize: 24,
        fontWeight: '700',
    },
    driverInfoSection: {
        flex: 1,
    },
    nameRatingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    driverName: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '600',
        marginRight: 8,
    },
    ratingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    ratingValue: {
        color: '#FFD700',
        fontSize: 16,
        fontWeight: '600',
    },
    ratingStar: {
        color: '#FFD700',
        fontSize: 14,
        marginLeft: 2,
    },
    vehicleInfo: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 14,
    },
    actionButtonsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    glassOrb: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(168, 85, 247, 0.25)',
        borderWidth: 1,
        borderColor: 'rgba(168, 85, 247, 0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
    },
    orbIcon: {
        fontSize: 20,
    },

    // FARE CARD
    fareCardContainer: {
        marginVertical: 16,
    },
    fareCardGlass: {
        backgroundColor: 'rgba(40, 50, 60, 0.9)',
        borderRadius: 16,
        paddingVertical: 20,
        paddingHorizontal: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    fareAmount: {
        color: '#FFFFFF',
        fontSize: 36,
        fontWeight: '700',
        marginBottom: 8,
    },
    paymentConfirmRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    paymentLabel: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 14,
    },
    paymentMethod: {
        color: '#00FFD1',
        fontSize: 14,
        fontWeight: '500',
    },
    paymentCheck: {
        color: '#00FFD1',
        fontSize: 14,
    },

    // VEHICLE CARD
    vehicleCardContainer: {
        width: (width - 56) / 2,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: 'transparent',
        overflow: 'hidden',
    },
    vehicleCardSelected: {
        borderColor: '#A855F7',
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 16,
    },
    vehicleGlowBorder: {
        position: 'absolute',
        top: -3,
        left: -3,
        right: -3,
        bottom: -3,
        borderRadius: 23,
        borderWidth: 2,
        borderColor: 'rgba(168, 85, 247, 0.4)',
    },
    vehicleCardBody: {
        backgroundColor: 'rgba(30, 30, 45, 0.95)',
        padding: 16,
        alignItems: 'center',
    },
    vehicleCardName: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
    },
    vehicleImageArea: {
        height: 70,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    car3DPlaceholder: {
        alignItems: 'center',
    },
    carEmoji: {
        fontSize: 48,
    },
    carReflection: {
        width: 60,
        height: 8,
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        borderRadius: 30,
        marginTop: 4,
    },
    dotsIndicator: {
        flexDirection: 'row',
        gap: 6,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
    },
    dotActive: {
        backgroundColor: '#A855F7',
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 4,
    },

    // CHECKMARK ORB
    checkmarkOrbContainer: {
        width: 120,
        height: 120,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkmarkGlow: {
        position: 'absolute',
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
    },
    checkmarkOrb: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: 'rgba(60, 60, 80, 0.9)',
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
    },
    rainbowArc: {
        position: 'absolute',
        top: 10,
        left: 10,
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 3,
        borderColor: 'transparent',
        borderTopColor: '#00FFFF',
        borderRightColor: '#FF00FF',
        transform: [{ rotate: '-45deg' }],
        opacity: 0.6,
    },
    orbTopShine: {
        position: 'absolute',
        top: 8,
        left: '20%',
        right: '20%',
        height: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 6,
    },
    checkmarkIcon: {
        color: '#00FFD1',
        fontSize: 44,
        fontWeight: '300',
    },

    // STAR RATING
    starRatingContainer: {
        flexDirection: 'row',
        gap: 8,
        marginVertical: 16,
    },
    starContainer: {
        position: 'relative',
    },
    starIcon: {
        fontSize: 36,
        color: 'rgba(255, 255, 255, 0.25)',
    },
    starActive: {
        color: 'rgba(200, 200, 220, 0.9)',
        textShadowColor: '#FFFFFF',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
    },
    starGlow: {
        position: 'absolute',
        bottom: -4,
        left: '20%',
        right: '20%',
        height: 4,
        backgroundColor: 'rgba(168, 85, 247, 0.4)',
        borderRadius: 2,
    },
});
