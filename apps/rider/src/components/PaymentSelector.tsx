import React from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Image,
} from 'react-native';
import { GlassView } from './GlassView';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';

export type PaymentMethod = 'cash' | 'card' | 'wallet';

interface PaymentSelectorProps {
    selected: PaymentMethod;
    onSelect: (method: PaymentMethod) => void;
    walletBalance?: number;
    requiredAmount?: number;
}

// NOTE: Ensure this asset exists at this path!
const G_COIN_LOGO = require('../../assets/images/g_coin_logo.png');

export function PaymentSelector({ selected, onSelect, walletBalance, requiredAmount }: PaymentSelectorProps) {

    const OPTIONS: { id: PaymentMethod; icon?: string; image?: any; label: string; disabled?: boolean }[] = [
        { id: 'cash', icon: '💵', label: 'Cash' },
        {
            id: 'wallet',
            image: G_COIN_LOGO,
            label: walletBalance !== undefined
                ? `G-Coin ($${walletBalance.toFixed(2)})`
                : 'G-Coin',
            disabled: (walletBalance !== undefined && requiredAmount !== undefined)
                ? walletBalance < requiredAmount
                : false
        }, // Branding Update
        { id: 'card', icon: '💳', label: 'Card' },
    ];

    const handlePress = (option: typeof OPTIONS[0]) => {
        if (option.disabled) {
            Alert.alert('Coming Soon', `${option.label} payments are not yet available.`);
            return;
        }
        onSelect(option.id);
    };

    return (
        <View style={styles.container}>
            <Txt variant="caption" color={tokens.colors.text.tertiary} style={styles.label}>
                PAYMENT METHOD
            </Txt>
            <View style={styles.optionsRow}>
                {OPTIONS.map((opt) => {
                    const isSelected = selected === opt.id;
                    return (
                        <TouchableOpacity
                            key={opt.id}
                            style={[
                                styles.option,
                                isSelected && styles.optionSelected,
                                opt.disabled && styles.optionDisabled
                            ]}
                            onPress={() => handlePress(opt)}
                            activeOpacity={0.7}
                        >
                            {opt.image ? (
                                <Image
                                    source={opt.image}
                                    style={{ width: 24, height: 24, marginBottom: 4 }}
                                    resizeMode="contain"
                                />
                            ) : (
                                <Txt style={{ fontSize: 20, marginBottom: 4 }}>{opt.icon}</Txt>
                            )}
                            <Txt
                                variant="bodyBold"
                                color={isSelected ? tokens.colors.text.primary : tokens.colors.text.secondary}
                                style={{ fontSize: 14 }}
                            >
                                {opt.label}
                            </Txt>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: tokens.layout.spacing.lg,
    },
    label: {
        letterSpacing: 1,
        marginBottom: tokens.layout.spacing.sm,
    },
    optionsRow: {
        flexDirection: 'row',
        gap: tokens.layout.spacing.sm,
    },
    option: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: tokens.layout.radius.m,
        backgroundColor: tokens.colors.glass.fill,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    optionSelected: {
        borderColor: tokens.colors.primary.purple,
        backgroundColor: 'rgba(123, 97, 255, 0.15)',
    },
    optionDisabled: {
        opacity: 0.5,
    },
});
