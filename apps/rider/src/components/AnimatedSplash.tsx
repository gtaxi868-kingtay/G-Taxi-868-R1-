import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, Image, Animated, Easing, Platform } from 'react-native';
import { tokens } from '../design-system/tokens';
import { Txt } from '../design-system/primitives';
import { BubblesBackground } from './BubblesBackground';

const { width } = Dimensions.get('window');

// Duration for animations
const PULSE_DURATION = 2000;
const TAGLINE_DURATION = 1500;

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
    // Standard React Native Animated
    const logoScale = useRef(new Animated.Value(0.8)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const taglineProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // 1. Entrance Animation
        Animated.parallel([
            Animated.spring(logoScale, {
                toValue: 1,
                friction: 8,
                tension: 40,
                useNativeDriver: true,
            }),
            Animated.timing(logoOpacity, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            })
        ]).start();

        // 2. Pulse Animation (Looped)
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(logoScale, {
                    toValue: 1.05,
                    duration: PULSE_DURATION / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(logoScale, {
                    toValue: 1,
                    duration: PULSE_DURATION / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        pulse.start();

        // 3. Tagline Animation (Looped)
        const startTagline = () => {
            taglineProgress.setValue(0);
            Animated.timing(taglineProgress, {
                toValue: 1,
                duration: TAGLINE_DURATION,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: false,
            }).start(() => {
                setTimeout(startTagline, 500);
            });
        };
        startTagline();

        return () => {
            pulse.stop();
        };
    }, []);

    const animatedWidth = taglineProgress.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    return (
        <View style={styles.container}>
            {/* 1. Natural Rising Bubbles - Premium Cyan theme */}
            <BubblesBackground />

            {/* 2. Pulsing Logo - Large centered focal point */}
            <Animated.View style={[
                styles.logoContainer,
                {
                    opacity: logoOpacity,
                    transform: [{ scale: logoScale }]
                }
            ]}>
                <Image
                    source={require('../../assets/logo.png')}
                    style={styles.logo}
                    resizeMode="contain"
                />
            </Animated.View>

            {/* 3. Sliding Tagline - Branding at the bottom */}
            <View style={styles.contentContainer}>
                <View style={styles.taglineContainer}>
                    <Txt
                        variant="headingM"
                        style={[styles.taglineText, { color: tokens.colors.primary.purple }]}
                    >
                        PREMIUM RIDE APP
                    </Txt>
                    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
                        <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden', width: animatedWidth }]}>
                            <View style={{ flexDirection: 'row', width: 400 }}>
                                <Txt
                                    variant="headingM"
                                    style={[styles.taglineText, { color: tokens.colors.primary.cyan }]}
                                >
                                    PREMIUM RIDE APP
                                </Txt>
                            </View>
                        </Animated.View>
                    </View>
                </View>
            </View>
        </View>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoContainer: {
        width: 180,
        height: 180,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 20,
    },
    logo: {
        width: '100%',
        height: '100%',
    },
    contentContainer: {
        position: 'absolute',
        bottom: 100,
        width: '100%',
        alignItems: 'center',
        zIndex: 30,
    },
    taglineContainer: {
        position: 'relative',
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        width: 300,
    },
    taglineText: {
        textAlign: 'center',
        fontWeight: '700',
        letterSpacing: 4,
        width: 300,
    }
});

