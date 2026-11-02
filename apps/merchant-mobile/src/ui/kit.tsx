import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mood, type as T, useMood, useStyles } from './mood';

type IconName = keyof typeof Ionicons.glyphMap;
const LIP = 5;

// A key that presses into its lip, the way a Duolingo button does.
export function GoldKey({ label, sub, icon, onPress, busy, disabled, style, tone = 'gold', trailing }: {
    label: string; sub?: string; icon?: IconName; onPress: () => void; busy?: boolean; disabled?: boolean;
    style?: StyleProp<ViewStyle>; tone?: 'gold' | 'plain'; trailing?: IconName;
}) {
    const m = useMood();
    const s = useStyles(makeStyles);
    const y = useRef(new Animated.Value(0)).current;
    const off = busy || disabled;
    const press = (to: number) => Animated.spring(y, { toValue: to, speed: 60, bounciness: 8, useNativeDriver: true }).start();
    const ink = tone === 'gold' ? m.onGold : m.ink;

    return (
        <Pressable
            style={[{ opacity: off ? 0.55 : 1 }, style]}
            disabled={off}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
            onPressIn={() => press(LIP - 1)}
            onPressOut={() => press(0)}
            accessibilityRole="button"
            accessibilityLabel={sub ? `${label}. ${sub}` : label}
            accessibilityState={{ disabled: !!off, busy: !!busy }}
        >
            <View style={[s.lip, { backgroundColor: tone === 'gold' ? m.goldLip : m.raised }]} />
            <Animated.View style={{ transform: [{ translateY: y }] }}>
                {tone === 'gold' ? (
                    <LinearGradient colors={m.goldFace as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.face, sub ? s.faceTall : null]}>
                        <KeyBody label={label} sub={sub} icon={icon} busy={busy} ink={ink} trailing={trailing} />
                    </LinearGradient>
                ) : (
                    <View style={[s.face, sub ? s.faceTall : null, s.plain]}>
                        <KeyBody label={label} sub={sub} icon={icon} busy={busy} ink={ink} trailing={trailing} />
                    </View>
                )}
            </Animated.View>
        </Pressable>
    );
}

function KeyBody({ label, sub, icon, busy, ink, trailing }: { label: string; sub?: string; icon?: IconName; busy?: boolean; ink: string; trailing?: IconName }) {
    if (busy) return <ActivityIndicator color={ink} />;
    return (
        <>
            {icon ? <Ionicons name={icon} size={sub ? 28 : 20} color={ink} /> : null}
            <View style={{ flexShrink: 1, flexGrow: sub ? 1 : 0 }}>
                <Text style={[sub ? T.heading : T.strong, { color: ink }]} numberOfLines={1}>{label}</Text>
                {sub ? <Text style={[T.small, { color: ink, opacity: 0.8 }]} numberOfLines={1}>{sub}</Text> : null}
            </View>
            {trailing ? <Ionicons name={trailing} size={22} color={ink} /> : null}
        </>
    );
}

export function PageHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    const m = useMood();
    const s = useStyles(makeStyles);
    return (
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
            {onBack && (
                <TouchableOpacity onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Go back">
                    <Ionicons name="chevron-back" size={26} color={m.ink} />
                </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
                <Text style={[T.title, { color: m.ink }]} numberOfLines={1}>{title}</Text>
                {sub ? <Text style={[T.body, { color: m.dim }]} numberOfLines={2}>{sub}</Text> : null}
            </View>
            {right}
        </View>
    );
}

export function Card({ children, style, highlight }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; highlight?: boolean }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    return (
        <View style={[s.card, highlight && { borderColor: m.gold, borderBottomColor: m.goldLip }, style]}>{children}</View>
    );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    return (
        <View style={s.field}>
            <Text style={[T.small, { color: m.dim, marginBottom: 6 }]}>{label}</Text>
            <TextInput style={s.input} placeholderTextColor={m.dim} accessibilityLabel={label} {...props} />
        </View>
    );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    return (
        <TouchableOpacity style={[s.chip, on && { borderColor: m.gold, backgroundColor: m.goldWash }]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[T.small, { color: on ? m.ink : m.dim }]}>{label}</Text>
        </TouchableOpacity>
    );
}

export function Empty({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    return (
        <View style={s.empty}>
            <View style={s.emptyIcon}><Ionicons name={icon} size={34} color={m.gold} /></View>
            <Text style={[T.heading, { color: m.ink, textAlign: 'center', marginTop: 12 }]}>{title}</Text>
            {body ? <Text style={[T.body, { color: m.dim, textAlign: 'center', marginTop: 4 }]}>{body}</Text> : null}
        </View>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    lip: { position: 'absolute', left: 0, right: 0, bottom: 0, top: LIP, borderRadius: 18 },
    face: { minHeight: 52, marginBottom: LIP, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
    faceTall: { minHeight: 78, justifyContent: 'flex-start', paddingHorizontal: 20 },
    plain: { backgroundColor: m.card, borderWidth: 2, borderColor: m.line },
    header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 12 },
    back: { width: 34, height: 44, justifyContent: 'center' },
    card: { padding: 16, borderRadius: 22, backgroundColor: m.card, borderWidth: 2, borderColor: m.line, borderBottomWidth: 5, borderBottomColor: m.raised },
    field: { marginBottom: 12 },
    input: { minHeight: 54, paddingHorizontal: 16, borderRadius: 16, fontSize: 16, fontFamily: 'Nunito_700Bold', color: m.ink, backgroundColor: m.card, borderWidth: 2, borderColor: m.line },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: m.card, borderWidth: 2, borderColor: m.line },
    empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 28 },
    emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: m.goldWash },
});
