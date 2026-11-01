import React from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CrystalFace, LIP, shade, SPACE, tick, Txt, useKeyPress, useTheme } from '../ui/kit';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// A bright key with a 3D lip that drops when pressed. One component for every
// tile in the app (Home services, the Services tab, the You tab) so they all
// press and look the same.
//   size="square": icon key with the label underneath (4 to a row)
//   size="wide":   icon bubble + title + subtitle in one chunky card (2 to a row)
export function KeyTile({
    title, subtitle, icon, color, onPress, size = 'square', locked,
}: {
    title: string;
    subtitle?: string;
    icon: IconName;
    color: string;
    onPress: () => void;
    size?: 'square' | 'wide';
    locked?: boolean;
}) {
    const m = useTheme();
    const night = m.key === 'night';
    const { translateY, onPressIn, onPressOut } = useKeyPress();
    const press = () => { tick(); onPress(); };

    if (size === 'square') {
        return (
            <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={press} onPressIn={onPressIn} onPressOut={onPressOut} style={{ alignItems: 'center' }}>
                <View style={{ alignSelf: 'stretch', borderRadius: 20, backgroundColor: shade(color) }}>
                    <Animated.View style={{ height: 64, borderRadius: 20, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginBottom: LIP + 1, transform: [{ translateY }] }}>
                        <CrystalFace color={color} radius={20} />
                        <Ionicons name={locked ? 'lock-closed' : icon} size={26} color="#FFFFFF" />
                    </Animated.View>
                </View>
                <Txt variant="label" numberOfLines={1} style={{ marginTop: 6 }}>{title}</Txt>
            </Pressable>
        );
    }

    const face = night ? '#2A2238' : '#FFFFFF';
    const edge = night ? '#3A3049' : '#ECE6F3';
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={press} onPressIn={onPressIn} onPressOut={onPressOut}>
            <View style={{ borderRadius: 20, backgroundColor: edge }}>
                <Animated.View style={{ minHeight: 104, borderRadius: 20, backgroundColor: face, borderWidth: 2, borderColor: edge, padding: SPACE.md, marginBottom: LIP, transform: [{ translateY }] }}>
                    <View style={{ width: 40, height: 40, borderRadius: 13, overflow: 'hidden', backgroundColor: color, borderBottomWidth: 3, borderBottomColor: shade(color), alignItems: 'center', justifyContent: 'center' }}>
                        <CrystalFace color={color} radius={13} />
                        <Ionicons name={locked ? 'lock-closed' : icon} size={20} color="#FFFFFF" />
                    </View>
                    <Txt variant="headline" numberOfLines={1} style={{ marginTop: SPACE.sm }}>{title}</Txt>
                    {subtitle ? <Txt variant="caption" tone="dim" numberOfLines={1}>{subtitle}</Txt> : null}
                </Animated.View>
            </View>
        </Pressable>
    );
}
