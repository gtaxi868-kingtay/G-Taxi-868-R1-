import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { CrystalAction, Empty, Field, PageHeader } from '../ui/kit';

const { supabase } = initializeSupabaseClient('native');
const V = VOICES.merchant;

type Venue = { id: string; name: string; address: string; membership_price_cents: number | null; drink_subsidy_cap_cents: number; status: string; active_members: number };
const money = (c: number | null) => (c == null ? 'Not set' : `TT$${(c / 100).toFixed(2)}`);

export function GSpotScreen({ navigation }: { navigation: { goBack: () => void } }) {
    const [venue, setVenue] = useState<Venue | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [code, setCode] = useState('');
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const load = useCallback(async () => {
        const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'get_my_g_spot_venue' } });
        if (error || !data?.success) setFailed(true);
        else setVenue(data.venue ?? null);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const redeem = async () => {
        const discount_cents = Math.round(parseFloat(amount) * 100);
        if (!code.trim() || !discount_cents || discount_cents < 0) {
            setResult("Enter the rider's code and a discount amount.");
            return;
        }
        setBusy(true);
        setResult(null);
        const { data, error } = await supabase.functions.invoke('merchant', {
            body: { action: 'redeem_g_spot_code', code: code.trim(), discount_cents },
        });
        setBusy(false);
        if (error || !data?.success) { setResult(data?.error || 'Could not redeem that code.'); return; }
        const { drink_subsidy_used_cents: used, drink_subsidy_cap_cents: cap } = data.result;
        setResult(`Applied. ${money(used)} of ${money(cap)} used this cycle.`);
        setCode('');
        setAmount('');
    };

    return (
        <View style={s.root}>
            <PageHeader title={venue?.name ?? 'G Spot'} sub={venue?.address} onBack={navigation.goBack} />
            {loading ? <ActivityIndicator color={V.accent} style={{ marginTop: 40 }} /> : !venue ? (
                <Empty icon="wine-outline" title={failed ? 'Could not load your venue' : 'No G Spot venue yet'} body={failed ? 'Check your connection and try again.' : 'G 868 links your venue once your membership deal is agreed.'} />
            ) : (
                <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
                    <View style={s.stats}>
                        <View style={s.stat}><Text style={s.value}>{venue.active_members}</Text><Text style={s.label}>Members</Text></View>
                        <View style={s.stat}><Text style={s.value}>{money(venue.membership_price_cents)}</Text><Text style={s.label}>Membership</Text></View>
                    </View>
                    <Text style={s.title}>Redeem a member's code</Text>
                    <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="characters" />
                    <Field label="Discount (TT$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
                    <CrystalAction label="Apply discount" busy={busy} onPress={redeem} />
                    {result ? <Text style={s.result}>{result}</Text> : null}
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    body: { paddingHorizontal: 18, paddingBottom: 32 },
    stats: { flexDirection: 'row', gap: 12, marginBottom: 18 },
    stat: { flex: 1, padding: 16, borderRadius: 20, backgroundColor: V.surface },
    value: { fontSize: 20, fontWeight: '800', color: V.text },
    label: { marginTop: 3, fontSize: 12, color: V.textMuted },
    title: { marginBottom: 10, fontSize: 17, fontWeight: '700', color: V.text },
    result: { marginTop: 12, fontSize: 14, lineHeight: 20, color: V.text },
});
