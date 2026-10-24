import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView,
    StyleProp, StyleSheet, Text as RNText, TextInput, TextInputProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_GRADIENT, DAY, Mood, NIGHT, SERIF, useMood } from '../theme/mood';

// The rider app's shared parts (2026-10-24). Every screen is built from these
// so spacing, type, colour and safe areas are the same everywhere:
//   Screen  - background, status bar, safe areas, header, scroll, pinned footer
//   Header  - back button, title, optional right action
//   Button  - primary (brand gradient), secondary, ghost, danger
//   Field   - label + input + error
//   Row     - tappable list row with icon, title, subtitle, chevron
//   Card, Section, EmptyState, Chip, Txt
// Colours come from the day/night mood (theme/mood.ts), never hard-coded.

export type IconName = keyof typeof Ionicons.glyphMap;

const MoodContext = createContext<Mood>(DAY);

// Mount once at the root so the whole app turns to night together.
export function MoodProvider({ children, force }: { children: React.ReactNode; force?: 'day' | 'night' }) {
    const mood = useMood(force);
    return <MoodContext.Provider value={mood}>{children}</MoodContext.Provider>;
}

export function useTheme(): Mood {
    return useContext(MoodContext);
}

// Style sheets that follow the mood: const s = useStyles(makeStyles)
export function useStyles<T>(factory: (m: Mood) => T): T {
    const m = useTheme();
    return useMemo(() => factory(m), [m, factory]);
}

export { BRAND_GRADIENT, SERIF, DAY, NIGHT };
export type { Mood };

// ---- spacing and type scale -------------------------------------------------

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const GUTTER = 20;
export const RADIUS = { field: 16, card: 20, sheet: 28, pill: 999 } as const;

export const FONT = {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semibold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold',
    heavy: 'Manrope_800ExtraBold',
    serif: SERIF,
    // Rounded, friendly display face for headings (Duolingo-style warmth)
    round: 'Nunito_800ExtraBold',
    roundBlack: 'Nunito_900Black',
} as const;

type Variant = 'hero' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'overline';

const TYPE: Record<Variant, TextStyle> = {
    hero: { fontFamily: FONT.roundBlack, fontSize: 30, lineHeight: 36, letterSpacing: -0.2 },
    title: { fontFamily: FONT.round, fontSize: 22, lineHeight: 28 },
    headline: { fontFamily: FONT.round, fontSize: 17, lineHeight: 22 },
    body: { fontFamily: FONT.medium, fontSize: 15, lineHeight: 21 },
    bodyStrong: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 21 },
    caption: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 },
    label: { fontFamily: FONT.semibold, fontSize: 13, lineHeight: 18 },
    overline: { fontFamily: FONT.round, fontSize: 12, lineHeight: 16, letterSpacing: 0.8 },
};

export function Txt({
    variant = 'body', tone = 'ink', style, children, numberOfLines, ...rest
}: {
    variant?: Variant; tone?: 'ink' | 'dim' | 'faint' | 'accent' | 'danger' | 'success' | 'onBrand';
    style?: StyleProp<TextStyle>; children?: React.ReactNode; numberOfLines?: number;
} & Omit<React.ComponentProps<typeof RNText>, 'style'>) {
    const m = useTheme();
    const color = {
        ink: m.ink, dim: m.dim, faint: m.faint, accent: m.accent,
        danger: '#E5484D', success: '#2FB57C', onBrand: '#FFFFFF',
    }[tone];
    return <RNText {...rest} numberOfLines={numberOfLines} style={[TYPE[variant], { color }, style]}>{children}</RNText>;
}

// ---- press feedback -----------------------------------------------------------

function usePressScale() {
    const scale = useRef(new Animated.Value(1)).current;
    const onPressIn = () => Animated.spring(scale, { toValue: 0.95, speed: 40, bounciness: 0, useNativeDriver: true }).start();
    const onPressOut = () => Animated.spring(scale, { toValue: 1, speed: 14, bounciness: 12, useNativeDriver: true }).start();
    return { scale, onPressIn, onPressOut };
}

