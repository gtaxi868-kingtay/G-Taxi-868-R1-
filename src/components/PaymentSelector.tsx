import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
} from 'react-native';
import { GlassView } from './GlassView';
import { theme } from '../theme';

export type PaymentMethod = 'cash' | 'card';

interface PaymentSelectorProps {
    selected: PaymentMethod;
    onSelect: (method: PaymentMethod) => void;
}

export function PaymentSelector({ selected, onSelect }: PaymentSelectorProps) {
    const handleCardPress = () => {
        // Phase 1: Card is coming soon
        Alert.alert(
            'Card Payments Coming Soon',
            'We\'re working on integrating card payments. For now, please select Cash.',
            [{ text: 'OK' }]
        );
        // Uncomment when ready:
        // onSelect('card');
    };

    return (
        <GlassView style={styles.container} intensity="light">
            <Text style={styles.label}>PAYMENT METHOD</Text>
            <View style={styles.optionsRow}>
                {/* Cash Option */}
                <TouchableOpacity
                    style={[
                        styles.option,
                        selected === 'cash' && styles.optionSelected,
                    ]}
                    onPress={() => onSelect('cash')}
                    activeOpacity={0.7}
                >
                    <Text style={styles.optionIcon}>💵</Text>
                    <Text style={[
                        styles.optionText,
                        selected === 'cash' && styles.optionTextSelected,
                    ]}>Cash</Text>
                </TouchableOpacity>

                {/* Card Option */}
                <TouchableOpacity
                    style={[
                        styles.option,
                        selected === 'card' && styles.optionSelected,
                    ]}
                    onPress={handleCardPress}
                    activeOpacity={0.7}
                >
                    <Text style={styles.optionIcon}>💳</Text>
                    <View style={styles.cardTextContainer}>
                        <Text style={[
                            styles.optionText,
                            selected === 'card' && styles.optionTextSelected,
                        ]}>Card</Text>
                        <Text style={styles.comingSoon}>Soon</Text>
                    </View>
                </TouchableOpacity>
            </View>
        </GlassView>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.lg,
    },
    label: {
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.tertiary,
        letterSpacing: 1,
        marginBottom: theme.spacing.sm,
    },
    optionsRow: {
        flexDirection: 'row',
        gap: theme.spacing.md,
    },
    option: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    optionSelected: {
        borderColor: theme.colors.brand.primary,
        backgroundColor: 'rgba(0, 212, 170, 0.1)',
    },
    optionIcon: {
        fontSize: 20,
        marginRight: theme.spacing.sm,
    },
    optionText: {
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.semibold,
        color: theme.colors.text.secondary,
    },
    optionTextSelected: {
        color: theme.colors.text.primary,
    },
    cardTextContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    comingSoon: {
        fontSize: theme.typography.sizes.xs,
        color: theme.colors.brand.primary,
        marginLeft: theme.spacing.xs,
        fontWeight: theme.typography.weights.bold,
    },
});
