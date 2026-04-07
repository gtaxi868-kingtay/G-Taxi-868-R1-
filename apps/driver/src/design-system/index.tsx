import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BRAND, VOICES, RADIUS, GRADIENTS, SEMANTIC } from '../../../../shared/design-system/theme';

export { BRAND, VOICES, RADIUS, GRADIENTS, SEMANTIC };

/**
 * GlassCard: The signature G-Taxi "Glass Over Depth" container.
 * Enforces consistency for all app-specific sheets and cards.
 */
export const GlassCard = ({ children, style, variant = 'driver' }: { children: React.ReactNode, style?: ViewStyle, variant?: 'rider' | 'driver' | 'admin' }) => {
    const voice = VOICES[variant];
    return (
        <View style={[s.glassBase, { backgroundColor: variant === 'driver' ? 'rgba(26, 21, 48, 0.8)' : voice.surface }, style]}>
            <BlurView intensity={Platform.OS === 'ios' ? 80 : 100} tint={variant === 'driver' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            {children}
        </View>
    );
};

/**
 * InfoChip: Data HUD element for Pattern B (Active state).
 */
export const InfoChip = ({ label, value, icon, color = BRAND.cyan }: { label: string, value: string, icon?: string, color?: string }) => (
    <View style={s.chip}>
        {icon && <Ionicons name={icon as any} size={14} color={color} style={{ marginBottom: 4 }} />}
        <Text style={[s.chipLabel, { color: VOICES.driver.textMuted }]}>{label.toUpperCase()}</Text>
        <Text style={[s.chipValue, { color: BRAND.cyan }]}>{value}</Text>
    </View>
);

/**
 * StatusBadge: Pattern C Hub status indicator.
 */
export const StatusBadge = ({ status, label }: { status: 'searching' | 'assigned' | 'live' | 'admin', label?: string }) => {
    const config = {
        searching: { bg: 'rgba(0, 255, 255, 0.1)', color: BRAND.cyan, icon: 'search' },
        assigned: { bg: 'rgba(245, 158, 11, 0.1)', color: SEMANTIC.warning, icon: 'car' },
        live: { bg: 'rgba(16, 185, 129, 0.1)', color: SEMANTIC.success, icon: 'checkmark-circle' },
        admin: { bg: 'rgba(99, 102, 241, 0.1)', color: SEMANTIC.info, icon: 'shield' },
    }[status];

    return (
        <View style={[s.badge, { backgroundColor: config.bg }]}>
            <Ionicons name={config.icon as any} size={12} color={config.color} />
            <Text style={[s.badgeText, { color: config.color }]}>
                {label || status.toUpperCase()}
            </Text>
        </View>
    );
};

const s = StyleSheet.create({
    glassBase: {
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    chip: {
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    chipLabel: {
        fontSize: 10,
        fontWeight: '300',
        letterSpacing: 1,
    },
    chipValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: RADIUS.pill,
        alignSelf: 'flex-start',
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '800',
        marginLeft: 6,
        letterSpacing: 1,
    },
});

import { Platform } from 'react-native';
