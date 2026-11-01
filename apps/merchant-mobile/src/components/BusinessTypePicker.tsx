import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VOICES } from '@gtaxi/design-system';
import { BUSINESS_TYPES } from '../business/businessTypes';
import { useMerchant } from '../context/MerchantContext';

const V = VOICES.merchant;

export function BusinessTypePicker({ title = 'What kind of business are you?', onDone }: { title?: string; onDone?: () => void }) {
    const { type, setBusinessType } = useMerchant();
    const [saving, setSaving] = useState(false);

    const choose = async (key: (typeof BUSINESS_TYPES)[number]['key']) => {
        if (saving) return;
        setSaving(true);
        const ok = await setBusinessType(key);
        setSaving(false);
        if (ok) onDone?.();
        else Alert.alert('Could not save', 'Check your connection and try again.');
    };

    return (
        <View style={s.wrap}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>This sets up your app around how you work.</Text>
            {BUSINESS_TYPES.map((t) => {
                const on = type?.key === t.key;
                return (
                    <TouchableOpacity key={t.key} style={[s.row, on && s.rowOn]} onPress={() => choose(t.key)} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: on }}>
                        <View style={s.icon}><Ionicons name={t.icon} size={20} color={V.accent} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.label}>{t.label}</Text>
                            <Text style={s.examples}>{t.examples}</Text>
                        </View>
                        {on && <Ionicons name="checkmark-circle" size={22} color={V.accent} />}
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const s = StyleSheet.create({
    wrap: { gap: 8 },
    title: { fontFamily: V.serifSemi, fontSize: 26, color: V.text },
    sub: { fontSize: 14, color: V.textMuted, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.08)' },
    rowOn: { borderColor: V.accent },
    icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(45,212,191,0.12)' },
    label: { fontSize: 15, fontWeight: '700', color: V.text },
    examples: { marginTop: 1, fontSize: 12.5, color: V.textMuted },
});
