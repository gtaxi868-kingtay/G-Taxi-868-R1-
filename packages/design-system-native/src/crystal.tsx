import React from 'react';
import { StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// The G 868 crystal, cut for a key: a lit-to-deep body, one angled facet, a
// rim and a specular glint, the same layers as the logo on the site. Every app
// shares this cut; each brings its own colour (rider violet-cyan, driver green
// and gold, merchant teal and copper, admin violet on slate).

type IconName = keyof typeof Ionicons.glyphMap;

function mix(hex: string, toward: number, amt: number): string {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (toward - c) * amt)));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
export const lighten = (hex: string, amt = 0.35) => mix(hex, 255, amt);
const deepen = (hex: string, amt = 0.28) => mix(hex, 0, amt);

function Facets({ radius }: { radius: number }) {
    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderRadius: radius, overflow: 'hidden' }]}>
            <LinearGradient colors={['rgba(103,232,249,0.34)', 'rgba(103,232,249,0)', 'rgba(192,132,252,0.36)']}
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
            <View style={{ position: 'absolute', top: '-70%', left: '12%', width: '26%', height: '240%', backgroundColor: 'rgba(255,255,255,0.14)', transform: [{ rotate: '24deg' }] }} />
            <View style={{ position: 'absolute', top: '-70%', left: '46%', width: '9%', height: '240%', backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ rotate: '24deg' }] }} />
            <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: radius, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.42)' }} />
            <View style={{ position: 'absolute', top: 5, left: '14%', right: '40%', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.72)' }} />
        </View>
    );
}

export function CrystalFace({ color, radius }: { color: string; radius: number }) {
    return (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderRadius: radius, overflow: 'hidden' }]}>
            <LinearGradient colors={[lighten(color, 0.3), color, deepen(color)]} locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
            <Facets radius={radius} />
        </View>
    );
}

// A gradient surface cut as crystal: use it anywhere a brand gradient is
// something you press or a card you read from.
export function CrystalGradient({ children, ...props }: React.ComponentProps<typeof LinearGradient>) {
    const flat = StyleSheet.flatten(props.style) as ViewStyle | undefined;
    const radius = typeof flat?.borderRadius === 'number' ? flat.borderRadius : 0;
    return (
        <LinearGradient {...props} style={[props.style, { overflow: 'hidden' }]}>
            <Facets radius={radius} />
            {children}
        </LinearGradient>
    );
}

// Text and icons on crystal stand proud of the surface, like the logo's G.
export const RAISED: TextStyle = {
    textShadowColor: 'rgba(32,18,96,0.6)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 1,
};

export function RaisedIcon({ name, size, color = '#FFFFFF' }: { name: IconName; size: number; color?: string }) {
    return (
        <View style={{ width: size, height: size }}>
            <Ionicons name={name} size={size} color="rgba(32,18,96,0.6)" style={{ position: 'absolute', top: 2, left: 0 }} />
            <Ionicons name={name} size={size} color={color} style={{ position: 'absolute', top: 0, left: 0 }} />
        </View>
    );
}
