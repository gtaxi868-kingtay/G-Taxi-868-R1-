import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
    useSharedValue, withTiming, withRepeat,
    useAnimatedStyle, Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { Txt } from '../design-system/primitives';

const { width } = Dimensions.get('window');

// ── Driver-only tokens ────────────────────────────────────────────────────────
const C = {
    bg: '#07050F',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    red: '#EF4444',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.45)',
};

export function PendingApprovalScreen() {
    const { signOut } = useAuth();
    const insets = useSafeAreaInsets();

    const rotation = useSharedValue(0);

    useEffect(() => {
        rotation.value = withRepeat(
            withTiming(360, { duration: 4000, easing: Easing.linear }),
            -1, false
        );
    }, []);

    const rotationStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));

    const handleSignOut = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign Out',
                style: 'destructive',
                onPress: async () => { await signOut(); }
            }
        ]);
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            {/* LinearGradient bg: #1A0D40→#07050F */}
            <LinearGradient colors={['#1A0D40', '#07050F']} style={StyleSheet.absoluteFill} />

            <View style={s.content}>

                {/* Hourglass icon: Ionicons "hourglass-outline" size=64 purpleLight */}
                {/* Reanimated: icon slowly rotates 0→360 over 4s, withRepeat -1 */}
                <Reanimated.View style={rotationStyle}>
                    <Ionicons name="hourglass-outline" size={64} color={C.purpleLight} />
                </Reanimated.View>

                {/* "Application Under Review" — bold 28px white, centered, marginTop 32 */}
                <Txt variant="headingL" weight="bold" color={C.white} style={s.title}>
                    Application Under Review
                </Txt>

                {/* Body text — muted, centered, paddingHorizontal 48 */}
                <Txt variant="bodyReg" color={C.muted} style={s.description}>
                    Your profile has been submitted. You will be notified once approved.
                </Txt>

            </View>

            {/* Sign Out button — bottom, red ghost style */}
            <View style={[s.footer, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity style={s.logoutBtn} onPress={handleSignOut}>
                    <Txt variant="bodyBold" color={C.red}>Sign Out</Txt>
                </TouchableOpacity>
            </View>

        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    title: { textAlign: 'center', marginTop: 32, fontSize: 28 },
    description: { textAlign: 'center', marginTop: 16, paddingHorizontal: 48, lineHeight: 24 },
    footer: { paddingHorizontal: 40 },
    logoutBtn: {
        height: 54,
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.2)',
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(239,68,68,0.05)'
    },
});
