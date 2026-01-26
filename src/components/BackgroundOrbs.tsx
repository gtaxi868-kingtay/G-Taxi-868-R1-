import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');

export const BackgroundOrbs = () => {
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: 1,
                    duration: 4000,
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 4000,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 20],
    });

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View
                style={[
                    styles.orb,
                    styles.orbTop,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />
            <Animated.View
                style={[
                    styles.orb,
                    styles.orbBottom,
                    { transform: [{ translateY: Animated.multiply(floatTranslate, -1) }] }
                ]}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    orb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTop: {
        width: width * 1.2,
        height: width * 1.2,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -width * 0.4,
        right: -width * 0.3,
        opacity: 0.5,
    },
    orbBottom: {
        width: width,
        height: width,
        backgroundColor: theme.colors.accent.purple,
        bottom: -width * 0.2,
        left: -width * 0.3,
        opacity: 0.15,
    },
});
