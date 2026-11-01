import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, RADIUS, Screen, SPACE, Txt, useTheme } from '../ui/kit';

// Rates here are only for the estimate shown before booking; the server
// (create_laundry_order) sets the real price. The order is not tied to a
// chosen shop, so there is no shop picker. (The old picker did nothing,
// and it blocked booking whenever no laundry shop was listed. The old
// "AI Smart Scan" waited two seconds and invented an item.)
const SERVICES = [
    { id: 'wash_fold', label: 'Wash and fold', sub: 'Everyday clothes, washed, dried and folded', icon: 'water-outline', baseRate: 500 },
    { id: 'dry_clean', label: 'Dry clean', sub: 'Suits, dresses and delicate fabrics', icon: 'sparkles-outline', baseRate: 1200 },
    { id: 'iron', label: 'Iron only', sub: 'Pressed and ready to wear', icon: 'shirt-outline', baseRate: 300 },
];

export function LaundryLandingScreen({ navigation }: any) {
    const m = useTheme();
    const [selected, setSelected] = useState(SERVICES[0]);

    return (
        <Screen
            title="Laundry"
            onBack={() => { Haptics.selectionAsync(); navigation.goBack(); }}
            hero={
                <View>
                    <Txt variant="hero">Fresh laundry, picked up from you</Txt>
                    <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>A driver collects it and brings it back clean.</Txt>
                </View>
            }
            footer={<Button title={`Continue with ${selected.label.toLowerCase()}`} onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                navigation.navigate('LaundryEstimator', { service: selected });
            }} />}
        >
            <Txt variant="overline" tone="faint" style={{ marginBottom: SPACE.md }}>CHOOSE A SERVICE</Txt>
            {SERVICES.map(svc => {
                const on = selected.id === svc.id;
                return (
                    <Pressable key={svc.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={svc.label}
                        onPress={() => { Haptics.selectionAsync(); setSelected(svc); }}
                        style={({ pressed }) => ({
                            flexDirection: 'row', alignItems: 'center', padding: SPACE.lg, marginBottom: SPACE.md, borderRadius: RADIUS.card, borderWidth: 2, borderBottomWidth: 4,
                            borderColor: on ? '#8B7CFF' : (m.key === 'day' ? '#E7E1F0' : 'rgba(255,255,255,0.10)'), backgroundColor: on ? (m.key === 'day' ? 'rgba(122,92,255,0.08)' : 'rgba(185,174,255,0.12)') : m.chip,
                            opacity: pressed ? 0.85 : 1,
                        })}>
                        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: m.field, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={svc.icon as any} size={22} color={on ? m.accent : m.ink} />
                        </View>
                        <View style={{ flex: 1, marginLeft: SPACE.md }}>
                            <Txt variant="headline">{svc.label}</Txt>
                            <Txt variant="caption" tone="dim">{svc.sub}</Txt>
                        </View>
                        <Txt variant="bodyStrong" tone="dim">from ${(svc.baseRate / 100).toFixed(2)}/lb</Txt>
                    </Pressable>
                );
            })}
        </Screen>
    );
}
