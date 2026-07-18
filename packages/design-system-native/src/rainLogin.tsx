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
    useWindowDimensions, AccessibilityInfo, ScrollView,
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
        rainTint: '#C9E8F2',
    },
    driver: {
        canvas: ['#070B14', '#0A101C', '#08090D'],
        accent: '#34E6EC',
        metal: '#E6B450',
        signature: ['#34E6EC', '#E6B450'],
        cta: ['#0F9CA6', '#34E6EC'],
        ctaText: '#05060B',
        rainTint: '#C9E8F2',
    },
    merchant: {
        canvas: ['#061110', '#081716', '#070C0B'],
        accent: '#2DD4BF',
        metal: '#D9A06B',
        signature: ['#2DD4BF', '#C08552'],
        cta: ['#0F766E', '#2DD4BF'],
        ctaText: '#05060B',
        rainTint: '#C6EFE8',
    },
    admin: {
        canvas: ['#0C0A1E', '#101430', '#0F172A'],
        accent: '#8B5CF6',
        metal: '#CBD6DE',
        signature: ['#8B5CF6', '#34E6EC'],
        cta: ['#7C3AED', '#8B5CF6'],
        ctaText: '#F1F5F9',
        rainTint: '#D6D0F5',
    },
};

const ICE = '#EAF3F6';
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// On web, RN Animated is requestAnimationFrame-driven — embedded/occluded browser
// surfaces throttle rAF to zero, freezing every JS animation. CSS keyframe
// animations run on the compositor and keep playing, so all decorative motion on
// web is real CSS: one injected <style> of named @keyframes, with per-element
// variation (duration/delay/travel) fed through CSS custom properties on raw divs.
// Native keeps the Animated path. Reduce-motion is handled inside the stylesheet:
// movement animations switch off, entrances become fades, breathing stays.
const IS_WEB = Platform.OS === 'web';
const WEB_CSS = `
@keyframes gt-fall{from{transform:translate3d(0,-60px,0) rotate(-10deg)}to{transform:translate3d(var(--drift,40px),110vh,0) rotate(-10deg)}}
@keyframes gt-streak{0%{opacity:0;transform:translate3d(-4px,-90px,0)}6%{opacity:1}50%{transform:translate3d(4px,50vh,0)}90%{opacity:1}100%{opacity:0;transform:translate3d(-4px,108vh,0)}}
@keyframes gt-breathe{from{opacity:.45}to{opacity:1}}
@keyframes gt-sweep{0%{transform:translateX(calc(var(--seg,64px) * -1));opacity:0}6%{opacity:1}80%{opacity:1}88%{transform:translateX(var(--len,200px));opacity:0}100%{transform:translateX(var(--len,200px));opacity:0}}
@keyframes gt-enter{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
@keyframes gt-logo-in{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
@keyframes gt-fade{from{opacity:0}to{opacity:1}}
@keyframes gt-breath{from{transform:scale(1)}to{transform:scale(1.03)}}
.gt-drop{animation:gt-fall var(--dur,3000ms) linear var(--delay,0ms) infinite}
.gt-streak{animation:gt-streak var(--dur,12000ms) ease-in-out var(--delay,0ms) infinite}
.gt-seam{animation:gt-breathe var(--dur,4200ms) ease-in-out var(--delay,0ms) infinite alternate}
.gt-sweep{animation:gt-sweep var(--dur,3000ms) ease-in-out var(--delay,0ms) infinite}
.gt-enter{animation:gt-enter 450ms cubic-bezier(0.23,1,0.32,1) var(--delay,0ms) both}
.gt-logo-in{animation:gt-logo-in 650ms cubic-bezier(0.34,1.56,0.64,1) both}
.gt-breath{animation:gt-breath 3200ms ease-in-out infinite alternate}
@media (prefers-reduced-motion: reduce){
  .gt-drop,.gt-streak,.gt-sweep,.gt-breath{animation:none}
  .gt-enter,.gt-logo-in{animation-name:gt-fade}
}
`;

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

// Fast rain falling across the WHOLE background — thin bright threads on a shared
// diagonal (real rain has wind), constant linear motion (it's weather, not UI).
// Everything lives behind the content column and is capped at low opacity so it
// never blocks readability.
const RAIN_ANGLE_DEG = 10;
const RAIN_DRIFT = Math.tan((RAIN_ANGLE_DEG * Math.PI) / 180);

