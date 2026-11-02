import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CrystalInput } from '@gtaxi/design-system/native';
import { searchTowns, type Town } from '../data/towns';

// The rider's town, picked from the list so nearby drivers can be told.
export function TownField({ value, onChange }: { value: Town | null; onChange: (t: Town | null) => void }) {
    const [text, setText] = useState(value?.name ?? '');
    const results = useMemo(() => (value ? [] : searchTowns(text)), [text, value]);

    const type = (t: string) => {
        setText(t);
        if (value) onChange(null);
    };
    const pick = (t: Town) => {
        setText(t.name);
        onChange(t);
    };

    return (
        <View>
            <CrystalInput label="Your town" voice="rider" placeholder="Search your town" value={text} onChangeText={type} autoCorrect={false} accessibilityLabel="Your town" />
            {results.length > 0 && (
                <View style={s.list}>
                    {results.map((t) => (
                        <Pressable key={`${t.name}-${t.lat}`} style={s.row} onPress={() => pick(t)} accessibilityRole="button">
                            <Text style={s.rowText}>{t.name}</Text>
                        </Pressable>
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
    list: { marginTop: 6, marginBottom: 10, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(26,21,48,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
    row: { paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
    rowText: { fontSize: 15, color: '#EAF3F6' },
    none: { marginTop: 6, marginBottom: 10, fontSize: 13, color: 'rgba(255,255,255,0.65)' },
});
