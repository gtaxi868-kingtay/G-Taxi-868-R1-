import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast } from './Toast';
import { RADIUS, SPACE, Txt, useTheme } from '../ui/kit';

export type PaymentMethod = 'cash' | 'card' | 'wallet';

interface PaymentSelectorProps {
    selected: PaymentMethod;
    onSelect: (method: PaymentMethod) => void;
    walletBalance?: number;
    requiredAmount?: number;
}

const G_COIN_LOGO = require('../../assets/images/g_coin_logo.png');

// Cash and G-Coin only. Card is not offered until card payments are live,
// so there is no button that only says "coming soon".
export function PaymentSelector({ selected, onSelect, walletBalance, requiredAmount }: PaymentSelectorProps) {
    const m = useTheme();
    const lowBalance = walletBalance !== undefined && requiredAmount !== undefined && walletBalance < requiredAmount;

    const options: { id: PaymentMethod; label: string; sub: string; icon?: any; image?: any; disabled?: boolean }[] = [
        { id: 'cash', label: 'Cash', sub: 'Pay the driver', icon: 'cash-outline' },
        {
            id: 'wallet', label: 'G-Coin', image: G_COIN_LOGO,
            sub: walletBalance !== undefined ? `Balance $${walletBalance.toFixed(2)}` : 'Your wallet',
            disabled: lowBalance,
        },
    ];

    return (
        <View>
            <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.md }}>PAY WITH</Txt>
            <View style={{ flexDirection: 'row', gap: SPACE.md }}>
                {options.map((opt) => {
                    const on = selected === opt.id;
                    return (
                        <Pressable
                            key={opt.id}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on, disabled: !!opt.disabled }}
                            accessibilityLabel={`${opt.label}, ${opt.sub}`}
                            onPress={() => {
                                if (opt.disabled) { toast('Your G-Coin balance is too low for this ride. Top up in Wallet.', 'error'); return; }
                                onSelect(opt.id);
                            }}
                            style={({ pressed }) => ({
                                flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 60, padding: SPACE.md,
                                borderRadius: RADIUS.field, borderWidth: 2, borderBottomWidth: 4,
                                borderColor: on ? '#8B7CFF' : (m.key === 'day' ? '#E7E1F0' : 'rgba(255,255,255,0.10)'),
                                backgroundColor: on ? (m.key === 'day' ? 'rgba(122,92,255,0.08)' : 'rgba(185,174,255,0.12)') : m.chip,
                                opacity: opt.disabled ? 0.5 : pressed ? 0.85 : 1,
                            })}
                        >
                            {opt.image
                                ? <Image source={opt.image} style={{ width: 24, height: 24 }} resizeMode="contain" />
                                : <Ionicons name={opt.icon} size={22} color={on ? m.accent : m.ink} />}
                            <View style={{ marginLeft: SPACE.sm, flex: 1 }}>
                                <Txt variant="bodyStrong">{opt.label}</Txt>
                                <Txt variant="caption" tone="dim" numberOfLines={1}>{opt.sub}</Txt>
                            </View>
                            {on ? <Ionicons name="checkmark-circle" size={18} color={m.accent} /> : null}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