function FallingRain({ accent, reduced }) {
    const { width, height } = useWindowDimensions();
    // One random "closeness" factor per drop drives everything together, the way
    // perspective does in real rain: nearer drops fall faster, streak longer
    // (motion blur), and read brighter than the distant ones.
    const drops = useMemo(() =>
        Array.from({ length: 34 }, () => {
            const s = Math.random();
            return {
                x: -height * RAIN_DRIFT + Math.random() * (width + height * RAIN_DRIFT),
                len: 30 + s * 65,
                duration: 1150 - s * 620,
                delay: Math.random() * 1500,
                opacity: 0.10 + s * 0.24,
                thickness: 1 + s * 0.6,
            };
        }), [width, height]);

    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {drops.map((d, i) => (
                <RainDrop key={i} {...d} screenH={height} accent={accent} reduced={reduced} />
            ))}
        </View>
    );
}

function RainDrop({ x, len, duration, delay, opacity, thickness, screenH, accent, reduced }) {
    const fall = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (reduced || IS_WEB) return;
        const anim = Animated.loop(
            Animated.timing(fall, {
                toValue: 1, duration, delay,
                easing: Easing.linear, useNativeDriver: true,
            })
        );
        anim.start();
        return () => anim.stop();
    }, [reduced]);

    const travel = screenH + len + 40;

    // A drop is a motion-blur streak, not a line: transparent tail fading into a
    // brighter head at the bottom (the direction it's falling).
    const streakBody = (
        <LinearGradient
            colors={[accent + '00', accent + '73', accent]}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
            style={{ width: thickness, height: len, borderRadius: thickness / 2 }}
        />
    );

    if (IS_WEB) {
        // Raw div + injected @keyframes: inline styles can't hold keyframes, and
        // this must keep playing even when rAF is throttled. Negative delay
        // starts each drop mid-fall so the sky is never empty at load.
        return (
            <div
                className="gt-drop"
                style={{
                    position: 'absolute', left: x, top: 0, opacity,
                    transform: `translateY(32vh) rotate(${-RAIN_ANGLE_DEG}deg)`,
                    '--dur': `${duration}ms`,
                    '--delay': `${-delay}ms`,
                    '--drift': `${travel * RAIN_DRIFT}px`,
                }}
            >
                {streakBody}
            </div>
        );
    }

    if (reduced) {
        return (
            <View style={{ position: 'absolute', left: x, top: 0, opacity: opacity * 0.5, transform: [{ translateY: screenH * 0.3 }, { rotate: `${-RAIN_ANGLE_DEG}deg` }] }}>
                {streakBody}
            </View>
        );
    }

    const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-len - 20, screenH + 20] });
    // All drops share one wind direction — drift is proportional to fall distance.
    const translateX = fall.interpolate({ inputRange: [0, 1], outputRange: [0, travel * RAIN_DRIFT] });

    return (
        <Animated.View
            style={{
                position: 'absolute', left: x, top: 0, opacity,
                transform: [{ translateY }, { translateX }, { rotate: `${-RAIN_ANGLE_DEG}deg` }],
            }}
        >
            {streakBody}
        </Animated.View>
    );
}

// Shattered-glass facet background (the "Live Wallpaper" reference): matte
// charcoal shards tiling the dark, with neon light leaking through the cracks
// between them. Color lives ONLY in the glowing seams — the shards stay near-black.
// Hue shifts down the screen: signature[0] at top → accent → signature[1] below.
// Pure Views + transforms; seams pulse gently like a live wallpaper.

// One dark shard: a rotated, slightly skewed rectangle with a barely-there fill
// and a hairline top edge that catches ambient light.
function Shard({ x, y, w, h, angle, skew = 0, fill }) {
    return (
        <View style={{
            position: 'absolute', left: x, top: y, width: w, height: h,
            backgroundColor: fill,
            borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.07)',
            transform: [{ rotate: `${angle}deg` }, { skewX: `${skew}deg` }],
        }} />
    );
}

