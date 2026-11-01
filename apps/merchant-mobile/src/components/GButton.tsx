import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { askG } from '@g868/shared/g';
import { GPresence, type GAction, type GPalette } from '@gtaxi/design-system-native/src/gPresence';
import { useMerchant } from '../context/MerchantContext';
import { useMood } from '../ui/mood';

const { supabase } = initializeSupabaseClient('native');
const SCREENS: Record<string, string> = { orders: 'Work', catalog: 'Catalog', money: 'Money', promotions: 'Promotions', brand: 'Brand', staff: 'Staff' };

// G, one tap from Home.
export function GButton() {
    const m = useMood();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<any>();
    const { merchant, setOpen } = useMerchant();
    const [open, setShow] = useState(false);

    const palette: GPalette = useMemo(() => ({
        page: m.key === 'day' ? ['#FFFDF8', '#FAF1DE', '#F6E8CC'] : ['#3A3220', '#17140D', '#100E0A'],
        ring: m.goldFace[1], core: m.goldFace, coreLip: m.goldLip, onCore: m.onGold,
        ink: m.ink, dim: m.dim, field: m.card, fieldLine: m.line,
    }), [m]);

    const onAction = async (a: GAction) => {
        setShow(false);
        const p = a.payload as { type?: string; screen?: string; open?: boolean } | undefined;
        if (p?.type === 'store_open' && typeof p.open === 'boolean') {
            if (!(await setOpen(p.open))) Alert.alert('Could not update', 'Check your connection and try again.');
        } else if (p?.type === 'screen' && p.screen && SCREENS[p.screen]) {
            navigation.navigate(SCREENS[p.screen]);
        }
    };

    return (
        <>
            <Pressable onPress={() => setShow(true)} style={[s.wrap, { top: insets.top + 16 }]} accessibilityRole="button" accessibilityLabel="Talk to G">
                <LinearGradient colors={m.goldFace as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.orb, { borderBottomColor: m.goldLip }]}>
                    <Text style={[s.g, { color: m.onGold }]}>G</Text>
                </LinearGradient>
            </Pressable>
            <GPresence
                visible={open}
                palette={palette}
                name={merchant?.name}
                hint="Try: how did we do today, or what's selling best?"
                ask={(input) => askG(supabase as any, input, { as: 'merchant' })}
                onAction={onAction}
                onClose={() => setShow(false)}
            />
        </>
    );
}

const s = StyleSheet.create({
    wrap: { position: 'absolute', right: 18, zIndex: 5 },
    orb: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4 },
    g: { fontFamily: 'Nunito_900Black', fontSize: 30, lineHeight: 36 },
});