// Chunky "key" press: the face drops onto its lip, then springs back up.
const LIP = 4;
function useKeyPress() {
    const down = useRef(new Animated.Value(0)).current;
    const onPressIn = () => Animated.timing(down, { toValue: 1, duration: 70, useNativeDriver: true }).start();
    const onPressOut = () => Animated.spring(down, { toValue: 0, speed: 18, bounciness: 10, useNativeDriver: true }).start();
    const translateY = down.interpolate({ inputRange: [0, 1], outputRange: [0, LIP] });
    return { translateY, onPressIn, onPressOut };
}

// Darken a #RRGGBB colour for the 3D lip under a face.
export function shade(hex: string, amt = 0.22): string {
    const h = hex.replace('#', '');
    if (h.length !== 6) return 'rgba(0,0,0,0.25)';
    const n = parseInt(h, 16);
    const f = (c: number) => Math.max(0, Math.round(c * (1 - amt)));
    const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
    return `rgb(${r},${g},${b})`;
}

// Bouncy entrance for a block: pops up and settles. Use `delay` to stagger.
export function Pop({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
    const v = useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
        Animated.sequence([
            Animated.delay(delay),
            Animated.spring(v, { toValue: 1, speed: 12, bounciness: 9, useNativeDriver: true }),
        ]).start();
    }, []);
    return (
        <Animated.View style={[style, {
            opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transform: [
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
        }]}>
            {children}
        </Animated.View>
    );
}

// Rounded progress bar that fills with a spring.
export function Progress({ value, color = '#8B7CFF', height = 12 }: { value: number; color?: string; height?: number }) {
    const m = useTheme();
    const w = useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
        Animated.spring(w, { toValue: Math.max(0, Math.min(1, value)), speed: 6, bounciness: 6, useNativeDriver: false }).start();
    }, [value]);
    return (
        <View style={{ height, borderRadius: height / 2, backgroundColor: m.field, overflow: 'hidden' }}>
            <Animated.View style={{ height, borderRadius: height / 2, backgroundColor: color, width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}>
                <View style={{ position: 'absolute', top: 3, left: 6, right: 6, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            </Animated.View>
        </View>
    );
}

// ---- Screen -------------------------------------------------------------------

export function Screen({
    title, onBack, right, children, footer, scroll = true, padded = true, hero, contentStyle, refreshControl,
}: {
    title?: string;
    onBack?: () => void;            // shows the back button when set
    right?: React.ReactNode;        // header right action
    children: React.ReactNode;
    footer?: React.ReactNode;       // pinned to the bottom (main action); content never hides under it
    scroll?: boolean;
    padded?: boolean;
    hero?: React.ReactNode;         // big serif heading under the header
    contentStyle?: StyleProp<ViewStyle>;
    refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    const [footerH, setFooterH] = useState(0);
    const bottomPad = footer ? footerH + SPACE.lg : Math.max(insets.bottom, SPACE.lg) + SPACE.xl;

    const body = (
        <>
            {hero ? <View style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl }}>{hero}</View> : null}
            <View style={[padded && { paddingHorizontal: GUTTER }, contentStyle]}>{children}</View>
        </>
    );

    return (
        <View style={{ flex: 1, backgroundColor: m.page }}>
            <StatusBar style={m.statusBar} />
            {(title !== undefined || onBack || right) ? (
                <Header title={title} onBack={onBack} right={right} />
            ) : <View style={{ height: insets.top }} />}
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {scroll ? (
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingBottom: bottomPad }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        refreshControl={refreshControl}
                    >
                        {body}
                    </ScrollView>
                ) : (
                    <View style={{ flex: 1, paddingBottom: footer ? footerH : 0 }}>{body}</View>
                )}
                {footer ? (
                    <View
                        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
                        style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0,
                            paddingHorizontal: GUTTER, paddingTop: SPACE.md,
                            paddingBottom: Math.max(insets.bottom, SPACE.lg),
                            backgroundColor: m.page, borderTopWidth: 1, borderTopColor: m.chipBorder,
                        }}
                    >
                        {footer}
                    </View>
                ) : null}
            </KeyboardAvoidingView>
        </View>
    );
}

