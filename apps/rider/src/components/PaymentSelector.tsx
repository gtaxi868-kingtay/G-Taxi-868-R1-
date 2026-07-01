import React from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Image,
    Text,
} from 'react-native';
import { tokens } from '@/design-system/tokens';
import { Txt } from '@/design-system/primitives';
import { Ionicons } from '@expo/vector-icons';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

export type PaymentMethod = 'cash' | 'card' | 'wallet';

interface PaymentSelectorProps {
    selected: PaymentMethod;
    onSelect: (method: PaymentMethod) => void;
    walletBalance?: number;
    requiredAmount?: number;
}

const G_COIN_LOGO = require('../../assets/images/g_coin_logo.png');

export function PaymentSelector({ selected, onSelect, walletBalance, requiredAmount }: PaymentSelectorProps) {

    const OPTIONS: { id: PaymentMethod; icon?: string; image?: any; label: string; disabled?: boolean; comingSoon?: boolean }[] = [
        { id: 'cash', icon: 'cash-outline', label: 'Cash' },
        {
            id: 'wallet',
            image: G_COIN_LOGO,
            label: walletBalance !== undefined
                ? `G-Coin ($${walletBalance.toFixed(2)})`
                : 'G-Coin',
            disabled: (walletBalance !== undefined && requiredAmount !== undefined)
                ? walletBalance < requiredAmount
                : false,
        },
        { id: 'card', icon: 'card-outline', label: 'Card', comingSoon: true },
    ];

    const handlePress = (option: typeof OPTIONS[0]) => {
        if (option.disabled) {
            Alert.alert('Insufficient Balance', 'Your G-Coin balance is too low. Top up in Wallet to use this method.');
            return;
        }
        if (option.comingSoon) {
            Alert.alert(
                'Card Payments Coming Soon',
                'Card payments via WiPay are launching soon for Trinidad & Tobago. Please use Cash or G-Coin for this ride.',
                [{ text: 'OK', style: 'default' }],
            );
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
                    const muted = opt.disabled || opt.comingSoon;
                    return (
                        <TouchableOpacity
                            key={opt.id}
                            style={[
                                styles.option,
                                isSelected && styles.optionSelected,
                                muted && styles.optionMuted,
                            ]}
                            onPress={() => handlePress(opt)}
                            activeOpacity={0.7}
                        >
                            {opt.comingSoon && (
                                <View style={styles.soonBadge}>
                                    <Text style={styles.soonText}>SOON</Text>
                                </View>
                            )}
                            {opt.image ? (
                                <Image
                                    source={opt.image}
                                    style={{ width: 24, height: 24, marginBottom: 4 }}
                                    resizeMode="contain"
                                />
                            ) : (
                                <Ionicons
                                    name={opt.icon as any}
                                    size={20}
                                    color={isSelected ? tokens.colors.text.primary : tokens.colors.text.secondary}
                                    style={{ marginBottom: 4 }}
                                />
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
        ...ghostBorder(0.05),
        position: 'relative',
    },
    optionSelected: {
        borderColor: tokens.colors.primary.purple,
        backgroundColor: 'rgba(123, 97, 255, 0.15)',
    },
    optionMuted: {
        opacity: 0.5,
    },
    soonBadge: {
        position: 'absolute',
        top: 4,
        right: 4,
        backgroundColor: 'rgba(245, 158, 11, 0.85)',
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 1,
    },
    soonText: {
        fontSize: 8,
        fontWeight: '900',
        color: '#EAF3F6',
        letterSpacing: 0.5,
    },
});