// One glowing crack: a soft bloom layer under a bright core line, both fading at
// the ends. Two motions layered — the whole seam breathes slowly, and a bright
// pulse of light travels down the crack, sweeps, rests, sweeps again.
function Seam({ x, y, len, angle, color, thickness = 2, delay = 0, dur = 4200, reduced }) {
    const pulse = useRef(new Animated.Value(0)).current;
    const runner = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (IS_WEB) return; // web uses CSS keyframes below
        // Reduced motion: keep the gentle opacity breathing (no movement is
        // involved), drop only the traveling sweep.
        const breathe = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: dur, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]));
        breathe.start();
        if (reduced) return () => breathe.stop();
        // travel time scales with length so every pulse moves at similar speed;
        // the rest between sweeps is desynced by the same per-seam delay
        const sweep = Animated.loop(Animated.sequence([
            Animated.delay(delay),
            Animated.timing(runner, { toValue: 1, duration: 900 + len * 1.6, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(runner, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.delay(700),
        ]));
        sweep.start();
        return () => { breathe.stop(); sweep.stop(); };
    }, [reduced]);

    const bloom = thickness * 4;
    const segW = Math.max(len * 0.3, 64);
    // The crack strip is taller than the resting line so the pulse can visibly
    // swell it as it passes.
    const stripH = thickness * 3;

    const sweepDur = 900 + len * 1.6;
    const cycle = sweepDur + 1400;

    const bloomGradient = (
        <LinearGradient
            colors={[color + '00', color + '59', color + '00']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={{ width: len, height: bloom, borderRadius: bloom / 2, marginBottom: -(bloom + stripH) / 2 }}
        />
    );
    const coreGradient = (
        <LinearGradient
            colors={[color + '00', color, color + '00']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={{ position: 'absolute', top: (stripH - thickness) / 2, left: 0, width: len, height: thickness, borderRadius: thickness / 2 }}
        />
    );
    const runnerGradient = (
        <LinearGradient
            colors={[color + '00', '#FFFFFF', color + '00']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={{ width: segW, height: stripH, borderRadius: stripH / 2 }}
        />
    );
    const haloGradient = (
        <LinearGradient
            colors={[color + '00', color + 'B3', color + '00']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={{ width: segW, height: bloom * 2.5, borderRadius: bloom }}
        />
    );

    if (IS_WEB) {
        // Raw divs + injected @keyframes (see WEB_CSS): breathing on the seam,
        // the sweep's travel distance fed through CSS variables. Under
        // prefers-reduced-motion the stylesheet stops the sweep and keeps the
        // breathing — no JS involved.
        const sweepVars = { '--seg': `${segW}px`, '--len': `${len}px`, '--dur': `${cycle}ms`, '--delay': `${-delay}ms` };
        return (
            <div
                className="gt-seam"
                style={{
                    position: 'absolute', left: x, top: y, opacity: 0.45,
                    transform: `rotate(${angle}deg)`,
                    '--dur': `${dur}ms`, '--delay': `${-delay}ms`,
                }}
            >
                {bloomGradient}
                <View style={{ width: len, height: stripH, overflow: 'hidden' }}>
                    {coreGradient}
                    <div className="gt-sweep" style={{ position: 'absolute', top: 0, left: 0, opacity: 0, ...sweepVars }}>
                        {runnerGradient}
                    </div>
                </View>
                <div className="gt-sweep" style={{ position: 'absolute', top: -bloom, left: 0, opacity: 0, ...sweepVars }}>
                    {haloGradient}
                </div>
            </div>
        );
    }

    const runnerOpacity = runner.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] });
    const travel = runner.interpolate({ inputRange: [0, 1], outputRange: [-segW, len] });

    return (
        <Animated.View style={{ position: 'absolute', left: x, top: y, transform: [{ rotate: `${angle}deg` }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }}>
            {bloomGradient}
            {/* crack strip: resting core line centered, traveling pulse swells it */}
            <View style={{ width: len, height: stripH, overflow: 'hidden' }}>
                {coreGradient}
                {!reduced && (
                    <Animated.View style={{ position: 'absolute', top: 0, left: 0, opacity: runnerOpacity, transform: [{ translateX: travel }] }}>
                        {runnerGradient}
                    </Animated.View>
                )}
            </View>
            {/* the pulse's halo, riding above the crack */}
            {!reduced && (
                <Animated.View style={{ position: 'absolute', top: -bloom, left: 0, opacity: runnerOpacity, transform: [{ translateX: travel }] }}>
                    {haloGradient}
                </Animated.View>
            )}
        </Animated.View>
    );
}

function FloatingShapes({ voice, reduced }) {
    const { width: w, height: h } = useWindowDimensions();
    const v = RAIN_VOICES[voice] || RAIN_VOICES.rider;
    const [top, mid, low] = [v.signature[0], v.accent, v.signature[1]];

    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {/* Facet wall — big dark shards at odd angles, corners heavier than center */}
            <Shard x={-w * 0.25} y={-h * 0.12} w={w * 0.85} h={h * 0.30} angle={-16} skew={-6} fill="rgba(255,255,255,0.030)" />
            <Shard x={w * 0.45} y={-h * 0.16} w={w * 0.85} h={h * 0.34} angle={11} skew={5} fill="rgba(255,255,255,0.020)" />
            <Shard x={-w * 0.30} y={h * 0.26} w={w * 0.75} h={h * 0.30} angle={27} skew={-4} fill="rgba(255,255,255,0.025)" />
            <Shard x={w * 0.60} y={h * 0.34} w={w * 0.70} h={h * 0.28} angle={-24} skew={7} fill="rgba(255,255,255,0.018)" />
            <Shard x={-w * 0.15} y={h * 0.74} w={w * 0.90} h={h * 0.32} angle={7} skew={-8} fill="rgba(255,255,255,0.028)" />
            <Shard x={w * 0.40} y={h * 0.80} w={w * 0.80} h={h * 0.30} angle={-13} skew={4} fill="rgba(255,255,255,0.022)" />

            {/* Light leaking through the cracks — hue shifts top → bottom */}
            <Seam x={w * 0.02} y={h * 0.115} len={w * 0.52} angle={-16} color={top} delay={0} dur={4600} reduced={reduced} />
            <Seam x={w * 0.55} y={h * 0.075} len={w * 0.48} angle={11} color={top} thickness={1.5} delay={1200} dur={5200} reduced={reduced} />
            <Seam x={w * 0.68} y={h * 0.22} len={w * 0.30} angle={64} color={mid} thickness={1.5} delay={2600} dur={3800} reduced={reduced} />
            <Seam x={-w * 0.04} y={h * 0.40} len={w * 0.44} angle={27} color={mid} delay={800} dur={4200} reduced={reduced} />
            <Seam x={w * 0.62} y={h * 0.47} len={w * 0.42} angle={-24} color={mid} thickness={1.5} delay={2000} dur={5600} reduced={reduced} />
            <Seam x={w * 0.06} y={h * 0.62} len={w * 0.26} angle={80} color={low} thickness={1.5} delay={3400} dur={4400} reduced={reduced} />
            <Seam x={w * 0.10} y={h * 0.83} len={w * 0.58} angle={7} color={low} delay={400} dur={4800} reduced={reduced} />
            <Seam x={w * 0.52} y={h * 0.90} len={w * 0.46} angle={-13} color={low} thickness={2.5} delay={1600} dur={4000} reduced={reduced} />
        </View>
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
        if (IS_WEB) return; // web uses CSS keyframes below
        const a = Animated.loop(
            Animated.timing(slide, {
                toValue: 1, duration, delay,
                easing: Easing.bezier(0.4, 0, 0.6, 1), useNativeDriver: true,
            })
        );
        const w = Animated.loop(
            Animated.sequence([
                Animated.timing(wobble, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
                Animated.timing(wobble, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            ])
        );
        a.start(); w.start();
        return () => { a.stop(); w.stop(); };
    }, []);

    const body = (
        <>
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
        </>
    );

    if (IS_WEB) {
        return (
            <div
                className="gt-streak"
                style={{
                    position: 'absolute', left: x, top: 0, opacity: 0,
                    '--dur': `${duration}ms`,
                    '--delay': `${-delay}ms`,
                }}
            >
                {body}
            </div>
        );
    }

    const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-tail, screenH + tail] });
    const translateX = wobble.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] });
    const opacity = slide.interpolate({ inputRange: [0, 0.06, 0.9, 1], outputRange: [0, 1, 1, 0] });

    return (
        <Animated.View style={{ position: 'absolute', left: x, top: 0, opacity, transform: [{ translateY }, { translateX }] }}>
            {body}
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
    const { width, height } = useWindowDimensions();

    // The logo IS the hero — no containing disc, just the 3D glass pin, big.
    // Width-driven (~3x the old 150px); the ScrollView absorbs any overflow on
    // short viewports so the form never gets crushed.
    const logoSize = Math.min(width * 0.92, 440);

    // Staggered entrance: card and footer ease out; the logo gets a Remotion-style
    // spring (their default physics: mass 1, stiffness 100, damping 10 — softened a
    // touch so the overshoot reads as glass, not rubber).
    const logoSpring = useRef(new Animated.Value(0)).current;
    const stages = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
    // Slow breathing on the logo itself (scale only — no glow disc)
    const breath = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (IS_WEB) return; // web uses CSS keyframes below
        Animated.spring(logoSpring, {
            toValue: 1, mass: 1, stiffness: 100, damping: 14,
            useNativeDriver: true,
        }).start();
        Animated.stagger(80, stages.map((s, i) =>
            Animated.timing(s, { toValue: 1, duration: 450, delay: 120, easing: EASE_OUT, useNativeDriver: true })
        )).start();
        if (!reduced) {
            const b = Animated.loop(Animated.sequence([
                Animated.timing(breath, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
                Animated.timing(breath, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
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

    const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

    return (
        <View style={rl.root}>
            {/* Injected keyframes driving all decorative motion on web */}
            {IS_WEB && <style>{WEB_CSS}</style>}
            {/* Night canvas */}
            <LinearGradient colors={v.canvas} style={StyleSheet.absoluteFillObject} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} />
            {/* Liquid-glass shapes drifting in the far background */}
            <FloatingShapes voice={voice} reduced={reduced} />
            {/* Rain in the world outside — desaturated ice tint, not neon */}
            <FallingRain accent={v.rainTint} reduced={reduced} />
            {/* Streaks sliding down the window we're looking through */}
            <GlassStreaks reduced={reduced} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={rl.kav}>
                <ScrollView
                    contentContainerStyle={rl.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                <View style={rl.content}>
                    {/* Logo — springs in (0.8 → overshoot → 1), then breathes */}
                    {(() => {
                        const logoContent = (
                            <>
                                {logoSource ? (
                                    <Image source={logoSource} style={{ width: logoSize, height: logoSize }} resizeMode="contain" />
                                ) : null}
                                {/* The logo art's pin tip sits ~26% above the image bottom (transparent
                                    padding in the PNG) — pull the text up so it lands 5px under the tip. */}
                                {title ? <Text style={[rl.title, { color: ICE, marginTop: -logoSize * 0.26 + 5 }]}>{title}</Text> : null}
                                {subtitle ? <Text style={[rl.subtitle, { color: v.metal, marginTop: title ? 4 : -logoSize * 0.26 + 5 }]}>{subtitle}</Text> : null}
                            </>
                        );
                        const blockStyle = [rl.logoBlock, !title && !subtitle && { marginBottom: -logoSize * 0.26 + 17 }];
                        if (IS_WEB) {
                            const col = { display: 'flex', flexDirection: 'column', alignItems: 'center' };
                            return (
                                <View style={blockStyle}>
                                    <div className="gt-logo-in" style={col}>
                                        <div className="gt-breath" style={col}>{logoContent}</div>
                                    </div>
                                </View>
                            );
                        }
                        return (
                            <Animated.View style={[...blockStyle, {
                                opacity: logoSpring.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
                                transform: [{ scale: Animated.multiply(
                                    logoSpring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }),
                                    breathScale
                                ) }],
                            }]}>
                                {logoContent}
                            </Animated.View>
                        );
                    })()}

                    {/* Crystal card */}
                    {(() => {
                        const card = (
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
                        );
                        if (IS_WEB) {
                            return <div className="gt-enter" style={{ '--delay': '120ms' }}>{card}</div>;
                        }
                        return <Animated.View style={enter(stages[0])}>{card}</Animated.View>;
                    })()}

                    {/* Footer links */}
                    {footer ? (
                        IS_WEB
                            ? <div className="gt-enter" style={{ '--delay': '200ms' }}><View style={rl.footer}>{footer}</View></div>
                            : <Animated.View style={[rl.footer, enter(stages[1])]}>{footer}</Animated.View>
                    ) : null}
                </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const rl = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07070F' },
    kav: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center' },
    content: { paddingHorizontal: 24, paddingVertical: 24, maxWidth: 460, width: '100%', alignSelf: 'center' },
    logoBlock: { alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 24, fontWeight: '800', letterSpacing: 3, marginTop: 0, textAlign: 'center' },
    subtitle: { fontSize: 11, fontWeight: '700', letterSpacing: 4, textTransform: 'uppercase', marginTop: 4, textAlign: 'center' },
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
