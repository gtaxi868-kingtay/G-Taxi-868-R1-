// @ts-nocheck
// RainLogin — the shared "crystal liquid glass" login scaffold.
// One deep module: night-glass gradient canvas, animated rain falling behind the
// glass, slow condensation streaks sliding down it, the real brand logo with a
// breathing glow, a blur card with a lit crystal edge, and a staggered entrance.
// Screens supply only their form fields, links, and auth logic.
//
// Built on core RN Animated (transform/opacity only, native driver on device) so it
// needs no extra babel/worklet config and runs on iOS, Android, and react-native-web.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, Image, StyleSheet, Animated, Easing, Platform,
    KeyboardAvoidingView, Pressable, TextInput, ActivityIndicator,
    useWindowDimensions, AccessibilityInfo,
} from 'react-native';
// @ts-ignore
import { BlurView } from 'expo-blur';
// @ts-ignore
import { LinearGradient } from 'expo-linear-gradient';

// ── Voice palettes ───────────────────────────────────────────────────────────
// Every app shares the same violet-black night canvas family (logo-derived);
// identity comes from the accent + the metal + the lit signature edge.
const RAIN_VOICES = {
    rider: {
        canvas: ['#0B0620', '#0A1030', '#07070F'],
        accent: '#34E6EC',
        metal: '#CBD6DE',
        signature: ['#6D28D9', '#34E6EC'],
        cta: ['#6D28D9', '#0F9CA6'],
        ctaText: '#EAF3F6',
    },
    driver: {
        canvas: ['#070B14', '#0A101C', '#08090D'],
        accent: '#34E6EC',
        metal: '#E6B450',
        signature: ['#34E6EC', '#E6B450'],
        cta: ['#0F9CA6', '#34E6EC'],
        ctaText: '#05060B',
    },
    merchant: {
        canvas: ['#061110', '#081716', '#070C0B'],
        accent: '#2DD4BF',
        metal: '#D9A06B',
        signature: ['#2DD4BF', '#C08552'],
        cta: ['#0F766E', '#2DD4BF'],
        ctaText: '#05060B',
    },
    admin: {
        canvas: ['#0C0A1E', '#101430', '#0F172A'],
        accent: '#8B5CF6',
        metal: '#CBD6DE',
        signature: ['#8B5CF6', '#34E6EC'],
        cta: ['#7C3AED', '#8B5CF6'],
        ctaText: '#F1F5F9',
    },
};

const ICE = '#EAF3F6';
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function useReducedMotion() {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        let mounted = true;
        AccessibilityInfo.isReduceMotionEnabled?.().then((v) => mounted && setReduced(!!v));
        const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduced(!!v));
        return () => { mounted = false; sub?.remove?.(); };
    }, []);
    return reduced;
}

// ── Rain layers ──────────────────────────────────────────────────────────────

// Fast rain falling in the world behind the glass. Thin bright threads, constant
// linear motion (it's weather, not UI — linear is correct here).
function FallingRain({ accent, reduced }) {
    const { width, height } = useWindowDimensions();
    const drops = useMemo(() =>
        Array.from({ length: 18 }, (_, i) => ({
            x: Math.random() * width,
            len: 12 + Math.random() * 18,
            duration: 2000 + Math.random() * 2600,
            delay: Math.random() * 3000,
            opacity: 0.07 + Math.random() * 0.15,
            drift: (Math.random() - 0.5) * 40,
        })), [width]);

    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {drops.map((d, i) => (
                <RainDrop key={i} {...d} screenH={height} accent={accent} reduced={reduced} />
            ))}
        </View>
    );
}

function RainDrop({ x, len, duration, delay, opacity, drift, screenH, accent, reduced }) {
    const fall = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (reduced) return;
        const anim = Animated.loop(
            Animated.timing(fall, {
                toValue: 1, duration, delay,
                easing: Easing.linear, useNativeDriver: Platform.OS !== 'web',
            })
        );
        anim.start();
        return () => anim.stop();
    }, [reduced]);

    const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-len - 20, screenH + 20] });
    const translateX = fall.interpolate({ inputRange: [0, 1], outputRange: [0, drift] });

    return (
        <Animated.View
            style={{
                position: 'absolute', left: x, top: 0,
                width: 1.5, height: len, borderRadius: 1,
                backgroundColor: accent, opacity: reduced ? opacity * 0.5 : opacity,
                transform: reduced ? [{ translateY: screenH * 0.3 }] : [{ translateY }, { translateX }],
            }}
        />
    );
}

// Slow condensation streaks sliding DOWN the glass itself — a bright head bead
// with a fading tail, wobbling slightly as it finds its path.
function GlassStreaks({ reduced }) {
    const { width, height } = useWindowDimensions();
    const streaks = useMemo(() =>
        Array.from({ length: 4 }, () => ({
            x: 24 + Math.random() * (width - 48),
            duration: 9000 + Math.random() * 6000,
            delay: Math.random() * 7000,
            tail: 40 + Math.random() * 50,
        })), [width]);

    if (reduced) return null;
    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {streaks.map((st, i) => <Streak key={i} {...st} screenH={height} />)}
        </View>
    );
}

