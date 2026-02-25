// Premium 3D Button Component - EXACTLY matches the "Confirm Ride" button from mockup
// Features: Liquid glass texture, 3D depth with teal/purple gradient, inner reflections

import React, { useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Animated,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
    Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

interface PremiumButtonProps {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'glass';
    loading?: boolean;
    disabled?: boolean;
    style?: ViewStyle;
    textStyle?: TextStyle;
    icon?: React.ReactNode;
}

export function PremiumButton({
    title,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    style,
    textStyle,
    icon,
}: PremiumButtonProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.96,
            useNativeDriver: true,
            friction: 8,
        }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 8,
        }).start();
    };

    if (variant === 'primary') {
        // THE MAIN 3D LIQUID GLASS BUTTON (like "Confirm Ride" in mockup)
        return (
            <TouchableOpacity
                onPress={onPress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={disabled || loading}
                activeOpacity={1}
            >
                <Animated.View
                    style={[
                        styles.primaryContainer,
                        disabled && styles.disabled,
                        { transform: [{ scale: scaleAnim }] },
                        style,
                    ]}
                >
                    {/* Outer glow shadow */}
                    <View style={styles.outerGlow} />

                    {/* Main button body - dark with teal gradient edges */}
                    <View style={styles.primaryBody}>
                        {/* Teal left edge glow */}
                        <View style={styles.tealLeftEdge} />

                        {/* Purple right edge glow */}
                        <View style={styles.purpleRightEdge} />

                        {/* Top highlight (3D effect) */}
                        <View style={styles.topHighlight} />

                        {/* Inner liquid reflection (the wavy texture) */}
                        <View style={styles.liquidTexture}>
                            <View style={styles.liquidWave1} />
                            <View style={styles.liquidWave2} />
                            <View style={styles.liquidWave3} />
                        </View>

                        {/* Content */}
                        <View style={styles.content}>
                            {loading ? (
                                <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                                <>
                                    {icon && <View style={styles.iconContainer}>{icon}</View>}
                                    <Text style={[styles.primaryText, textStyle]}>{title}</Text>
                                </>
                            )}
                        </View>

                        {/* Bottom shadow (3D depth) */}
                        <View style={styles.bottomDepth} />
                    </View>
                </Animated.View>
            </TouchableOpacity>
        );
    }

    if (variant === 'secondary') {
        // Glass outline button (like "View Receipt" in mockup)
        return (
            <TouchableOpacity
                onPress={onPress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={disabled || loading}
                activeOpacity={1}
            >
                <Animated.View
                    style={[
                        styles.secondaryContainer,
                        disabled && styles.disabled,
                        { transform: [{ scale: scaleAnim }] },
                        style,
                    ]}
                >
                    <View style={styles.secondaryInner}>
                        <Text style={[styles.secondaryText, textStyle]}>{title}</Text>
                    </View>
                </Animated.View>
            </TouchableOpacity>
        );
    }

    // Glass variant (like "Rate Driver" button with purple glow)
    return (
        <TouchableOpacity
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={disabled || loading}
            activeOpacity={1}
        >
            <Animated.View
                style={[
                    styles.glassContainer,
                    disabled && styles.disabled,
                    { transform: [{ scale: scaleAnim }] },
                    style,
                ]}
            >
                <View style={styles.glassInner}>
                    <Text style={[styles.glassText, textStyle]}>{title}</Text>
                </View>
                <View style={styles.glassBottomGlow} />
            </Animated.View>
        </TouchableOpacity>
    );
}

// 3D Action Button (like the call/message buttons in mockup - glass orbs)
interface ActionButtonProps {
    icon: string;
    onPress: () => void;
    color?: 'purple' | 'teal';
}

export function ActionButton({ icon, onPress, color = 'purple' }: ActionButtonProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.9,
            useNativeDriver: true,
            friction: 6,
        }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
        }).start();
    };

    const glowColor = color === 'purple' ? '#A855F7' : '#00FFD1';

    return (
        <TouchableOpacity
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={1}
        >
            <Animated.View
                style={[
                    styles.actionOrbContainer,
                    { transform: [{ scale: scaleAnim }] },
                ]}
            >
                {/* Glass orb body */}
                <View style={[styles.actionOrb, { shadowColor: glowColor }]}>
                    {/* Top shine */}
                    <View style={styles.orbShine} />

                    {/* Icon */}
                    <Text style={styles.actionIcon}>{icon}</Text>

                    {/* Inner glow */}
                    <View style={[styles.orbInnerGlow, { backgroundColor: glowColor }]} />
                </View>
            </Animated.View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    // PRIMARY BUTTON (Confirm Ride style)
    primaryContainer: {
        width: '100%',
        position: 'relative',
    },
    outerGlow: {
        position: 'absolute',
        top: -4,
        left: -4,
        right: -4,
        bottom: -4,
        borderRadius: 20,
        backgroundColor: 'transparent',
        shadowColor: '#00FFD1',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
    },
    primaryBody: {
        backgroundColor: '#1C2A35',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(0, 255, 209, 0.3)',
        overflow: 'hidden',
        position: 'relative',
    },
    tealLeftEdge: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: '#00FFD1',
        opacity: 0.6,
    },
    purpleRightEdge: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: '#A855F7',
        opacity: 0.6,
    },
    topHighlight: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    liquidTexture: {
        position: 'absolute',
        bottom: 8,
        left: '15%',
        right: '15%',
        height: 12,
        overflow: 'hidden',
    },
    liquidWave1: {
        position: 'absolute',
        left: '10%',
        bottom: 0,
        width: '25%',
        height: 6,
        backgroundColor: 'rgba(0, 255, 209, 0.25)',
        borderRadius: 10,
    },
    liquidWave2: {
        position: 'absolute',
        left: '40%',
        bottom: 2,
        width: '30%',
        height: 8,
        backgroundColor: 'rgba(0, 255, 209, 0.35)',
        borderRadius: 10,
    },
    liquidWave3: {
        position: 'absolute',
        left: '70%',
        bottom: 0,
        width: '20%',
        height: 5,
        backgroundColor: 'rgba(168, 85, 247, 0.25)',
        borderRadius: 10,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 24,
    },
    iconContainer: {
        marginRight: 8,
    },
    primaryText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    bottomDepth: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    disabled: {
        opacity: 0.5,
    },

    // SECONDARY BUTTON (glass outline)
    secondaryContainer: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    secondaryInner: {
        paddingVertical: 16,
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    secondaryText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '500',
    },

    // GLASS BUTTON (Rate Driver style with purple glow)
    glassContainer: {
        borderRadius: 16,
        overflow: 'hidden',
        position: 'relative',
    },
    glassInner: {
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        borderWidth: 1,
        borderColor: 'rgba(168, 85, 247, 0.4)',
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    glassText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    glassBottomGlow: {
        position: 'absolute',
        bottom: -2,
        left: '20%',
        right: '20%',
        height: 4,
        backgroundColor: '#A855F7',
        opacity: 0.5,
        borderRadius: 2,
    },

    // ACTION ORB BUTTONS (call/message)
    actionOrbContainer: {
        width: 52,
        height: 52,
    },
    actionOrb: {
        width: '100%',
        height: '100%',
        borderRadius: 26,
        backgroundColor: 'rgba(168, 85, 247, 0.25)',
        borderWidth: 1,
        borderColor: 'rgba(168, 85, 247, 0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
    },
    orbShine: {
        position: 'absolute',
        top: 4,
        left: '20%',
        right: '20%',
        height: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderRadius: 4,
    },
    actionIcon: {
        fontSize: 22,
    },
    orbInnerGlow: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '50%',
        opacity: 0.15,
    },
});