export function Header({ title, onBack, right }: { title?: string; onBack?: () => void; right?: React.ReactNode }) {
    const m = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <View style={{ paddingTop: insets.top + SPACE.sm, paddingHorizontal: GUTTER - 4, paddingBottom: SPACE.sm, flexDirection: 'row', alignItems: 'center', minHeight: insets.top + 56 }}>
            <View style={{ width: 44 }}>
                {onBack ? <IconButton icon="chevron-back" label="Back" onPress={onBack} /> : null}
            </View>
            <Txt variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>{title ?? ''}</Txt>
            <View style={{ width: 44, alignItems: 'flex-end' }}>{right}</View>
        </View>
    );
}

export function IconButton({ icon, label, onPress, tone = 'plain' }: { icon: IconName; label: string; onPress?: () => void; tone?: 'plain' | 'filled' }) {
    const m = useTheme();
    const { scale, onPressIn, onPressOut } = usePressScale();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={8}>
            <Animated.View style={{
                width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                backgroundColor: tone === 'filled' ? m.sheet[1] : m.field, borderWidth: tone === 'filled' ? 1 : 0, borderColor: m.sheetBorder,
                transform: [{ scale }],
            }}>
                <Ionicons name={icon} size={20} color={m.ink} />
            </Animated.View>
        </Pressable>
    );
}

// ---- Button -------------------------------------------------------------------

export function Button({
    title, onPress, variant = 'primary', icon, loading, disabled, size = 'lg', style, color,
}: {
    title: string; onPress?: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    icon?: IconName; loading?: boolean; disabled?: boolean; size?: 'lg' | 'md' | 'sm';
    style?: StyleProp<ViewStyle>; color?: string;
}) {
    const m = useTheme();
    const { translateY, onPressIn, onPressOut } = useKeyPress();
    const h = size === 'lg' ? 56 : size === 'md' ? 48 : 38;
    const off = disabled || loading;
    const solid = variant === 'primary' || variant === 'danger';
    const faceColor = variant === 'danger' ? '#E5484D' : variant === 'primary' ? (color || '#8B7CFF') : variant === 'secondary' ? (m.key === 'day' ? '#FFFFFF' : '#2A2238') : 'transparent';
    const lipColor = variant === 'ghost' ? 'transparent' : solid ? shade(faceColor) : (m.key === 'day' ? '#DDD6E8' : '#140F1E');
    const fg = solid ? '#FFFFFF' : m.ink;
    const radius = size === 'sm' ? 14 : 18;
    const lip = variant === 'ghost' ? 0 : LIP;
    return (
        <Pressable
            accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!loading }}
            onPress={off ? undefined : () => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
            onPressIn={off ? undefined : onPressIn} onPressOut={off ? undefined : onPressOut}
            style={[{ opacity: off ? 0.5 : 1 }, style]}
        >
            <View style={{ height: h + lip, borderRadius: radius, backgroundColor: lipColor }}>
                <Animated.View style={{
                    height: h, borderRadius: radius, overflow: 'hidden', transform: [{ translateY: lip ? translateY : 0 }],
                    backgroundColor: faceColor,
                    borderWidth: variant === 'secondary' || variant === 'ghost' ? 2 : 0,
                    borderColor: variant === 'ghost' ? m.chipBorder : (m.key === 'day' ? '#E7E1F0' : '#3A3049'),
                }}>
                    {variant === 'primary' && !color ? (
                        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFillObject} />
                    ) : null}
                    {solid ? <View pointerEvents="none" style={{ position: 'absolute', top: 5, left: 14, right: 14, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' }} /> : null}
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xl }}>
                        {loading ? <ActivityIndicator color={fg} /> : (
                            <>
                                {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={fg} style={{ marginRight: SPACE.sm }} /> : null}
                                <RNText numberOfLines={1} style={{ color: fg, fontFamily: FONT.round, fontSize: size === 'sm' ? 14 : 17, letterSpacing: 0.3 }}>{title}</RNText>
                            </>
                        )}
                    </View>
                </Animated.View>
            </View>
        </Pressable>
    );
}

