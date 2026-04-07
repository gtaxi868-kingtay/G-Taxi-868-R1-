import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND, RADIUS, SEMANTIC, GRADIENTS, VOICES } from './theme';
import { Ionicons } from '@expo/vector-icons';

// ── Components ───────────────────────────────────────────────────────────────

/**
 * 0. Logo
 * The G-Taxi DNA: Pin shape + Diagonal split + Circuit texture.
 */
export const Logo = ({ size = 48, variant = 'full' }: any) => {
    const isFull = variant === 'full';
    
    return (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <LinearGradient
                colors={GRADIENTS.primary}
                start={GRADIENTS.primaryStart}
                end={GRADIENTS.primaryEnd}
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderBottomRightRadius: size / 4, // Hint at pin shape
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ rotate: '45deg' }]
                }}
            >
                <View style={{ transform: [{ rotate: '-45deg' }] }}>
                    <Ionicons name="location" size={size * 0.6} color="#FFF" />
                </View>
            </LinearGradient>
            {isFull && (
                <Text style={{ 
                    fontSize: size * 0.4, 
                    fontWeight: '900', 
                    color: BRAND.purple, 
                    marginTop: 8,
                    letterSpacing: -1
                }}>
                    G-TAXI
                </Text>
            )}
        </View>
    );
};

/**
 * 1. GlassCard
 * The core 'Glass Over Depth' container.
 */
export const GlassCard = ({ children, style, variant = 'rider' }: any) => {
    const isDriver = variant === 'driver';
    return (
        <BlurView
            intensity={isDriver ? 40 : 20}
            tint={isDriver ? 'dark' : 'light'}
            style={[
                {
                    borderRadius: RADIUS.lg,
                    borderWidth: 1,
                    borderColor: isDriver ? 'rgba(0,255,255,0.12)' : 'rgba(124,58,237,0.12)',
                    overflow: 'hidden',
                    shadowColor: BRAND.purple,
                    shadowOpacity: 0.08,
                    shadowRadius: 16,
                    shadowOffset: { width: 0, height: 4 },
                },
                style,
            ]}
        >
            {children}
        </BlurView>
    );
};

/**
 * 2. PrimaryButton
 * Signature 135deg diagonal gradient full-pill button.
 */
export const PrimaryButton = ({ label, onPress, loading, disabled, style }: any) => (
    <TouchableOpacity
        onPress={onPress}
        disabled={loading || disabled}
        activeOpacity={0.88}
        style={[{ borderRadius: RADIUS.pill, overflow: 'hidden' }, style]}
    >
        <LinearGradient
            colors={GRADIENTS.primary}
            start={GRADIENTS.primaryStart}
            end={GRADIENTS.primaryEnd}
            style={{
                paddingVertical: 17,
                paddingHorizontal: 28,
                alignItems: 'center',
                borderRadius: RADIUS.pill,
            }}
        >
            {loading ? (
                <ActivityIndicator color="#FFFFFF" />
            ) : (
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>
                    {label}
                </Text>
            )}
        </LinearGradient>
    </TouchableOpacity>
);

/**
 * 3. InfoChip
 * Data pills for stats/metrics.
 */
export const InfoChip = ({ label, value, accent, variant = 'rider' }: any) => {
    const isDriver = variant === 'driver';
    const accentColor = accent || (isDriver ? BRAND.cyan : BRAND.purple);
    
    return (
        <View style={{
            backgroundColor: isDriver ? 'rgba(0,255,255,0.08)' : 'rgba(124,58,237,0.08)',
            borderRadius: RADIUS.sm,
            paddingVertical: 8,
            paddingHorizontal: 14,
            alignItems: 'center',
            minWidth: 70,
        }}>
            <Text style={{
                fontSize: 16,
                fontWeight: '800', // Weight Contrast Rule: Value = Heavy
                color: accentColor
            }}>
                {value}
            </Text>
            <Text style={{
                fontSize: 10,
                fontWeight: '300', // Weight Contrast Rule: Label = Thin
                color: isDriver ? 'rgba(255,255,255,0.45)' : 'rgba(30,30,63,0.55)',
                letterSpacing: 0.8,
                marginTop: 2
            }}>
                {label.toUpperCase()}
            </Text>
        </View>
    );
};

/**
 * 4. StatusBadge
 * Semantic state indicator.
 */
const badgeColors: any = {
    online: { bg: 'rgba(16,185,129,0.12)', text: '#059669', dot: '#10B981' },
    offline: { bg: 'rgba(107,114,128,0.12)', text: '#6B7280', dot: '#9CA3AF' },
    searching: { bg: 'rgba(245,158,11,0.12)', text: '#D97706', dot: '#F59E0B' },
    assigned: { bg: 'rgba(124,58,237,0.12)', text: '#7C3AED', dot: '#A78BFA' },
    live: { bg: 'rgba(0,255,255,0.08)', text: '#0891B2', dot: '#00FFFF' },
    sos: { bg: 'rgba(239,68,68,0.12)', text: '#DC2626', dot: '#EF4444' },
};

export const StatusBadge = ({ status, label }: any) => {
    const c = badgeColors[status] || badgeColors.offline;
    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: c.bg,
            borderRadius: 20,
            paddingVertical: 6,
            paddingHorizontal: 12
        }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.dot }} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: c.text, letterSpacing: 0.3 }}>{label}</Text>
        </View>
    );
};
