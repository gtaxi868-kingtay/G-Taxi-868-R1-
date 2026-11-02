import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { askG } from '@g868/shared/g';
import { GPresence, type GAction, type GPalette } from '@gtaxi/design-system-native/src/gPresence';

const CORE = ['#FBE389', '#EDBE45', '#34D399'];
const PALETTE: GPalette = {
    page: ['#123027', '#0B1A16', '#070E0C'], ring: '#34D399', core: CORE, coreLip: '#0F766E', onCore: '#0B1A16',
    ink: '#FFFFFF', dim: 'rgba(255,255,255,0.72)', field: 'rgba(255,255,255,0.08)', fieldLine: 'rgba(255,255,255,0.18)',
};
const SCREENS: Record<string, string> = { wallet: 'CashWithdrawal', scheduled_rides: 'ScheduledRides', referrals: 'DriverReferral', profile: 'Profile', help: 'ReportIssue' };

// G for drivers. Sits on the map, one tap away, and never covers the trip card.
export function GButton({ name }: { name?: string }) {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<any>();
    const [open, setOpen] = useState(false);
    const [learns, setLearns] = useState(true);

    useEffect(() => {
        if (!open) return;
        supabase.rpc('g_opt_in_status', { p_role: 'driver' }).then(({ data }: { data: boolean | null }) => setLearns(data !== false), () => {});
    }, [open]);

    const letGLearn = async () => {
        const { data } = await supabase.rpc('g_set_opt_in', { p_role: 'driver', p_on: true }).then((r: any) => r, () => ({ data: null }));
        if (data?.success) setLearns(true);
    };

    const onAction = (a: GAction) => {
        setOpen(false);
        const p = a.payload as { type?: string; screen?: string } | undefined;
        if (p?.type === 'screen' && p.screen && SCREENS[p.screen]) navigation.navigate(SCREENS[p.screen]);
    };

    return (
        <>
            <Pressable onPress={() => setOpen(true)} style={[s.wrap, { top: insets.top + 112 }]} accessibilityRole="button" accessibilityLabel="Talk to G">
                <LinearGradient colors={CORE as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.orb}>
                    <Text style={s.g}>G</Text>
                </LinearGradient>
            </Pressable>
            <GPresence
                visible={open}
                palette={PALETTE}
                name={name}
                hint="Try: why was my last payout that amount?"
                invite={learns ? undefined : {
                    title: 'Let G learn you',
                    body: 'G will remember your routes, your notes and how you work, and get better every shift. Turn it off any time.',
                    accept: 'Turn on my G',
                    onAccept: letGLearn,
                }}
                ask={(input) => askG(supabase as any, input, { as: 'driver' })}
                onAction={onAction}
                onClose={() => setOpen(false)}
            />
        </>
    );
}

const s = StyleSheet.create({
    wrap: { position: 'absolute', right: 16, zIndex: 20 },
    orb: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderBottomColor: '#0F766E' },
    g: { fontFamily: 'Nunito_900Black', fontSize: 30, lineHeight: 36, color: '#0B1A16' },
});
