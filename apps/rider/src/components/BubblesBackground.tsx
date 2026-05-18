import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions, Animated, Easing } from 'react-native';

interface BubbleProps {
    delay: number;
    duration: number;
    size: number;
    left: number;
    screenHeight: number;
}

const Bubble = ({ delay, duration, size, left, screenHeight }: BubbleProps) => {
    const translateY = useRef(new Animated.Value(screenHeight)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.delay(delay),
                Animated.parallel([
                    Animated.timing(translateY, {
                        toValue: -size,
                        duration: duration,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    }),
                    Animated.sequence([
                        Animated.timing(opacity, {
                            toValue: 0.6,
                            duration: duration * 0.2,
                            useNativeDriver: true,
                        }),
                        Animated.timing(opacity, {
                            toValue: 0,
                            duration: duration * 0.8,
                            useNativeDriver: true,
                        }),
                    ]),
                ]),
            ])
        );

        animation.start();

        return () => animation.stop();
    }, []);

    return (
        <Animated.View
            style={[
                styles.bubble,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    left: `${left}%`,
                    opacity: opacity,
                    transform: [{ translateY }],
                },
            ]}
        />
    );
};

export const BubblesBackground = () => {
    const { height } = useWindowDimensions();
    // Generate 15-20 semi-random bubbles
    const bubbles = Array.from({ length: 18 }).map((_, i) => ({
        id: i,
        delay: Math.random() * 5000,
        duration: 3000 + Math.random() * 4000,
        size: 10 + Math.random() * 40,
        left: Math.random() * 100,
    }));

    return (
        <View style={StyleSheet.absoluteFill}>
            {bubbles.map((b) => (
                <Bubble key={b.id} {...b} screenHeight={height} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    bubble: {
        position: 'absolute',
        backgroundColor: 'rgba(0, 255, 255, 0.4)', // Cyan-ish theme color
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
});
