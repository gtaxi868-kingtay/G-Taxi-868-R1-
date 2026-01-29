import React, { useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Dimensions,
    FlatList,
    Animated,
    Image,
    TouchableOpacity,
    Platform,
} from 'react-native';
import { theme } from '../theme';
import { GlassView } from './GlassView';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.75;
const SPACING = 12;
const SNAP_INTERVAL = CARD_WIDTH + SPACING;
const PAGE_WIDTH = width; // Center alignment logic needs full width consideration 
// Actually, to center items: 
// Content Inset = (width - CARD_WIDTH) / 2
const INSET = (width - CARD_WIDTH) / 2;

export type VehicleType = 'Standard' | 'XL' | 'Premium';

interface VehicleOption {
    id: VehicleType;
    name: VehicleType;
    multiplier: number;
    description: string;
    seats: number;
    color: string; // Neon accent color
    time: string;
}

const VEHICLES: VehicleOption[] = [
    {
        id: 'Standard',
        name: 'Standard',
        multiplier: 1.0,
        description: 'Affordable, everyday rides',
        seats: 4,
        color: '#00BFA5', // Teal/Cyan
        time: '3 min',
    },
    {
        id: 'XL',
        name: 'XL',
        multiplier: 1.5,
        description: 'For larger groups',
        seats: 6,
        color: '#9D4EDD', // Purple
        time: '8 min',
    },
    {
        id: 'Premium',
        name: 'Premium',
        multiplier: 2.0,
        description: 'Luxury experience',
        seats: 4,
        color: '#FFD700', // Gold
        time: '12 min',
    },
];

interface VehicleSelectionProps {
    basePrice: number;
    onSelect: (type: VehicleType, multiplier: number) => void;
    selectedType: VehicleType;
}

export function VehicleSelection({ basePrice, onSelect, selectedType }: VehicleSelectionProps) {
    const scrollX = useRef(new Animated.Value(0)).current;

    const renderItem = ({ item, index }: { item: VehicleOption; index: number }) => {
        const inputRange = [
            (index - 1) * SNAP_INTERVAL,
            index * SNAP_INTERVAL,
            (index + 1) * SNAP_INTERVAL,
        ];

        const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.9, 1.05, 0.9],
            extrapolate: 'clamp',
        });

        const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.6, 1, 0.6],
            extrapolate: 'clamp',
        });

        const borderColor = item.id === selectedType ? item.color : 'transparent';
        const price = Math.round(basePrice * item.multiplier);

        return (
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => onSelect(item.id, item.multiplier)}
                style={styles.cardContainer}
            >
                <Animated.View
                    style={[
                        styles.card,
                        {
                            transform: [{ scale }],
                            opacity,
                            borderColor,
                            shadowColor: item.color,
                            shadowOpacity: item.id === selectedType ? 0.6 : 0,
                        },
                    ]}
                >
                    <GlassView intensity="heavy" style={styles.glassInner}>
                        {/* Header Row */}
                        <View style={styles.headerRow}>
                            <Text style={[styles.vehicleName, { color: item.color }]}>
                                {item.name}
                            </Text>
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>{item.seats} 👤</Text>
                            </View>
                        </View>

                        {/* Image Placeholder (Emoji for now, could be Asset) */}
                        <View style={styles.imageContainer}>
                            <Text style={styles.vehicleEmoji}>
                                {item.id === 'Standard' ? '🚗' : item.id === 'XL' ? '🚙' : '🏎️'}
                            </Text>
                        </View>

                        {/* Price & Time */}
                        <View style={styles.detailsContainer}>
                            <Text style={styles.priceText}>${(price / 100).toFixed(2)}</Text>
                            <Text style={styles.subText}>{item.time} away</Text>
                        </View>

                        <Text style={styles.description}>{item.description}</Text>
                    </GlassView>
                </Animated.View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <Animated.FlatList
                data={VEHICLES}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                decelerationRate="fast"
                contentContainerStyle={{
                    paddingHorizontal: INSET,
                }}
                keyExtractor={(item) => item.id}
                onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                    { useNativeDriver: true }
                )}
                renderItem={renderItem}
            // Initialize selection logic on scroll end if needed, 
            // but for now user explicitly taps or we infer from center
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 240,
        marginVertical: theme.spacing.lg,
    },
    cardContainer: {
        width: CARD_WIDTH,
        marginHorizontal: SPACING / 2,
        height: '100%',
        justifyContent: 'center',
    },
    card: {
        flex: 1,
        borderRadius: theme.borderRadius.xl,
        borderWidth: 2,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 10,
        elevation: 5,
    },
    glassInner: {
        flex: 1,
        padding: theme.spacing.lg,
        backgroundColor: 'rgba(20, 20, 30, 0.6)', // Darker tint for contrast
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.md,
    },
    vehicleName: {
        fontSize: 24,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 1, height: 1 },
        textShadowRadius: 2,
    },
    badge: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    badgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    vehicleEmoji: {
        fontSize: 64,
        // Add drop shadow to emoji if possible (works on some platforms)
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 10,
    },
    detailsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.1)',
        paddingTop: theme.spacing.sm,
    },
    priceText: {
        color: '#fff',
        fontSize: 28,
        fontWeight: 'bold',
    },
    subText: {
        color: theme.colors.text.secondary,
        fontSize: 14,
    },
    description: {
        color: theme.colors.text.tertiary,
        fontSize: 12,
        marginTop: 4,
    },
});
