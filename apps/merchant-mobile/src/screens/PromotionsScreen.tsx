import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { Chip, CrystalAction, Empty, Field, PageHeader } from '../ui/kit';

const { supabase } = initializeSupabaseClient('native');
const V = VOICES.merchant;

type PromoType = 'map_pin' | 'suggested_stop' | 'search_boost' | 'home_featured';
type Promotion = { id: string; promotion_type: PromoType; budget_cents: number; spent_cents: number; start_date: string; end_date: string; is_active: boolean };

const TYPES: { key: PromoType; label: string; sub: string }[] = [
    { key: 'suggested_stop', label: 'Suggested stop', sub: 'G offers you as a stop on the way' },
    { key: 'map_pin', label: 'Map pin', sub: 'Stand out on the rider map' },
    { key: 'search_boost', label: 'Search boost', sub: 'Show higher when riders search' },
    { key: 'home_featured', label: 'Home featured', sub: 'Show on the rider home screen' },
];

const money = (c: number) => `TT$${(c / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

export function PromotionsScreen({ navigation }: { navigation: { goBack: () => void } }) {
    const [rows, setRows] = useState<Promotion[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [type, setType] = useState<PromoType>('suggested_stop');
    const [budget, setBudget] = useState('');
    const [days, setDays] = useState('30');

    const load = useCallback(async () => {
        const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'list_promotions' } });
        if (!error && data?.success) setRows(data.promotions ?? []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const create = async () => {
        const budget_cents = Math.round(parseFloat(budget) * 100);
        const length = parseInt(days, 10);
        if (!budget_cents || budget_cents <= 0 || !length || length <= 0) {
            Alert.alert('Check the details', 'Enter a budget and how many days to run.');
            return;
        }
        setSaving(true);
        const start = new Date();
        const { data, error } = await supabase.functions.invoke('merchant', {
            body: { action: 'create_promotion', promotion_type: type, budget_cents, start_date: day(start), end_date: day(new Date(start.getTime() + length * 86400000)), target_radius_km: 3 },
        });
        setSaving(false);
        if (error || !data?.success) { Alert.alert('Could not create it', data?.error || 'Check your connection and try again.'); return; }
        setAdding(false);
        setBudget('');
        await load();
    };

    const pause = (id: string) => Alert.alert('Pause this promotion?', 'It stops spending right away.', [
        { text: 'Keep running', style: 'cancel' },
        {
            text: 'Pause', style: 'destructive', onPress: async () => {
                const { error } = await supabase.functions.invoke('merchant', { body: { action: 'pause_promotion', promotion_id: id } });
                if (error) Alert.alert('Could not pause', 'Check your connection and try again.');
                else await load();
            },
        },
    ]);

    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    return (
        <View style={s.root}>
            <PageHeader title="Promotions" sub="G 868 reviews each one before it goes live." onBack={navigation.goBack} />
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={V.accent} />}>
                {adding ? (
                    <View style={s.card}>
                        <Text style={s.cardTitle}>What do you want?</Text>
                        <View style={s.chips}>{TYPES.map((t) => <Chip key={t.key} label={t.label} on={type === t.key} onPress={() => setType(t.key)} />)}</View>
                        <Text style={s.hint}>{TYPES.find((t) => t.key === type)?.sub}</Text>
                        <Field label="Budget (TT$)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" placeholder="500" />
                        <Field label="Run for (days)" value={days} onChangeText={setDays} keyboardType="number-pad" />
                        <CrystalAction label="Send for review" busy={saving} onPress={create} />
                        <TouchableOpacity style={s.cancel} onPress={() => setAdding(false)} accessibilityRole="button"><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
                    </View>
                ) : (
                    <CrystalAction label="New promotion" onPress={() => setAdding(true)} />
                )}
                {loading ? <ActivityIndicator color={V.accent} style={{ marginTop: 30 }} /> : null}
                {!loading && rows.length === 0 && !adding && <Empty icon="megaphone-outline" title="No promotions yet" body="Promote your business to riders near you." />}
                {rows.map((p) => (
                    <View key={p.id} style={s.card}>
                        <View style={s.row}>
                            <Text style={s.cardTitle}>{TYPES.find((t) => t.key === p.promotion_type)?.label ?? p.promotion_type}</Text>
                            <Text style={[s.status, p.is_active && { color: V.accent }]}>{p.is_active ? 'Running' : 'Not running'}</Text>
                        </View>
                        <Text style={s.hint}>{money(p.spent_cents)} of {money(p.budget_cents)} used · until {p.end_date}</Text>
                        {p.is_active && <TouchableOpacity style={s.cancel} onPress={() => pause(p.id)} accessibilityRole="button"><Text style={s.cancelText}>Pause</Text></TouchableOpacity>}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    body: { paddingHorizontal: 18, paddingBottom: 32, gap: 12 },
    card: { padding: 16, borderRadius: 20, backgroundColor: V.surface, borderWidth: 1, borderColor: 'rgba(233,245,243,0.08)' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { fontSize: 16, fontWeight: '700', color: V.text },
    status: { fontSize: 13, fontWeight: '600', color: V.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    hint: { marginTop: 8, marginBottom: 12, fontSize: 13, lineHeight: 18, color: V.textMuted },
    cancel: { alignItems: 'center', paddingTop: 12 },
    cancelText: { fontSize: 14, fontWeight: '600', color: V.textMuted },
});