// Text-only link ("Forgot password?")
export function LinkText({ children, onPress, accent }: { children: React.ReactNode; onPress?: () => void; accent?: string }) {
    return (
        <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ paddingVertical: SPACE.sm, alignItems: 'center' }}>
            <Txt variant="body" tone="dim">{children}{accent ? <Txt variant="bodyStrong" tone="accent"> {accent}</Txt> : null}</Txt>
        </Pressable>
    );
}

// ---- Field --------------------------------------------------------------------

export function Field({ label, error, hint, icon, style, ...input }: TextInputProps & { label?: string; error?: string | null; hint?: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
    const m = useTheme();
    const [focused, setFocused] = useState(false);
    return (
        <View style={[{ marginBottom: SPACE.lg }, style]}>
            {label ? <Txt variant="label" tone="dim" style={{ marginBottom: SPACE.sm }}>{label}</Txt> : null}
            <View style={{
                flexDirection: 'row', alignItems: input.multiline ? 'flex-start' : 'center',
                minHeight: 54, borderRadius: RADIUS.field, paddingHorizontal: SPACE.lg,
                backgroundColor: m.field, borderWidth: 1.5,
                borderColor: error ? '#E5484D' : focused ? m.accent : 'transparent',
            }}>
                {icon ? <Ionicons name={icon} size={18} color={m.dim} style={{ marginRight: SPACE.md, marginTop: input.multiline ? 16 : 0 }} /> : null}
                <TextInput
                    placeholderTextColor={m.faint}
                    {...input}
                    onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
                    onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
                    style={[{ flex: 1, color: m.ink, fontFamily: FONT.medium, fontSize: 16, paddingVertical: 14 }, input.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
                />
            </View>
            {error ? <Txt variant="caption" tone="danger" style={{ marginTop: SPACE.xs }}>{error}</Txt>
                : hint ? <Txt variant="caption" tone="faint" style={{ marginTop: SPACE.xs }}>{hint}</Txt> : null}
        </View>
    );
}

// ---- Card / Row / Section -----------------------------------------------------

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
    const m = useTheme();
    const { scale, onPressIn, onPressOut } = usePressScale();
    const box: ViewStyle = {
        backgroundColor: m.key === 'day' ? '#FFFFFF' : m.tile, borderRadius: RADIUS.card,
        borderWidth: 2, borderBottomWidth: onPress ? 5 : 2, borderColor: m.key === 'day' ? '#ECE6F3' : 'rgba(255,255,255,0.08)', padding: SPACE.lg,
    };
    if (!onPress) return <View style={[box, style]}>{children}</View>;
    return (
        <Pressable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} onPressIn={onPressIn} onPressOut={onPressOut}>
            <Animated.View style={[box, style, { transform: [{ scale }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

export function Section({ title, action, children, style }: { title?: string; action?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    return (
        <View style={[{ marginTop: SPACE.xl }, style]}>
            {title ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.md }}>
                    <Txt variant="overline" tone="faint">{title.toUpperCase()}</Txt>
                    {action}
                </View>
            ) : null}
            {children}
        </View>
    );
}

export function Row({
    icon, title, subtitle, onPress, right, danger, last,
}: {
    icon?: IconName; title: string; subtitle?: string; onPress?: () => void;
    right?: React.ReactNode; danger?: boolean; last?: boolean;
}) {
    const m = useTheme();
    return (
        <Pressable
            accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title}
            onPress={onPress} disabled={!onPress}
            style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: SPACE.md,
                borderBottomWidth: last ? 0 : 1, borderBottomColor: m.chipBorder, opacity: pressed ? 0.7 : 1,
            })}
        >
            {icon ? (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center', marginRight: SPACE.md }}>
                    <Ionicons name={icon} size={19} color={danger ? '#E5484D' : m.accent} />
                </View>
            ) : null}
            <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" tone={danger ? 'danger' : 'ink'} numberOfLines={1}>{title}</Txt>
                {subtitle ? <Txt variant="caption" tone="dim" numberOfLines={2} style={{ marginTop: 2 }}>{subtitle}</Txt> : null}
            </View>
            {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={m.faint} /> : null)}
        </Pressable>
    );
}