function Streak({ x, duration, delay, tail, screenH }) {
    const slide = useRef(new Animated.Value(0)).current;
    const wobble = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const a = Animated.loop(
            Animated.timing(slide, {
                toValue: 1, duration, delay,
                easing: Easing.bezier(0.4, 0, 0.6, 1), useNativeDriver: Platform.OS !== 'web',
            })
        );
        const w = Animated.loop(
            Animated.sequence([
                Animated.timing(wobble, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
                Animated.timing(wobble, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
            ])
        );
        a.start(); w.start();
        return () => { a.stop(); w.stop(); };
    }, []);

    const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-tail, screenH + tail] });
    const translateX = wobble.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] });
    const opacity = slide.interpolate({ inputRange: [0, 0.06, 0.9, 1], outputRange: [0, 1, 1, 0] });

    return (
        <Animated.View style={{ position: 'absolute', left: x, top: 0, opacity, transform: [{ translateY }, { translateX }] }}>
            <LinearGradient
                colors={['rgba(234,243,246,0)', 'rgba(234,243,246,0.16)']}
                style={{ width: 2, height: tail, borderRadius: 1 }}
            />
            <View style={{
                width: 5, height: 6, borderRadius: 3, marginLeft: -1.5,
                backgroundColor: 'rgba(234,243,246,0.35)',
                borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(255,255,255,0.5)',
            }} />
        </Animated.View>
    );
}

// Static condensation beads clinging to the glass card. No motion, pure texture —
// each catches light on its upper-left rim.
function Condensation({ seedWidth = 320, seedHeight = 380, count = 16 }) {
    const beads = useMemo(() =>
        Array.from({ length: count }, () => ({
            x: Math.random() * seedWidth,
            y: Math.random() * seedHeight,
            r: 1.5 + Math.random() * 2.5,
            o: 0.05 + Math.random() * 0.1,
        })), []);
    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {beads.map((b, i) => (
                <View key={i} style={{
                    position: 'absolute', left: b.x, top: b.y,
                    width: b.r * 2, height: b.r * 2, borderRadius: b.r,
                    backgroundColor: `rgba(234,243,246,${b.o})`,
                    borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth,
                    borderColor: 'rgba(255,255,255,0.35)',
                }} />
            ))}
        </View>
    );
}

// ── Crystal form primitives ──────────────────────────────────────────────────

export function CrystalInput({
    label, value, onChangeText, placeholder, voice = 'rider',
    secureTextEntry, keyboardType, autoCapitalize = 'none', rightSlot, testID,
}) {
    const v = RAIN_VOICES[voice] || RAIN_VOICES.rider;
    const [focused, setFocused] = useState(false);
    const glow = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(glow, {
            toValue: focused ? 1 : 0, duration: focused ? 180 : 240,
            easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, [focused]);

    return (
        <View style={ci.wrap}>
            {label ? <Text style={[ci.label, focused && { color: v.accent }]}>{label}</Text> : null}
            <View style={ci.shell}>
                {/* Accent focus ring fades in above the resting hairline */}
                <Animated.View pointerEvents="none" style={[ci.focusRing, { borderColor: v.accent, opacity: glow }]} />
                <View style={ci.inner}>
                    <TextInput
                        testID={testID}
                        style={ci.input}
                        placeholder={placeholder}
                        placeholderTextColor="rgba(234,243,246,0.28)"
                        value={value}
                        onChangeText={onChangeText}
                        secureTextEntry={secureTextEntry}
                        keyboardType={keyboardType}
                        autoCapitalize={autoCapitalize}
                        autoCorrect={false}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                    />
                    {rightSlot}
                </View>
            </View>
        </View>
    );
}

const ci = StyleSheet.create({
    wrap: { gap: 8 },
    label: {
        color: 'rgba(234,243,246,0.5)', fontSize: 11, fontWeight: '700',
        letterSpacing: 2, textTransform: 'uppercase', marginLeft: 2,
    },
    shell: { borderRadius: 16 },
    focusRing: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 16, borderWidth: 1.5,
        shadowColor: '#34E6EC', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 10,
    },
    inner: {
        minHeight: 56, borderRadius: 16, paddingHorizontal: 18,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
        flexDirection: 'row', alignItems: 'center',
    },
    input: { flex: 1, color: ICE, fontSize: 16, fontWeight: '500', paddingVertical: 16 },
});

