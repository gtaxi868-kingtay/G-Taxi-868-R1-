import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BUSINESS_TYPES } from '../business/businessTypes';
import { useMerchant } from '../context/MerchantContext';
import { Mood, type as T, useMood, useStyles } from '../ui/mood';


export function BusinessTypePicker({ title = 'What kind of business are you?', onDone }: { title?: string; onDone?: () => void }) {
    const m = useMood();
    const s = useStyles(makeStyles);
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
                        <View style={s.icon}><Ionicons name={t.icon} size={20} color={m.gold} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.label}>{t.label}</Text>
                            <Text style={s.examples}>{t.examples}</Text>
                        </View>
                        {on && <Ionicons name="checkmark-circle" size={22} color={m.gold} />}
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    wrap: { gap: 8 },
    title: { fontFamily: T.title.fontFamily, fontSize: 26, color: m.ink },
    sub: { fontSize: 14, color: m.dim, marginBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: m.card, borderWidth: 2, borderColor: m.line },
    rowOn: { borderColor: m.gold },
    icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: m.goldWash },
    label: { fontSize: 15, fontWeight: '700', color: m.ink },
    examples: { marginTop: 1, fontSize: 12.5, color: m.dim },
});
