import React, { useRef, useState } from 'react';
import {
    View,
    StyleSheet,
    Dimensions,
    TouchableOpacity,
    Animated,
    Image,
    FlatList,
} from 'react-native';
import { tokens } from '../design-system/tokens';
import { Card, Txt, Surface, Btn } from '../design-system/primitives';

const { width } = Dimensions.get('window');
// Card width is 70% of screen to show next item peeking
const CARD_WIDTH = width * 0.65;
const SPACING = tokens.layout.spacing.md;
const SNAP_INTERVAL = CARD_WIDTH + SPACING;
const SIDE_SPACER = (width - CARD_WIDTH) / 2; // Center the first item

export type VehicleType = 'Standard' | 'XL' | 'Premium';

interface VehicleOption {
    id: VehicleType;
    displayName: string;
    multiplier: number;
    description: string;
    seats: number;
    time: string;
}

const VEHICLES: VehicleOption[] = [
    {
        id: 'Standard',
        displayName: 'G-Standard',
        multiplier: 1.0,
        description: 'Everyday rides',
        seats: 4,
        time: '3 min',
    },
    {
        id: 'Premium',
        displayName: 'G-Premium',
        multiplier: 2.0,
        description: 'Luxury experience',
        seats: 4,
        time: '5 min',
    },
    {
        id: 'XL',
        displayName: 'G-XL',
        multiplier: 1.5,
        description: 'Larger groups',
        seats: 6,
        time: '8 min',
    },
];

const CAR_IMAGES: Record<VehicleType, any> = {
    Standard: require('../../assets/images/car_standard.png'),
    Premium: require('../../assets/images/car_premium.png'),
    XL: require('../../assets/images/car_xl.png'),
};

interface VehicleCardProps {
    vehicle: VehicleOption;
    selected: boolean;
    onPress: () => void;
}

function VehicleCard({ vehicle, selected, onPress }: VehicleCardProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.95,
            useNativeDriver: true,
        }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
        }).start();
    };

    const borderStyle = selected ? {
        borderColor: tokens.colors.primary.purple,
        borderWidth: 2,
    } : {
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.05)'
    };

    const glowStyle = selected ? tokens.elevation.glowM : {};

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
        >
            <Animated.View style={[{ transform: [{ scale: scaleAnim }], ...glowStyle }]}>
                <Card
                    radius="l"
                    padding="md"
                    style={[
                        styles.card,
                        borderStyle,
                        selected && { backgroundColor: 'rgba(168, 85, 247, 0.15)' } // Subtle internal glow
                    ]}
                >
                    {/* Header: Name & Time */}
                    <View style={styles.cardHeader}>
                        <Txt variant="headingM" weight="bold">{vehicle.displayName}</Txt>
                        <Surface style={{ borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Txt variant="caption" weight="bold">{vehicle.time}</Txt>
                        </Surface>
                    </View>

                    {/* Car Image - "Floating" */}
                    <View style={styles.imageContainer}>
                        <Image
                            source={CAR_IMAGES[vehicle.id]}
                            style={styles.carImage}
                            resizeMode="contain"
                        />
                    </View>

                    {/* Footer: Details */}
                    <View style={styles.cardFooter}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                {vehicle.seats} seats • {vehicle.description}
                            </Txt>
                        </View>
                    </View>
                </Card>
            </Animated.View>
        </TouchableOpacity>
    );
}

interface VehicleSelectionProps {
    basePrice: number;
    onSelect: (type: VehicleType, multiplier: number) => void;
    selectedType: VehicleType;
}

export function VehicleSelection({ onSelect, selectedType }: VehicleSelectionProps) {
    const flatListRef = useRef<FlatList>(null);

    // Auto-scroll to selected item if controlled externally (optional polish)
    // useEffect(() => {
    //     const index = VEHICLES.findIndex(v => v.id === selectedType);
    //     if (index !== -1 && flatListRef.current) {
    //         flatListRef.current.scrollToIndex({ index, animated: true });
    //     }
    // }, [selectedType]);

    return (
        <View style={styles.container}>
            <FlatList
                ref={flatListRef}
                data={VEHICLES}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                decelerationRate="fast"
                contentContainerStyle={{
                    paddingHorizontal: SIDE_SPACER,
                    gap: SPACING
                }}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <VehicleCard
                        vehicle={item}
                        selected={selectedType === item.id}
                        onPress={() => onSelect(item.id, item.multiplier)}
                    />
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginVertical: 16,
    },
    card: {
        width: CARD_WIDTH,
        height: CARD_WIDTH * 0.85,
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.03)', // Very subtle glass
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    imageContainer: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        marginVertical: 4,
    },
    carImage: {
        width: '110%', // Slight overlap
        height: '110%',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'center',
        opacity: 0.8,
    },
});
