import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Animated, Easing } from 'react-native';
import { theme } from '../theme';

interface RideProgressBarProps {
    phase: 'arriving' | 'arrived' | 'in_progress';
}

export function RideProgressBar({ phase }: RideProgressBarProps) {
    const progressAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        let toValue = 0;

        switch (phase) {
            case 'arriving':
                toValue = 0.25; // 25% across
                break;
            case 'arrived':
                toValue = 0.5; // 50% across (At Pickup)
                break;
            case 'in_progress':
                toValue = 1; // 100% across (At Dropoff)
                break;
        }

        Animated.timing(progressAnim, {
            toValue,
            duration: 2000, // Smooth 2s transition
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false, // width/left layout properties need false
        }).start();
    }, [phase]);

    // Interpolate values for the car position
    const leftPosition = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '95%'] // Prevent overshooting container
    });

    const barWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%']
    });

    return (
        <View style={styles.container}>
            {/* Step Labels */}
            <View style={styles.labelsContainer}>
                <View style={styles.labelCol}>
                    <View style={[styles.dot, styles.dotActive]} />
                    <Text style={[styles.labelText, styles.labelActive]}>Pickup</Text>
                </View>
                <View style={[styles.labelCol, { alignItems: 'flex-end' }]}>
                    <View style={[styles.dot, phase === 'in_progress' ? styles.dotActive : null]} />
                    <Text style={[styles.labelText, phase === 'in_progress' ? styles.labelActive : null]}>Drop-off</Text>
                </View>
            </View>

            {/* Track Line */}
            <View style={styles.track}>
                {/* Active Progress Line */}
                <Animated.View style={[styles.fill, { width: barWidth }]} />

                {/* Moving Car */}
                <Animated.View style={[styles.carWrapper, { left: leftPosition }]}>
                    <View style={styles.carIcon}>
                        <Text style={styles.emoji}>🚕</Text>
                    </View>
                    <View style={styles.glow} />
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingHorizontal: theme.spacing.md,
        marginVertical: theme.spacing.lg,
    },
    labelsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.sm,
    },
    labelCol: {
        alignItems: 'flex-start',
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.glass.border,
        marginBottom: 4,
    },
    dotActive: {
        backgroundColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    labelText: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.medium,
    },
    labelActive: {
        color: theme.colors.text.primary,
        fontWeight: theme.typography.weights.bold,
    },
    track: {
        height: 4,
        backgroundColor: theme.colors.glass.backgroundLight,
        borderRadius: 2,
        position: 'relative',
        justifyContent: 'center',
    },
    fill: {
        height: '100%',
        backgroundColor: theme.colors.brand.primary,
        borderRadius: 2,
    },
    carWrapper: {
        position: 'absolute',
        top: -14, // Center vertically relative to track
        marginLeft: -15, // Center horizontally on the point
        width: 30,
        height: 30,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    carIcon: {
        transform: [{ scaleX: -1 }], // Flip car if needed to face right
    },
    emoji: {
        fontSize: 20,
    },
    glow: {
        position: 'absolute',
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.colors.brand.primary,
        opacity: 0.3,
        zIndex: -1,
        transform: [{ scale: 1.5 }],
    }
});
