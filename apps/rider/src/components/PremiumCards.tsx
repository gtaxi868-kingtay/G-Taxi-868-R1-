import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Image,
    ViewStyle,
    TouchableOpacity,
    useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

// Solid surface card — replaces the former rainbow-edge glass card.
// Background: dark tinted surface. Border: subtle 0.5px. No gradient edges, no rainbow.
interface SolidCardProps {
    children: React.ReactNode;
    style?: ViewStyle;
}

export function SolidCard({ children, style }: SolidCardProps) {
    return (
        <View style={[styles.solidCard, style]}>
            {children}
        </View>
    );
}

// DriverCard — shown to rider when driver is assigned.
// Primary trust moment: name, rating, vehicle, plate, contact actions.
interface DriverCardProps {
    name: string;
    rating: number;
    vehicle: string;
    plate: string;
    photoUri?: string;
    onCall?: () => void;
    onMessage?: () => void;
}

export function DriverCard({ name, rating, vehicle, plate, photoUri, onCall, onMessage }: DriverCardProps) {
    return (
        <SolidCard style={styles.driverCardContainer}>
            {/* Photo */}
            <View style={styles.driverPhotoSection}>
                <View style={styles.photoRing}>
                    {photoUri ? (
                        <Image source={{ uri: photoUri }} style={styles.driverPhoto} />
                    ) : (
                        <View style={styles.photoPlaceholder}>
                            <Text style={styles.photoInitial}>{name.charAt(0).toUpperCase()}</Text>
                        </View>
                    )}
                </View>
            </View>

            {/* Info */}
            <View style={styles.driverInfoSection}>
                <View style={styles.nameRatingRow}>
                    <Text style={styles.driverName}>{name}</Text>
                    <View style={styles.ratingBadge}>
                        <Ionicons name="star" size={12} color="#F59E0B" />
                        <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
                    </View>
                </View>
                <Text style={styles.vehicleInfo}>{vehicle}</Text>
                <Text style={styles.plateText}>{plate}</Text>
            </View>

            {/* Contact actions — wired to actual handlers */}
            <View style={styles.actionRow}>
                <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={onCall}
                    activeOpacity={0.7}
                    accessibilityLabel="Call driver"
                    accessibilityRole="button"
                >
                    <Ionicons name="call-outline" size={20} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={onMessage}
                    activeOpacity={0.7}
                    accessibilityLabel="Message driver"
                    accessibilityRole="button"
                >
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
            </View>
        </SolidCard>
    );
}

// FareCard — shown at ride complete
interface FareCardProps {
    amount: string;
    paymentMethod: 'cash' | 'card';
}

export function FareCard({ amount, paymentMethod }: FareCardProps) {
    return (
        <View style={styles.fareCard}>
            <Text style={styles.fareAmount}>{amount}</Text>
            <View style={styles.paymentRow}>
                <Ionicons
                    name={paymentMethod === 'cash' ? 'cash-outline' : 'card-outline'}
                    size={14}
                    color="rgba(255,255,255,0.5)"
                />
                <Text style={styles.paymentLabel}>
                    {paymentMethod === 'cash' ? 'Cash' : 'Card'}
                </Text>
                <Ionicons name="checkmark-circle" size={14} color="#4ADE80" />
            </View>
        </View>
    );
}

// VehicleCard — ride type selector
interface VehicleCardProps {
    name: string;
    selected: boolean;
    onPress: () => void;
}

export function VehicleCard({ name, selected, onPress }: VehicleCardProps) {
    const { width } = useWindowDimensions();
    return (
        <TouchableOpacity
            style={[styles.vehicleCard, { width: (width - 56) / 2 }, selected && styles.vehicleCardSelected]}
            onPress={onPress}
            activeOpacity={0.8}
            accessibilityLabel={`Select ${name} ride type`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
        >
            <Text style={styles.vehicleCardName}>{name}</Text>
            <View style={styles.vehicleImageArea}>
                <Ionicons name="car-outline" size={40} color={selected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)'} />
            </View>
            {selected && <View style={styles.selectedDot} />}
        </TouchableOpacity>
    );
}

// CheckmarkOrb — ride complete success state
export function CheckmarkOrb() {
    return (
        <View style={styles.checkmarkOrbContainer}>
            <View style={styles.checkmarkOrb}>
                <Ionicons name="checkmark" size={44} color="#4ADE80" />
            </View>
        </View>
    );
}

// StarRating — post-ride rating
interface StarRatingProps {
    rating: number;
    onRate: (stars: number) => void;
}

export function StarRating({ rating, onRate }: StarRatingProps) {
    return (
        <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                    key={star}
                    onPress={() => onRate(star)}
                    accessibilityLabel={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    accessibilityRole="button"
                    style={styles.starTouch}
                >
                    <Ionicons
                        name={star <= rating ? 'star' : 'star-outline'}
                        size={32}
                        color={star <= rating ? '#F59E0B' : 'rgba(255,255,255,0.2)'}
                    />
                </TouchableOpacity>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    // Solid card — default surface
    solidCard: {
        backgroundColor: 'rgba(28,36,32,0.95)',
        borderRadius: 20,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.09)',
        overflow: 'hidden',
    },

    // Driver card
    driverCardContainer: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    driverPhotoSection: { marginRight: 14 },
    photoRing: {
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.15)',
        overflow: 'hidden',
    },
    driverPhoto: { width: '100%', height: '100%' },
    photoPlaceholder: {
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoInitial: { color: '#EAF3F6', fontSize: 22, fontWeight: '600' },
    driverInfoSection: { flex: 1 },
    nameRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    driverName: { color: '#EAF3F6', fontSize: 17, fontWeight: '600' },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    ratingValue: { color: '#F59E0B', fontSize: 13, fontWeight: '600' },
    vehicleInfo: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 1 },
    plateText: { color: 'rgba(255,255,255,0.35)', fontSize: 12 },
    actionRow: { flexDirection: 'column', gap: 8 },
    actionBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Fare card
    fareCard: {
        backgroundColor: 'rgba(28,36,32,0.95)',
        borderRadius: 16,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingVertical: 20,
        paddingHorizontal: 24,
        alignItems: 'center',
        marginVertical: 16,
    },
    fareAmount: { color: '#EAF3F6', fontSize: 36, fontWeight: '700', marginBottom: 8 },
    paymentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    paymentLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },

    // Vehicle card
    vehicleCard: {
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(28,36,32,0.9)',
        padding: 16,
        alignItems: 'center',
    },
    vehicleCardSelected: {
        borderColor: 'rgba(255,255,255,0.4)',
        backgroundColor: 'rgba(40,55,48,0.95)',
    },
    vehicleCardName: { color: '#EAF3F6', fontSize: 15, fontWeight: '600', marginBottom: 12 },
    vehicleImageArea: { height: 64, width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    selectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },

    // Checkmark orb
    checkmarkOrbContainer: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center' },
    checkmarkOrb: {
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: 'rgba(74,222,128,0.12)',
        borderWidth: 1.5,
        borderColor: 'rgba(74,222,128,0.3)',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Star rating
    starRow: { flexDirection: 'row', gap: 8, marginVertical: 16 },
    starTouch: { padding: 4 },
});
