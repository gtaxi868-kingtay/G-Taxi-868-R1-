// @ts-nocheck
// @ts-ignore - shared module, types resolved per app
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Animated, Platform } from 'react-native';
// @ts-ignore
import { BlurView } from 'expo-blur';
// @ts-ignore
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND, RADIUS, SEMANTIC, GRADIENTS, VOICES } from './theme';
// @ts-ignore
import { Ionicons } from '@expo/vector-icons';

// ── Components ───────────────────────────────────────────────────────────────

/**
 * 0. Logo
 * The G-Taxi DNA: 3D-styled Glass Pin with Purple/Cyan Pulse.
 */
export const Logo = ({ size = 48, variant = 'full' }: any) => {
    const isFull = variant === 'full';
    
    return (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: size, height: size * 1.25, justifyContent: 'center', alignItems: 'center' }}>
                {/* 3D Pin Shadow */}
                <View style={{
                    position: 'absolute',
                    bottom: 0,
                    width: size * 0.4,
                    height: size * 0.1,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    borderRadius: 10,
                    transform: [{ scaleX: 2 }]
                }} />
                
                {/* The Pin Body (Split Gradient) */}
                <View style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderBottomRightRadius: size / 10,
                    overflow: 'hidden',
                    transform: [{ rotate: '-45deg' }],
                    shadowColor: BRAND.purple,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                }}>
                    <LinearGradient
                        colors={[BRAND.purple, BRAND.cyan]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                    {/* Glass Shine */}
                    <LinearGradient
                        colors={['rgba(255,255,255,0.4)', 'transparent']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0.5, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                </View>

                {/* The "G" Initial */}
                <View style={{ position: 'absolute', top: size * 0.15 }}>
                    <Text style={{ 
                        fontSize: size * 0.6, 
                        fontWeight: '900', 
                        color: '#FFF',
                        textShadowColor: 'rgba(0,0,0,0.3)',
                        textShadowOffset: { width: 1, height: 1 },
                        textShadowRadius: 4
                    }}>G</Text>
                </View>
            </View>

            {isFull && (
                <View style={{ marginTop: 8 }}>
                    <Text style={{ 
                        fontSize: size * 0.35, 
                        fontWeight: '900', 
                        color: '#FFF',
                        letterSpacing: 2,
                        textAlign: 'center'
                    }}>G-TAXI</Text>
                    <Text style={{ 
                        fontSize: size * 0.15, 
                        fontWeight: '800', 
                        color: BRAND.cyan,
                        letterSpacing: 4,
                        textAlign: 'center',
                        marginTop: -2
                    }}>EMPIRE</Text>
                </View>
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

/**
 * 5. LoadingOverlay
 * Full-screen premium glass loader.
 */
export const LoadingOverlay = ({ message = 'PROCESSING...', color = BRAND.purple }: any) => (
    <View style={[StyleSheet.absoluteFill, { 
        backgroundColor: 'rgba(0,0,0,0.4)', 
        justifyContent: 'center', 
        alignItems: 'center',
        zIndex: 999 
    }]}>
        <BlurView intensity={20} tint="dark" style={{ 
            padding: 40, 
            borderRadius: RADIUS.lg, 
            alignItems: 'center',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)'
        }}>
            <ActivityIndicator size="large" color={color} />
            <Text style={{ 
                marginTop: 20, 
                color: '#FFF', 
                fontSize: 12, 
                fontWeight: '900', 
                letterSpacing: 2,
                textAlign: 'center'
            }}>
                {message.toUpperCase()}
            </Text>
        </BlurView>
    </View>
);
