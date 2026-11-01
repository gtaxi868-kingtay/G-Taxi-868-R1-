import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { searchTowns, type Town } from '../data/towns';

// The driver's home town, picked from the list so it always has a map position.
export function TownField({ value, onChange }: { value: Town | null; onChange: (t: Town | null) => void }) {
    const [text, setText] = useState(value?.name ?? '');
    const results = useMemo(() => (value ? [] : searchTowns(text)), [text, value]);

    const type = (t: string) => {
        setText(t);
        if (value) onChange(null);
    };
    const pick = (t: Town) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setText(t.name);
        onChange(t);
    };

    return (
        <View>
            <View style={s.wrap}>
                <TextInput
                    style={s.input}
                    placeholder="Home town (search)"
                    placeholderTextColor="rgba(255,255,255,0.6)"
                    value={text}
                    onChangeText={type}
                    autoCorrect={false}
                    selectionColor={VOICES.driver.accent}
                    accessibilityLabel="Home town"
                />
            </View>
            {results.length > 0 && (
                <View style={s.list}>
                    {results.map((t) => (
                        <TouchableOpacity key={`${t.name}-${t.lat}`} style={s.row} onPress={() => pick(t)} accessibilityRole="button">
                            <Text style={s.rowText}>{t.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
            {!value && text.trim().length >= 2 && results.length === 0 && (
                <Text style={s.none}>Not listed. Try the closest town to you.</Text>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    wrap: { height: 64, backgroundColor: 'rgba(26, 21, 48, 0.4)', borderRadius: 20, paddingHorizontal: 20, justifyContent: 'center', marginBottom: 12, ...ghostBorder(0.15) },
    input: { flex: 1, color: '#EAF3F6', fontSize: 16 },
    list: { marginTop: -4, marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(26, 21, 48, 0.9)', ...ghostBorder(0.15) },
    row: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
    rowText: { fontSize: 15, color: '#EAF3F6' },
    none: { marginTop: -4, marginBottom: 12, paddingHorizontal: 8, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
});
