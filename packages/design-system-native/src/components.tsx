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
 * The G-Taxi DNA: 3D-styled Glass Pin with Cyan Pulse.
 */
export const Logo = ({ size = 48, variant = 'full' }: any) => {
    const isFull = variant === 'full';
    
    return (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: size, height: size * 1.25, justifyContent: 'center', alignItems: 'center' }}>
                <View style={{
                    position: 'absolute',
                    bottom: 0,
                    width: size * 0.4,
                    height: size * 0.1,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    borderRadius: 10,
                    transform: [{ scaleX: 2 }]
                }} />
                
                <View style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderBottomRightRadius: size / 10,
                    overflow: 'hidden',
                    transform: [{ rotate: '-45deg' }],
                    shadowColor: '#00FFFF',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                }}>
                    <LinearGradient
                        colors={['#00FFFF', '#00FFFF']}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                    <LinearGradient
                        colors={['rgba(255,255,255,0.4)', 'transparent']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0.5, y: 0.5 }}
                        style={StyleSheet.absoluteFill}
                    />
                </View>

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
                        color: '#00FFFF',
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
            intensity={isDriver ? 20 : 20}
            tint="dark"
            style={[
                {
                    borderTopLeftRadius: RADIUS.lg,
                    borderTopRightRadius: RADIUS.lg,
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderWidth: 1,
                    borderColor: 'rgba(0,255,255,0.12)',
                    overflow: 'hidden',
                    shadowColor: '#00FFFF',
                    shadowOpacity: 0.08,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 8 },
                },
                style,
            ]}
        >
            {children}
        </BlurView>
    );
};

/**
 * 1b. LiquidGlass — Apple-style Liquid Glass surface (Expo 52 simulation).
 *
 * Apple's Liquid Glass principle: controls float ABOVE content as a distinct
 * translucent layer (Hierarchy). Three tiers express that hierarchy:
 *   chrome — floating nav bars / headers / FABs (most translucent + strongest sheen)
 *   panel  — cards, sheets, modals (the default)
 *   inlay  — quiet rows / input wells (least blur)
 *
 * Each app keeps its own voice via the accent (rider/driver cyan, merchant teal,
 * admin purple). The dark substrate guarantees text contrast (WCAG 4.5:1) over a
 * live map. Static specular = reduced-motion safe by default.
 *
 * Usage: <LiquidGlass tier="panel" voice="rider" style={{ padding: 16 }}>…</LiquidGlass>
 */
const GLASS_TIERS = {
    chrome: { intensity: 48, radius: 24, tint: 'rgba(11,14,18,0.44)', specular: 0.20, edge: 0.16, specularH: 80 },
    panel:  { intensity: 30, radius: 20, tint: 'rgba(11,14,18,0.55)', specular: 0.14, edge: 0.10, specularH: 64 },
    inlay:  { intensity: 14, radius: 14, tint: 'rgba(11,14,18,0.34)', specular: 0.08, edge: 0.08, specularH: 40 },
};
const GLASS_VOICE = {
    rider: '#1DE0E6',
    driver: '#8B5CF6',
    merchant: '#007070',
    admin: '#8B5CF6',
};

export const LiquidGlass = ({ children, style, tier = 'panel', voice = 'rider', accentEdge = false, ...rest }: any) => {
    const t = GLASS_TIERS[tier] || GLASS_TIERS.panel;
    const accent = GLASS_VOICE[voice] || GLASS_VOICE.rider;
    return (
        <BlurView
            intensity={t.intensity}
            tint="dark"
            style={[
                {
                    borderRadius: t.radius,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: accentEdge ? accent + '40' : `rgba(255,255,255,${t.edge})`,
                    shadowColor: accent,
                    shadowOpacity: 0.1,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 10 },
                },
                style,
            ]}
            {...rest}
        >
            {/* Translucent dark substrate — keeps text legible over the map (contrast guard). */}
            <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: t.tint }]} />
            {/* Specular highlight — top-edge light bend (the Liquid Glass sheen). */}
            <LinearGradient
                pointerEvents="none"
                colors={[`rgba(255,255,255,${t.specular})`, `rgba(255,255,255,${t.specular * 0.25})`, 'transparent']}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.45, y: 1 }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: t.specularH }}
            />
            {children}
        </BlurView>
    );
};

/**
 * 2. PrimaryButton
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
 */
export const InfoChip = ({ label, value, accent, variant = 'rider' }: any) => {
    const isDriver = variant === 'driver';
    const accentColor = accent || '#00FFFF';
    
    return (
        <View style={{
            backgroundColor: 'rgba(0,255,255,0.08)',
            borderRadius: RADIUS.sm,
            paddingVertical: 8,
            paddingHorizontal: 14,
            alignItems: 'center',
            minWidth: 70,
        }}>
            <Text style={{
                fontSize: 16,
                fontWeight: '800',
                color: accentColor
            }}>
                {value}
            </Text>
            <Text style={{
                fontSize: 10,
                fontWeight: '300',
                color: 'rgba(255,255,255,0.45)',
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
 */
const badgeColors: any = {
    online: { bg: 'rgba(16,185,129,0.12)', text: '#059669', dot: '#10B981' },
    offline: { bg: 'rgba(107,114,128,0.12)', text: '#6B7280', dot: '#9CA3AF' },
    searching: { bg: 'rgba(245,158,11,0.12)', text: '#D97706', dot: '#F59E0B' },
    assigned: { bg: 'rgba(0,255,255,0.12)', text: '#00FFFF', dot: '#00FFFF' },
    live: { bg: 'rgba(0,255,255,0.08)', text: '#00FFFF', dot: '#00FFFF' },
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
 */
export const LoadingOverlay = ({ message = 'PROCESSING...', color = '#00FFFF' }: any) => (
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

/**
 * 6. Skeleton
 * Shimmering placeholder for content loading.
 */
export const Skeleton = ({ width, height, borderRadius = 8, style }: any) => {
    const shimmerAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(shimmerAnim, {
                    toValue: 1,
                    duration: 1000,
                    easing: Animated.linear,
                    useNativeDriver: true,
                }),
                Animated.timing(shimmerAnim, {
                    toValue: 0,
                    duration: 1000,
                    easing: Animated.linear,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    const opacity = shimmerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.3, 0.7],
    });

    return (
        <Animated.View
            style={[
                {
                    width,
                    height,
                    borderRadius,
                    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                    opacity,
                },
                style,
            ]}
        />
    );
};
