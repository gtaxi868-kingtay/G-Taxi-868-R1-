import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Alert } from 'react-native';
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
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { ghostBorder, elevationGlow, glassSurface } from '@gtaxi/design-system/utils/style-rules';

type AreaSignups = { town: string | null; riders: number; shops: number; radius_km: number };

export function areaLine(a: AreaSignups) {
    const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const who = [a.riders && count(a.riders, 'rider', 'riders'), a.shops && count(a.shops, 'shop', 'shops')].filter(Boolean);
    const where = a.town ? `within ${a.radius_km} km of ${a.town}` : 'near you';
    return `${who.join(' and ')} ${a.riders + a.shops === 1 ? 'has' : 'have'} joined ${where}.`;
}

export function PendingApprovalScreen() {
    const { height } = useWindowDimensions();
    const { signOut } = useAuth();
    const insets = useSafeAreaInsets();

    const [area, setArea] = useState<AreaSignups | null>(null);

    const rotation = useSharedValue(0);

    useEffect(() => {
        rotation.value = withRepeat(
            withTiming(360, { duration: 4000, easing: Easing.linear }),
            -1, false
        );
    }, []);

    useEffect(() => {
        let live = true;
        supabase.rpc('driver_area_signups').then(({ data, error }: { data: AreaSignups | null; error: unknown }) => {
            if (live && !error && data && data.riders + data.shops > 0) setArea(data);
        }, () => {});
        return () => { live = false; };
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

            <LinearGradient colors={['#0A0718', '#0A0718']} style={StyleSheet.absoluteFillObject} />
            
            <LinearGradient
                colors={[VOICES.driver.accent + '0D', 'transparent']}
                style={[StyleSheet.absoluteFillObject, { height: height * 0.4 }]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
            />

            <View style={s.content}>
                <Reanimated.View style={[s.iconBox, rotationStyle]}>
                    <Ionicons name="hourglass-outline" size={64} color={VOICES.driver.gold} />
                </Reanimated.View>

                <Text style={[s.title, {fontSize: 24, fontWeight: '800', color: '#EAF3F6'}]}>
                    OPERATOR APPROVAL PENDING
                </Text>

                <Text style={[s.description, {fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 20, lineHeight: 22, opacity: 0.8}]}>
                    YOUR PROFILE IS UNDERGOING SYSTEM COMPLIANCE CHECKS. YOU WILL BE NOTIFIED VIA SECURE PUSH ONCE AUTHORIZED.
                </Text>
                
                {area && (
                    <View style={s.areaCard}>
                        <Ionicons name="people-outline" size={18} color={VOICES.driver.accent} />
                        <Text style={s.areaText}>{areaLine(area)}</Text>
                    </View>
                )}

                <View style={s.badge}>
                    <Text style={{fontSize: 11, fontWeight: '700', color: VOICES.driver.gold, letterSpacing: 2}}>
                        TELEMETRY CONNECTED
                    </Text>
                </View>
            </View>

            <View style={[s.footer, { paddingBottom: insets.bottom + 40 }]}>
                <TouchableOpacity style={s.logoutBtn} onPress={handleSignOut}>
                    <Ionicons name="log-out-outline" size={20} color="rgba(239,68,68,0.35)" style={{ marginRight: 8 }} />
                    <Text style={{fontSize: 14, fontWeight: '600', color: 'rgba(239,68,68,0.35)'}}>Sign out</Text>
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
        backgroundColor: VOICES.driver.accent + '08',
        alignItems: 'center', justifyContent: 'center',
        ...ghostBorder(0.1),
        ...elevationGlow(),
    },
    title: { textAlign: 'center', marginTop: 40, letterSpacing: -0.5 },
    description: { textAlign: 'center', marginTop: 20, lineHeight: 22, opacity: 0.8 },
    badge: { marginTop: 32, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: VOICES.driver.accent + '0D', ...ghostBorder(0.1) },
    areaCard: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 18, backgroundColor: VOICES.driver.accent + '12', ...ghostBorder(0.15) },
    areaText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20, color: '#EAF3F6' },
    footer: { paddingHorizontal: 32 },
    logoutBtn: {
        height: 64,
        flexDirection: 'row',
        ...ghostBorder(0.2),
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(239,68,68,0.03)'
    },
});
