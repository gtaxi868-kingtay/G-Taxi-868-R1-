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

import { GlassCard, BRAND, VOICES, SEMANTIC, RADIUS, GRADIENTS } from '../design-system';

const { width, height } = Dimensions.get('window');

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
        Alert.alert('Sign Out', 'Are you sure you want to log out?', [
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

            <LinearGradient colors={['#0A0718', '#0A0718']} style={StyleSheet.absoluteFill} />
            
            <LinearGradient
                colors={['rgba(0, 255, 194, 0.05)', 'transparent']}
                style={[StyleSheet.absoluteFill, { height: height * 0.4 }]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
            />

            <View style={s.content}>
                <Reanimated.View style={[s.iconBox, rotationStyle]}>
                    <Ionicons name="hourglass-outline" size={64} color={BRAND.cyan} />
                </Reanimated.View>

                <Txt variant="headingL" weight="heavy" color="#FFF" style={s.title}>
                    OPERATOR APPROVAL PENDING
                </Txt>

                <Txt variant="bodyReg" weight="heavy" color={VOICES.driver.textMuted} style={s.description}>
                    YOUR PROFILE IS UNDERGOING SYSTEM COMPLIANCE CHECKS. YOU WILL BE NOTIFIED VIA SECURE PUSH ONCE AUTHORIZED.
                </Txt>
                
                <View style={s.badge}>
                    <Txt variant="caption" weight="heavy" color={BRAND.cyan} style={{ letterSpacing: 2 }}>
                        TELEMETRY CONNECTED
                    </Txt>
                </View>
            </View>

            <View style={[s.footer, { paddingBottom: insets.bottom + 40 }]}>
                <TouchableOpacity style={s.logoutBtn} onPress={handleSignOut}>
                    <Ionicons name="log-out-outline" size={20} color={SEMANTIC.danger} style={{ marginRight: 8 }} />
                    <Txt variant="bodyBold" weight="heavy" color={SEMANTIC.danger}>TERMINATE SESSION</Txt>
                </TouchableOpacity>
            </View>

        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0718' },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
    iconBox: {
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(0, 255, 194, 0.03)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(0, 255, 194, 0.1)',
        shadowColor: BRAND.cyan, shadowRadius: 20, shadowOpacity: 0.1,
    },
    title: { textAlign: 'center', marginTop: 40, letterSpacing: -0.5 },
    description: { textAlign: 'center', marginTop: 20, lineHeight: 22, opacity: 0.8 },
    badge: { marginTop: 32, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(0, 255, 194, 0.05)', borderWidth: 1, borderColor: 'rgba(0, 255, 194, 0.1)' },
    footer: { paddingHorizontal: 32 },
    logoutBtn: {
        height: 64,
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.2)',
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(239,68,68,0.03)'
    },
});