export function Chip({ label, icon, selected, onPress }: { label: string; icon?: IconName; selected?: boolean; onPress?: () => void }) {
    const m = useTheme();
    const { scale, onPressIn, onPressOut } = usePressScale();
    const border = selected ? '#8B7CFF' : (m.key === 'day' ? '#E7E1F0' : 'rgba(255,255,255,0.10)');
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }} onPressIn={onPressIn} onPressOut={onPressOut}
            style={{ marginRight: SPACE.sm, marginBottom: SPACE.sm }}>
            <Animated.View style={{
                flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 14, borderRadius: 14,
                borderWidth: 2, borderBottomWidth: 4, borderColor: border,
                backgroundColor: selected ? (m.key === 'day' ? '#F1EEFF' : 'rgba(139,124,255,0.18)') : (m.key === 'day' ? '#FFFFFF' : m.chip),
                transform: [{ scale }],
            }}>
                {icon ? <Ionicons name={icon} size={15} color={selected ? '#8B7CFF' : m.accent} style={{ marginRight: 7 }} /> : null}
                <RNText style={{ fontFamily: FONT.round, fontSize: 14, color: selected ? '#8B7CFF' : m.ink }}>{label}</RNText>
            </Animated.View>
        </Pressable>
    );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
    const m = useTheme();
    return (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: SPACE.xl }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.lg }}>
                <Ionicons name={icon} size={28} color={m.accent} />
            </View>
            <Txt variant="headline" style={{ textAlign: 'center' }}>{title}</Txt>
            {body ? <Txt variant="body" tone="dim" style={{ textAlign: 'center', marginTop: SPACE.sm }}>{body}</Txt> : null}
            {action ? <View style={{ marginTop: SPACE.xl, alignSelf: 'stretch' }}>{action}</View> : null}
        </View>
    );
}

export function Loading() {
    const m = useTheme();
    return <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={m.accent} /></View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
    const m = useTheme();
    return <View style={[{ height: 1, backgroundColor: m.chipBorder, marginVertical: SPACE.lg }, style]} />;
}

// Brand gradient square/circle with an icon (service tiles, avatars)
export function BrandBadge({ icon, size = 56, round }: { icon: IconName; size?: number; round?: boolean }) {
    return (
        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: size, height: size, borderRadius: round ? size / 2 : 18, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={size * 0.42} color="#FFFFFF" />
        </LinearGradient>
    );
}

// ---- Toggle / Checkbox --------------------------------------------------------

export function Toggle({ value, onChange, label, color }: { value: boolean; onChange: (v: boolean) => void; label?: string; color?: string }) {
    const m = useTheme();
    const on = color || m.accent;
    return (
        <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} hitSlop={8}>
            <View style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: value ? on : m.field, justifyContent: 'center' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignSelf: value ? 'flex-end' : 'flex-start',
                    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
            </View>
        </Pressable>
    );
}

export function Checkbox({ checked, onChange, children, color }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; color?: string }) {
    const m = useTheme();
    const on = color || m.accent;
    return (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: SPACE.sm }}>
            <View style={{ width: 22, height: 22, borderRadius: 7, marginRight: SPACE.md, marginTop: 1, alignItems: 'center', justifyContent: 'center',
                borderWidth: 1.5, borderColor: checked ? on : m.chipBorder, backgroundColor: checked ? on : 'transparent' }}>
                {checked ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
            </View>
            <View style={{ flex: 1 }}>{children}</View>
        </Pressable>
    );
}

// Logo mark used on the sign-in screens
export function LogoMark({ size = 72 }: { size?: number }) {
    return (
        <View style={{ width: size, height: size, borderRadius: size * 0.28, overflow: 'hidden' }}>
            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={{ color: '#FFFFFF', fontFamily: FONT.heavy, fontSize: size * 0.44 }}>G</RNText>
            </LinearGradient>
        </View>
    );
}
