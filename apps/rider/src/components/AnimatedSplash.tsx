import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Txt, useTheme } from '../ui/kit';

// Shown while the app checks whether you are signed in. Calm, on-brand,
// follows day/night; the logo breathes gently.
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
    const m = useTheme();
    const fade = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.96)).current;

    useEffect(() => {
        Animated.timing(fade, { toValue: 1, duration: 500, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }).start();
        const breathe = Animated.loop(Animated.sequence([
            Animated.timing(scale, { toValue: 1.03, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(scale, { toValue: 0.98, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]));
        breathe.start();
        return () => breathe.stop();
    }, []);

    return (
        <View style={{ flex: 1, backgroundColor: m.page, alignItems: 'center', justifyContent: 'center' }}>
            <StatusBar style={m.statusBar} />
            <Animated.View style={{ alignItems: 'center', opacity: fade, transform: [{ scale }] }}>
                <Image source={require('../../assets/logo.png')} style={{ width: 96, height: 96 }} resizeMode="contain" />
                <Txt variant="hero" style={{ marginTop: 20 }}>G 868</Txt>
            </Animated.View>
        </View>
    );
}
