import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Animated, Dimensions, Easing } from 'react-native';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');

// Number of drops to render
const DROP_COUNT = 40;

const RainDrop = () => {
    // Randomize properties for "natural" feel
    const startX = Math.random() * width;
    const duration = 1500 + Math.random() * 2000; // 1.5s - 3.5s fall time
    const delay = Math.random() * 2000;
    const scale = 0.5 + Math.random() * 0.5; // Size variation

    const translateY = useMemo(() => new Animated.Value(-100), []);

    useEffect(() => {
        const animate = () => {
            translateY.setValue(-100);
            Animated.sequence([
                Animated.delay(delay),
                Animated.timing(translateY, {
                    toValue: height + 100,
                    duration: duration,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            ]).start(() => {
                // Determine next delay randomly for irregularity
                animate();
            });
        };

        animate();
    }, []);

    return (
        <Animated.View
            style={[
                styles.drop,
                {
                    left: startX,
                    transform: [{ translateY }, { scaleY: scale }],
                    opacity: 0.3 + Math.random() * 0.4, // Varying opacity
                }
            ]}
        />
    );
};

export const RainBackground = () => {
    // Memoize the array of drops so they don't re-render unnecessarily
    const drops = useMemo(() => Array.from({ length: DROP_COUNT }).map((_, i) => i), []);

    return (
        <View style={styles.container} pointerEvents="none">
            {/* Base "Frosted" Background Layer */}
            <View style={styles.fogLayer} />

            {/* Rain Drops */}
            {drops.map((i) => (
                <RainDrop key={i} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.background.primary, // Dark base
        overflow: 'hidden',
    },
    fogLayer: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(20, 30, 48, 0.8)', // Deep blue-grey fog
    },
    drop: {
        position: 'absolute',
        top: 0,
        width: 2,
        height: 40, // Long streak for "rain running down"
        borderRadius: 2,
        backgroundColor: 'rgba(120, 200, 255, 0.4)', // Icy blueish white
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 2,
    },
});
