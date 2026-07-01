import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView,
    LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

export interface Layer {
    id: string;
    name: string;
    sub?: string;
    accent: string;
    icon: string;
    search?: string;
    locked?: boolean;
    progress?: number;
    need?: number;
    label?: string;
}

interface Props {
    layers: Layer[];
    onPrimary: (layer: Layer) => void;
    onActiveChange?: (layer: Layer) => void;
}

const H_PAD = 20;
const GAP = 12;

function hexA(hex: string, a: number) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Swipeable "layer" deck. One card per unlocked vertical + an optional locked
 * teaser. Horizontal paging switches the active layer; the pager doubles as the
 * level meter. Edge glow tabs hint the neighbour layer's accent colour — no card
 * bleed. Native scroll deceleration gives the spring-like snap; the glow opacity
 * tracks scroll position so the colour pulls toward the layer waiting that way.
 */
export function LayerDeck({ layers, onPrimary, onActiveChange }: Props) {
    const [width, setWidth] = useState(0);
    const [active, setActive] = useState(0);
    const scrollX = useRef(new Animated.Value(0)).current;
    const scrollRef = useRef<ScrollView>(null);

    const cardW = width > 0 ? width - H_PAD * 2 : 0;
    const interval = cardW + GAP;

    const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

    // Keep the active index valid when layers grow/shrink (e.g. a layer unlocks).
    useEffect(() => {
        if (active > layers.length - 1) {
            const next = Math.max(0, layers.length - 1);
            setActive(next);
            scrollRef.current?.scrollTo({ x: next * interval, animated: false });
        }
    }, [layers.length]);

    const goTo = useCallback((i: number) => {
        const clamped = Math.max(0, Math.min(layers.length - 1, i));
        Haptics.selectionAsync();
        scrollRef.current?.scrollTo({ x: clamped * interval, animated: true });
    }, [interval, layers.length]);

    const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (interval <= 0) return;
        const idx = Math.round(e.nativeEvent.contentOffset.x / interval);
        const clamped = Math.max(0, Math.min(layers.length - 1, idx));
        if (clamped !== active) {
            setActive(clamped);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onActiveChange?.(layers[clamped]);
        }
    };

    const hasLeft = active > 0;
    const hasRight = active < layers.length - 1;
    const leftAccent = hasLeft ? layers[active - 1].accent : VOICES.rider.accent;
    const rightAccent = hasRight ? layers[active + 1].accent : VOICES.rider.accent;

    const leftOpacity = scrollX.interpolate({
        inputRange: [(active - 1) * interval, active * interval],
        outputRange: [0.9, 0.32],
        extrapolate: 'clamp',
    });
    const rightOpacity = scrollX.interpolate({
        inputRange: [active * interval, (active + 1) * interval],
        outputRange: [0.32, 0.9],
        extrapolate: 'clamp',
    });

    return (
        <View onLayout={onLayout}>
            <View style={s.deck}>
                {/* Edge glow tabs — the neighbour layer's colour, reacting to scroll */}
                {hasLeft && cardW > 0 && (
                    <Animated.View pointerEvents="none" style={[s.glow, s.glowL, { opacity: leftOpacity }]}>
                        <LinearGradient colors={[hexA(leftAccent, 0.55), 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    </Animated.View>
                )}
                {hasRight && cardW > 0 && (
                    <Animated.View pointerEvents="none" style={[s.glow, s.glowR, { opacity: rightOpacity }]}>
                        <LinearGradient colors={['transparent', hexA(rightAccent, 0.55)]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    </Animated.View>
                )}

                {cardW > 0 && (
                    <Animated.ScrollView
                        ref={scrollRef}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={interval}
                        decelerationRate="fast"
                        disableIntervalMomentum
                        contentContainerStyle={{ paddingHorizontal: H_PAD }}
                        scrollEventThrottle={16}
                        onScroll={Animated.event(
                            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                            { useNativeDriver: true }
                        )}
                        onMomentumScrollEnd={onMomentumEnd}
                    >
                        {layers.map((layer, i) => (
                            <View key={layer.id} style={{ width: cardW, marginRight: i === layers.length - 1 ? 0 : GAP }}>
                                {layer.locked ? (
                                    <View style={s.lockedCard} accessibilityLabel={`${layer.name} locked. ${layer.need && layer.progress != null ? `${layer.need - layer.progress} more ${layer.label || 'rides'} to unlock.` : ''}`}>
                                        <View style={s.lockIcon}>
                                            <Ionicons name="lock-closed" size={18} color="rgba(242,245,248,0.55)" />
                                        </View>
                                        <Text style={s.lockTitle}>{layer.name}</Text>
                                        {layer.need != null && layer.progress != null ? (
                                            <>
                                                <View style={s.lockTrack}>
                                                    <View style={[s.lockFill, { width: `${Math.min(100, (layer.progress / layer.need) * 100)}%`, backgroundColor: layer.accent }]} />
                                                </View>
                                                <Text style={s.lockMeta}>
                                                    {layer.need - layer.progress > 0
                                                        ? `${layer.need - layer.progress} more ${layer.label || 'rides'} to unlock`
                                                        : 'Unlocking…'}
                                                </Text>
                                            </>
                                        ) : (
                                            <Text style={s.lockMeta}>Keep riding to unlock</Text>
                                        )}
                                    </View>
                                ) : (
                                    <TouchableOpacity
                                        activeOpacity={0.88}
                                        onPress={() => onPrimary(layer)}
                                        accessibilityLabel={`${layer.name}. ${layer.sub || ''}`}
                                        accessibilityRole="button"
                                    >
                                        <LinearGradient
                                            colors={[hexA(layer.accent, 0.16), hexA(layer.accent, 0.04)]}
                                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                            style={[s.card, { borderColor: hexA(layer.accent, 0.22) }]}
                                        >
                                            <View style={s.cardHead}>
                                                <View style={[s.cardIcon, { backgroundColor: hexA(layer.accent, 0.2) }]}>
                                                    <Ionicons name={layer.icon as any} size={22} color={layer.accent} />
                                                </View>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={s.cardTitle}>{layer.name}</Text>
                                                    <Text style={s.cardSub} numberOfLines={1}>{layer.sub}</Text>
                                                </View>
                                            </View>
                                            <View style={s.cardSearch}>
                                                <Ionicons name="search" size={16} color={layer.accent} />
                                                <Text style={s.cardSearchText}>{layer.search}</Text>
                                            </View>
                                        </LinearGradient>
                                    </TouchableOpacity>
                                )}
                            </View>
                        ))}
                    </Animated.ScrollView>
                )}
            </View>

            {/* Pager = level meter */}
            <View style={s.pager}>
                {layers.map((layer, i) => {
                    if (layer.locked && layer.need != null) {
                        return <View key={layer.id} style={[s.dot, { backgroundColor: layer.accent, opacity: 0.45 }]} />;
                    }
                    if (layer.locked) {
                        return (
                            <View key={layer.id} style={s.dotLock}>
                                <Ionicons name="lock-closed" size={10} color="rgba(242,245,248,0.4)" />
                            </View>
                        );
                    }
                    const on = i === active;
                    return (
                        <TouchableOpacity
                            key={layer.id}
                            onPress={() => goTo(i)}
                            accessibilityLabel={`Go to ${layer.name}, layer ${i + 1} of ${layers.length}`}
                            accessibilityRole="button"
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                        >
                            <View style={[s.dot, on && s.dotOn, { backgroundColor: layer.accent, opacity: on ? 1 : 0.5 }]} />
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    deck: { position: 'relative' },
    glow: { position: 'absolute', top: 0, bottom: 0, width: 28, zIndex: 5, borderRadius: 22 },
    glowL: { left: 0 },
    glowR: { right: 0 },

    card: {
        height: 144,
        borderRadius: 22,
        padding: 16,
        borderWidth: 1,
        justifyContent: 'space-between',
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    cardTitle: { fontSize: 18, fontWeight: '800', color: '#EAF3F6', letterSpacing: -0.3 },
    cardSub: { fontSize: 11, color: 'rgba(242,245,248,0.5)', marginTop: 1 },
    cardSearch: {
        height: 44, borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.07)',
        ...ghostBorder(0.12),
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13,
    },
    cardSearchText: { fontSize: 13, color: 'rgba(242,245,248,0.55)' },

    lockedCard: {
        height: 144,
        borderRadius: 22,
        backgroundColor: '#161B22',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
    },
    lockIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    lockTitle: { fontSize: 13, fontWeight: '800', color: '#EAF3F6' },
    lockTrack: { width: 140, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
    lockFill: { height: 5, borderRadius: 3 },
    lockMeta: { fontSize: 10, color: 'rgba(242,245,248,0.5)', fontWeight: '600' },

    pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, height: 16 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    dotOn: { width: 20, borderRadius: 4 },
    dotLock: { width: 13, height: 13, alignItems: 'center', justifyContent: 'center' },
});
