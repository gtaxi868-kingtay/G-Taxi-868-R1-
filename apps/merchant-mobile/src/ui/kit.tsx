import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CrystalFace } from '@gtaxi/design-system-native/src/crystal';
import { VOICES } from '@gtaxi/design-system';

const V = VOICES.merchant;

export function PageHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
            {onBack && (
                <TouchableOpacity onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Go back">
                    <Ionicons name="chevron-back" size={24} color={V.text} />
                </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>{title}</Text>
                {sub ? <Text style={s.sub} numberOfLines={2}>{sub}</Text> : null}
            </View>
            {right}
        </View>
    );
}

export function CrystalAction({ label, onPress, busy, disabled, color = V.accent }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; color?: string }) {
    const off = busy || disabled;
    return (
        <TouchableOpacity style={[s.action, off && { opacity: 0.5 }]} onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }}>
            <CrystalFace color={color} radius={16} />
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.actionText}>{label}</Text>}
        </TouchableOpacity>
    );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
    return (
        <View style={s.field}>
            <Text style={s.fieldLabel}>{label}</Text>
            <TextInput style={s.input} placeholderTextColor={V.textMuted} accessibilityLabel={label} {...props} />
        </View>
    );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
    return (
        <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
        </TouchableOpacity>
    );
}

export function Empty({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
    return (
        <View style={s.empty}>
            <Ionicons name={icon} size={42} color={V.textMuted} />
            <Text style={s.emptyTitle}>{title}</Text>
            {body ? <Text style={s.emptyBody}>{body}</Text> : null}
        </View>
    );
}

const s = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
    back: { width: 36, height: 44, justifyContent: 'center' },
    title: { fontFamily: V.serifSemi, fontSize: 32, lineHeight: 38, color: V.text },
    sub: { marginTop: 1, fontSize: 13.5, color: V.textMuted },
    action: { minHeight: 52, paddingHorizontal: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    actionText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
    field: { marginBottom: 12 },
    fieldLabel: { marginBottom: 6, fontSize: 13, fontWeight: '600', color: V.textMuted },
    input: { minHeight: 52, paddingHorizontal: 16, borderRadius: 16, fontSize: 16, color: V.text, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.1)' },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.1)' },
    chipOn: { borderColor: V.accent, backgroundColor: 'rgba(45,212,191,0.14)' },
    chipText: { fontSize: 14, fontWeight: '600', color: V.textMuted },
    chipTextOn: { color: V.text },
    empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 28 },
    emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: '700', color: V.text, textAlign: 'center' },
    emptyBody: { marginTop: 6, fontSize: 14, lineHeight: 20, color: V.textMuted, textAlign: 'center' },
});
