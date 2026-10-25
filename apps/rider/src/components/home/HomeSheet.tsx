import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS, SharedValue, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion,
    useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { RADIUS, SPACE, GUTTER, tick, useTheme } from '../../ui/kit';
import { pickSnap, sheetSnaps } from './sheetSnap';

// The Home "Where to?" sheet: drags between three stops over the live map.
//   peek: `top` only (Where-to + shop cards) so the map gets the screen
//   half: plus the first part of `children` (chips, services)
//   full: everything; the inside scrolls only here
//
// Drag runs on the UI thread (gesture-handler + reanimated) so it stays smooth
// while the JS thread is busy. The parent is told the settled height (not
// every frame) so it can pad the map; `height` is a shared value for things
// that should follow the drag live (the pickup pin).
const SPRING = { damping: 26, stiffness: 260, mass: 0.9 };

export function HomeSheet({
    available, top, children, height, onSettled, bottomInset = 0,
}: {
    available: number;                 // tallest the sheet may get
    top: React.ReactNode;              // always visible (peek)
    children: React.ReactNode;         // revealed at half / full
    height: SharedValue<number>;       // live sheet height (px showing)
    onSettled?: (h: number) => void;   // called when the sheet comes to rest
    bottomInset?: number;
}) {
    const m = useTheme();
    const reduced = useReducedMotion();
    const [peekH, setPeekH] = useState(0);
    const snaps = useMemo(() => sheetSnaps({ available, peek: peekH || Math.min(260, available * 0.4) }), [available, peekH]);
    const [atFull, setAtFull] = useState(false);
    const scrollY = useSharedValue(0);
    const start = useSharedValue(0);
    const snapsSV = useSharedValue<number[]>(snaps);

    const settle = useCallback((h: number) => {
        setAtFull(h >= snaps[2] - 1);
        onSettled?.(h);
    }, [snaps, onSettled]);

    const animateTo = useCallback((h: number) => {
        'worklet';
        const done = (finished?: boolean) => { 'worklet'; if (finished) runOnJS(settle)(h); };
        height.value = reduced ? withTiming(h, { duration: 0 }, done) : withSpring(h, SPRING, done);
    }, [reduced, settle]);

    // Start at peek once the peek block has been measured; keep the current
    // stop if the screen size changes.
    // The first real measurement of the peek block always lands on peek.
    const placed = useRef(false);
    useEffect(() => {
        snapsSV.value = snaps;
        const cur = height.value;
        const first = !placed.current && peekH > 0;
        if (first) placed.current = true;
        const target = first || cur <= 0 ? snaps[0] : snaps.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
        height.value = target;
        settle(target);
    }, [snaps]);

    const onTopLayout = (e: LayoutChangeEvent) => {
        // handle (24) + top block + the gap before the scroll content starts,
        // so nothing from the half stop peeks out under the cards.
        const h = Math.ceil(24 + e.nativeEvent.layout.height + SPACE.sm + bottomInset);
        if (Math.abs(h - peekH) > 2) setPeekH(h);
    };

    const native = Gesture.Native();
    const pan = Gesture.Pan()
        .activeOffsetY([-8, 8])
        // A sideways swipe (the shop cards) must never drag the sheet.
        .failOffsetX([-12, 12])
        .simultaneousWithExternalGesture(native)
        .onBegin(() => { start.value = height.value; })
        .onUpdate((e) => {
            const s = snapsSV.value;
            const full = s[s.length - 1];
            // At full with the list scrolled, the drag belongs to the list.
            if (start.value >= full - 1 && (scrollY.value > 0 || e.translationY < 0)) return;
            const next = start.value - e.translationY;
            // Rubber-band a little past either end instead of a hard stop.
            const lo = s[0], hi = full;
            height.value = next < lo ? lo - (lo - next) * 0.25 : next > hi ? hi + (next - hi) * 0.15 : next;
        })
        .onEnd((e) => {
            const s = snapsSV.value;
            const full = s[s.length - 1];
            if (start.value >= full - 1 && scrollY.value > 0) return;
            animateTo(pickSnap(s, height.value, -e.velocityY));
        });

    const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, available - height.value) }] }));

    // Tapping the handle steps through the stops (and is the accessible way to
    // move the sheet without dragging).
    const cycle = () => {
        tick();
        const cur = height.value;
        const i = snaps.findIndex(s => Math.abs(s - cur) < 4);
        animateTo(snaps[(i + 1) % snaps.length] ?? snaps[0]);
    };

    return (
        <GestureDetector gesture={pan}>
            <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, height: available }, sheetStyle]}>
                {m.glow ? (
                    <LinearGradient pointerEvents="none" colors={m.glow as any} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                        style={{ position: 'absolute', left: 0, right: 0, top: -60, height: 90, opacity: 0.55 }} />
                ) : null}
                <LinearGradient
                    colors={m.sheet as any}
                    style={{
                        flex: 1, borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
                        borderWidth: 1, borderBottomWidth: 0, borderColor: m.sheetBorder,
                        shadowColor: '#000', shadowOpacity: m.shadowOpacity, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 16,
                    }}
                >
                    <Pressable accessibilityRole="adjustable" accessibilityLabel="Move the sheet" accessibilityHint="Shows more or less of the map"
                        onPress={cycle} hitSlop={8} style={{ height: 24, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: m.chipBorder }} />
                    </Pressable>
                    <View onLayout={onTopLayout} style={{ paddingHorizontal: GUTTER }}>{top}</View>
                    <GestureDetector gesture={native}>
                        <Animated.ScrollView
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            scrollEnabled={atFull}
                            bounces={false}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            style={{ flex: 1 }}
                            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl + bottomInset }}
                        >
                            {children}
                        </Animated.ScrollView>
                    </GestureDetector>
                </LinearGradient>
            </Animated.View>
        </GestureDetector>
    );
}
