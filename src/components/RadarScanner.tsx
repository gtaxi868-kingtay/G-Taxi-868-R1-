import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '../theme';

export function RadarScanner() {
    const rotateAnim = useRef(new Animated.Value(0)).current;

    // Create multiple pulse animations for concentric circles
    const pulse1 = useRef(new Animated.Value(0)).current;
    const pulse2 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Rotation (Scanner Beam)
        Animated.loop(
            Animated.timing(rotateAnim, {
                toValue: 1,
                duration: 2000,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        ).start();

        // Pulse 1
        Animated.loop(
            Animated.timing(pulse1, {
                toValue: 1,
                duration: 2500,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
            })
        ).start();

        // Pulse 2 (Delayed)
        setTimeout(() => {
            Animated.loop(
                Animated.timing(pulse2, {
                    toValue: 1,
                    duration: 2500,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                })
            ).start();
        }, 1250);

    }, []);

    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <View style={styles.container}>
            {/* Concentric Circles */}
            <View style={styles.circle} />
            <View style={[styles.circle, styles.circleMd]} />
            <View style={[styles.circle, styles.circleLg]} />

            {/* Pulsing Waves */}
            <Animated.View
                style={[
                    styles.pulse,
                    {
                        transform: [{ scale: pulse1.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] }) }],
                        opacity: pulse1.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] })
                    }
                ]}
            />
            <Animated.View
                style={[
                    styles.pulse,
                    {
                        transform: [{ scale: pulse2.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] }) }],
                        opacity: pulse2.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] })
                    }
                ]}
            />

            {/* Rotating Scanner */}
            <Animated.View style={[styles.scanner, { transform: [{ rotate: spin }] }]}>
                <View style={styles.beam} />
            </Animated.View>

            {/* Center Icon */}
            <View style={styles.centerDoc} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    circle: {
        position: 'absolute',
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.3)', // Cyan
    },
    circleMd: {
        width: 120,
        height: 120,
        borderRadius: 60,
    },
    circleLg: {
        width: 180,
        height: 180,
        borderRadius: 90,
    },
    pulse: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: theme.colors.brand.primary,
    },
    scanner: {
        position: 'absolute',
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    beam: {
        position: 'absolute',
        top: 0,
        left: 100, // Center horizontally
        width: 100, // Half width
        height: 100, // Half height
        borderTopLeftRadius: 100,
        backgroundColor: 'rgba(56, 189, 248, 0.1)', // Faint cyan
        transform: [{ rotate: '-45deg' }, { skewY: '0deg' }], // Create a wedge sector
        borderLeftWidth: 2,
        borderLeftColor: 'rgba(56, 189, 248, 0.8)', // Leading edge
    },
    centerDoc: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    }
});
