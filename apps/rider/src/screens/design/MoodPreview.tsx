import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, Pressable, View, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BRAND_GRADIENT as BRAND, SERIF, greetingFor, isNight, useMood } from '../../theme/mood';

// DESIGN SAMPLE: the rider home in the chosen look (2026-10-24):
// Pearl by day, Aurora by night, switching on the clock (src/theme/mood.ts).
// Web only: /design-preview?mood=auto (default) | day | night

const MAPBOX = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
const map = (style: string) =>
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/-61.5115,10.6596,14.2,0/600x760@2x?access_token=${MAPBOX}&attribution=false&logo=false`;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function T({ children, style }: { children: React.ReactNode; style?: any }) {
    return <RNText style={style}>{children}</RNText>;
}

export function MoodPreview() {
    const insets = useSafeAreaInsets();
    const param = Platform.OS === 'web' && typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('mood') : null;
    const force = param === 'day' || param === 'pearl' ? 'day' : param === 'night' || param === 'aurora' ? 'night' : undefined;
    const m = useMood(force);
    // Keep the words in step with the look when a mood is forced for review.
    const now = new Date();
    const g = force && (force === 'night') !== isNight(now)
        ? (force === 'night' ? greetingFor(new Date(2026, 0, 1, 20)) : greetingFor(new Date(2026, 0, 1, 10)))
        : greetingFor(now);

    // Entrance: sheet glides up, content fades in after it.
    const rise = useRef(new Animated.Value(48)).current;
    const fade = useRef(new Animated.Value(0)).current;
    const content = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.sequence([
            Animated.parallel([
                Animated.timing(rise, { toValue: 0, duration: 520, easing: EASE_OUT, useNativeDriver: true }),
                Animated.timing(fade, { toValue: 1, duration: 380, easing: EASE_OUT, useNativeDriver: true }),
            ]),
            Animated.timing(content, { toValue: 1, duration: 360, easing: EASE_OUT, useNativeDriver: true }),
        ]).start();
    }, [rise, fade, content]);

    const font = (w: 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy') =>
        ({ regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold', heavy: 'Manrope_800ExtraBold' }[w]);

    return (
        <View style={{ flex: 1, backgroundColor: m.page, overflow: 'hidden' }}>
            {/* Map with its mood wash */}
            <Image source={{ uri: map(m.mapStyle) }} resizeMode="cover" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '62%' }} />
            <LinearGradient colors={m.mapWash as any} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '62%' }} />

            {/* Top bar */}
            <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: m.sheet[1], alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: m.sheetBorder }}>
                    <Ionicons name="menu" size={20} color={m.ink} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: m.sheet[1], borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: m.sheetBorder }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5BD8A0', marginRight: 8 }} />
                    <T style={{ color: m.ink, fontFamily: font('semibold'), fontSize: 13 }}>3 G drivers nearby</T>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden' }}>
                    <LinearGradient colors={BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <T style={{ color: '#FFFFFF', fontFamily: font('bold'), fontSize: 16 }}>G</T>
                    </LinearGradient>
                </View>
            </View>

            {/* Pickup pin with a halo */}
            <View style={{ position: 'absolute', left: 0, right: 0, top: '13%', alignItems: 'center' }}>
                <View style={{ backgroundColor: m.sheet[1], borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8, borderWidth: 1, borderColor: m.sheetBorder }}>
                    <T style={{ color: m.ink, fontFamily: font('semibold'), fontSize: 12 }}>Your pickup · Woodford Square</T>
                </View>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(139,124,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(139,124,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                        <LinearGradient colors={BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2.5, borderColor: '#FFFFFF' }} />
                    </View>
                </View>
            </View>

            {/* Sheet */}
            <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, opacity: fade, transform: [{ translateY: rise }] }}>
                {m.glow ? (
                    // Aurora: brand light rising behind the sheet's top edge
                    <LinearGradient
                        colors={m.glow as any} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                        style={{ position: 'absolute', left: -20, right: -20, top: -110, height: 190, opacity: 0.9, borderRadius: 190,
                            ...(Platform.OS === 'web' ? ({ filter: 'blur(44px)' } as any) : null) }}
                    />
                ) : null}
                <LinearGradient
                    colors={m.sheet as any}
                    style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderBottomWidth: 0, borderColor: m.sheetBorder,
                        paddingHorizontal: 22, paddingTop: 12, paddingBottom: insets.bottom + 20,
                        shadowColor: '#000', shadowOpacity: m.shadowOpacity, shadowRadius: 30, shadowOffset: { width: 0, height: -8 } }}
                >
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: m.chipBorder, alignSelf: 'center', marginBottom: 18 }} />

                    <Animated.View style={{ opacity: content, transform: [{ translateY: content.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            <Ionicons name={g.icon} size={13} color={m.accent} />
                            <T style={{ color: m.accent, fontFamily: font('semibold'), fontSize: 13, marginLeft: 6 }}>{g.hello}</T>
                        </View>
                        <T style={{ color: m.ink, fontFamily: SERIF, fontSize: 38, lineHeight: 42, letterSpacing: -0.3 }}>Welcome back,{'\n'}Gershwane</T>
                        <T style={{ color: m.dim, fontFamily: font('medium'), fontSize: 15, marginTop: 6 }}>Where can we take you {g.when}?</T>

                        {/* Search */}
                        <View style={{ marginTop: 20, borderRadius: 999, padding: 1.5, overflow: 'hidden' }}>
                            <LinearGradient colors={BRAND} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.55 }} />
                            <View style={{ height: 58, borderRadius: 999, backgroundColor: m.searchBg, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 6 }}>
                                <Ionicons name="search" size={20} color={m.searchIcon} />
                                <T style={{ flex: 1, marginLeft: 12, color: m.ink, fontFamily: font('semibold'), fontSize: 17 }}>Where to?</T>
                                <View style={{ height: 46, borderRadius: 999, backgroundColor: m.field, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
                                    <Ionicons name="time-outline" size={16} color={m.ink} />
                                    <T style={{ color: m.ink, fontFamily: font('semibold'), fontSize: 14, marginLeft: 6 }}>Now</T>
                                </View>
                            </View>
                        </View>

                        {/* Saved places */}
                        <View style={{ flexDirection: 'row', marginTop: 14 }}>
                            {[['home', 'Home'], ['briefcase', 'Work'], ['airplane', 'Piarco']].map(([icon, label]) => (
                                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: m.chipBorder, backgroundColor: m.chip, marginRight: 8 }}>
                                    <Ionicons name={icon as any} size={14} color={m.accent} />
                                    <T style={{ color: m.ink, fontFamily: font('semibold'), fontSize: 14, marginLeft: 7 }}>{label}</T>
                                </View>
                            ))}
                        </View>

                        {/* Services */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 }}>
                            {[['car-sport', 'Ride'], ['basket', 'Groceries'], ['shirt', 'Laundry'], ['airplane', 'Escape']].map(([icon, label], i) => (
                                <View key={label} style={{ width: '23%', alignItems: 'center' }}>
                                    {i === 0 ? (
                                        <LinearGradient colors={BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                            style={{ height: 60, width: '100%', borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                                            <Ionicons name={icon as any} size={24} color="#FFFFFF" />
                                        </LinearGradient>
                                    ) : (
                                        <View style={{ height: 60, width: '100%', borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: m.tile }}>
                                            <Ionicons name={icon as any} size={22} color={m.ink} />
                                        </View>
                                    )}
                                    <T style={{ color: m.ink, fontFamily: font('semibold'), fontSize: 13, marginTop: 7 }}>{label}</T>
                                </View>
                            ))}
                        </View>

                        {/* Trust */}
                        <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 14, backgroundColor: m.trustBg, borderWidth: 1, borderColor: m.chipBorder }}>
                            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(91,216,160,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="shield-checkmark" size={18} color="#3FBF86" />
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <T style={{ color: m.ink, fontFamily: font('bold'), fontSize: 15 }}>You are in safe hands</T>
                                <T style={{ color: m.dim, fontFamily: font('medium'), fontSize: 13, marginTop: 2 }}>Verified drivers · G Guardian on call 24/7</T>
                            </View>
                        </View>
                    </Animated.View>
                </LinearGradient>
            </Animated.View>

            {/* Mood label for the review only */}
            <View style={{ position: 'absolute', right: 12, top: insets.top + 64, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <T style={{ color: '#FFFFFF', fontFamily: font('bold'), fontSize: 11 }}>{m.name}</T>
            </View>
        </View>
    );
}