export function CrystalButton({ title, onPress, loading, disabled, voice = 'rider', testID }) {
    const v = RAIN_VOICES[voice] || RAIN_VOICES.rider;
    const press = useRef(new Animated.Value(0)).current;
    const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

    const animateTo = (to, dur) =>
        Animated.timing(press, { toValue: to, duration: dur, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' }).start();

    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            disabled={disabled || loading}
            onPressIn={() => animateTo(1, 110)}
            onPressOut={() => animateTo(0, 160)}
            accessibilityRole="button"
            accessibilityLabel={title}
        >
            <Animated.View style={[cb.shell, { transform: [{ scale }] }, (disabled || loading) && { opacity: 0.55 }]}>
                <LinearGradient colors={v.cta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={cb.fill}>
                    {loading
                        ? <ActivityIndicator color={v.ctaText} />
                        : <Text style={[cb.text, { color: v.ctaText }]}>{title}</Text>}
                </LinearGradient>
                {/* top rim light — the crystal edge */}
                <LinearGradient
                    colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
                    start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                    style={cb.rim} pointerEvents="none"
                />
            </Animated.View>
        </Pressable>
    );
}

const cb = StyleSheet.create({
    shell: { height: 56, borderRadius: 16, overflow: 'hidden' },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    rim: { position: 'absolute', top: 0, left: 0, right: 0, height: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    text: { fontSize: 16, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
});

// ── The scaffold ─────────────────────────────────────────────────────────────

export function RainLogin({ voice = 'rider', logoSource, title, subtitle, children, footer }) {
    const v = RAIN_VOICES[voice] || RAIN_VOICES.rider;
    const reduced = useReducedMotion();

    // Staggered entrance: logo → card → footer (80ms apart, ease-out, no scale(0))
    const stages = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
    // Slow breathing glow behind the logo
    const breath = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.stagger(80, stages.map((s) =>
            Animated.timing(s, { toValue: 1, duration: 450, easing: EASE_OUT, useNativeDriver: Platform.OS !== 'web' })
        )).start();
        if (!reduced) {
            const b = Animated.loop(Animated.sequence([
                Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
                Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
            ]));
            b.start();
            return () => b.stop();
        }
    }, [reduced]);

    const enter = (stage) => ({
        opacity: stage,
        transform: [
            { translateY: stage.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: stage.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
        ],
    });

    const glowScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
    const glowOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

    return (
        <View style={rl.root}>
            {/* Night canvas */}
            <LinearGradient colors={v.canvas} style={StyleSheet.absoluteFillObject} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} />
            {/* Rain in the world outside */}
            <FallingRain accent={v.accent} reduced={reduced} />
            {/* Streaks sliding down the window we're looking through */}
            <GlassStreaks reduced={reduced} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={rl.kav}>
                <View style={rl.content}>
                    {/* Logo */}
                    <Animated.View style={[rl.logoBlock, enter(stages[0])]}>
                        <Animated.View style={[rl.logoGlow, { backgroundColor: v.accent + '22', opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
                        {logoSource ? (
                            <Image source={logoSource} style={rl.logo} resizeMode="contain" />
                        ) : null}
                        {title ? <Text style={[rl.title, { color: ICE }]}>{title}</Text> : null}
                        {subtitle ? <Text style={[rl.subtitle, { color: v.metal }]}>{subtitle}</Text> : null}
                    </Animated.View>

                    {/* Crystal card */}
                    <Animated.View style={enter(stages[1])}>
                        <View style={rl.cardShell}>
                            {/* signature lit edge — used ONCE per screen */}
                            <LinearGradient colors={v.signature} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={rl.litEdge} />
                            <BlurView intensity={26} tint="dark" style={rl.blur}>
                                <View style={rl.card}>
                                    <Condensation />
                                    <View style={rl.cardInner}>{children}</View>
                                </View>
                            </BlurView>
                        </View>
                    </Animated.View>

                    {/* Footer links */}
                    {footer ? <Animated.View style={[rl.footer, enter(stages[2])]}>{footer}</Animated.View> : null}
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const rl = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07070F' },
    kav: { flex: 1 },
    content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, maxWidth: 460, width: '100%', alignSelf: 'center' },
    logoBlock: { alignItems: 'center', marginBottom: 28 },
    logoGlow: { position: 'absolute', top: -20, width: 200, height: 200, borderRadius: 100, alignSelf: 'center' },
    logo: { width: 150, height: 150 },
    title: { fontSize: 24, fontWeight: '800', letterSpacing: 3, marginTop: 4, textAlign: 'center' },
    subtitle: { fontSize: 11, fontWeight: '700', letterSpacing: 4, textTransform: 'uppercase', marginTop: 6, textAlign: 'center' },
    cardShell: {
        borderRadius: 24, overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    },
    litEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 1.5, zIndex: 2 },
    blur: { borderRadius: 24 },
    card: { backgroundColor: 'rgba(13,17,26,0.55)' },
    cardInner: { padding: 24, gap: 18 },
    footer: { marginTop: 24, alignItems: 'center', gap: 4 },
});
