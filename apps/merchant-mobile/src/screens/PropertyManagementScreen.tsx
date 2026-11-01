import React, { useState, useEffect, useCallback } from 'react';
import { CrystalFace } from '@gtaxi/design-system-native/src/crystal';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

// Rooms & rates for a hotel on its own account (founder, 2026-10-26: our team
// must not be stuck copying rates off hotel websites). This screen used to
// read and write travel_properties / travel_bookings, the Travel tables that
// were retired when Travel merged into G-Escape, so anything a hotel entered
// here never reached a rider. It now uses the hotel's G-Escape record
// (lodging_nodes) through merchant_my_lodging / merchant_set_lodging_rate,
// the same rate G's daily package builder reads.
export type LodgingRow = {
    id: string;
    name: string;
    location_zone: string | null;
    max_guests: number | null;
    nights: number | null;
    quoted_rate_per_night_cents: number | null;
    quote_expires_at: string | null;
    rate_set_by_hotel: boolean;
    rate_source_url?: string | null;
    periods?: { id: string; rate_cents: number; from: string; to: string; source: string }[];
    pending_suggestion?: { id: string; source: string; rate_cents: number | null; currency: string | null; amount_text: string | null; excerpt: string | null } | null;
};

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-TT', { day: 'numeric', month: 'short' });
const toCents = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

const DAY_OPTIONS = [14, 30, 60, 90];

function fmtTTD(cents: number) {
    return `TT$${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rateStatus(row: LodgingRow, now = Date.now()): { label: string; color: string } {
    if (!row.quoted_rate_per_night_cents || !row.quote_expires_at) return { label: 'No rate today', color: 'rgba(255,255,255,0.45)' };
    const left = new Date(row.quote_expires_at).getTime() - now;
    if (left <= 0) return { label: 'Rate expired', color: '#EF4444' };
    const days = Math.ceil(left / 86_400_000);
    return days <= 3
        ? { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, color: '#F59E0B' }
        : { label: `Live for ${days} days`, color: '#22C55E' };
}

export function PropertyManagementScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const [rows, setRows] = useState<LodgingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, { rate: string; days: number }>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [acceptRates, setAcceptRates] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    // One path for every other action: plain words back, never silent.
    const act = async (row: LodgingRow, key: string, call: () => Promise<{ data: any; error: any }>, okText: string) => {
        setBusy(`${row.id}:${key}`);
        try {
            const { data, error } = await call();
            if (error && !data) throw error;
            if (data?.success === false) { setNotes((n) => ({ ...n, [row.id]: { ok: false, text: data.error || 'That did not work. Try again.' } })); return; }
            setNotes((n) => ({ ...n, [row.id]: { ok: true, text: data?.message || okText } }));
            await load();
        } catch {
            setNotes((n) => ({ ...n, [row.id]: { ok: false, text: 'No connection. Nothing was saved.' } }));
        } finally { setBusy(null); }
    };

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const { data, error } = await supabase.rpc('merchant_my_lodging');
            if (error) throw error;
            setRows((data as LodgingRow[]) || []);
        } catch {
            setLoadError('Could not load your rooms. Check your connection and try again.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async (row: LodgingRow) => {
        const d = drafts[row.id] || { rate: '', days: 30 };
        const dollars = Number(d.rate.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(dollars) || dollars <= 0) {
            setNotes((n) => ({ ...n, [row.id]: { ok: false, text: 'Enter your nightly rate in TT dollars.' } }));
            return;
        }
        setSavingId(row.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        try {
            const { data, error } = await supabase.rpc('merchant_set_lodging_rate', {
                p_lodging_id: row.id,
                p_rate_cents: Math.round(dollars * 100),
                p_valid_days: d.days,
            });
            if (error) throw error;
            if (!data?.success) {
                setNotes((n) => ({ ...n, [row.id]: { ok: false, text: data?.error || 'Could not save the rate.' } }));
                return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setNotes((n) => ({ ...n, [row.id]: { ok: true, text: 'Saved. G will build packages with this rate.' } }));
            setDrafts((x) => { const c = { ...x }; delete c[row.id]; return c; });
            await load();
        } catch {
            setNotes((n) => ({ ...n, [row.id]: { ok: false, text: 'No connection. Your rate was not saved.' } }));
        } finally {
            setSavingId(null);
        }
    };

    const header = (
        <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Go back" accessibilityRole="button">
                <Ionicons name="chevron-back" size={22} color="#E9F5F3" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.headerTitle}>Rooms & rates</Text>
                <Text style={styles.headerSub}>Your nightly rate for G-Escape trips</Text>
            </View>
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={VOICES.merchant.accent} />
            </View>
        );
    }

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <LinearGradient colors={[VOICES.merchant.bg, VOICES.merchant.bg]} style={StyleSheet.absoluteFillObject} />
            {header}
            {loadError ? (
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={44} color="rgba(255,255,255,0.2)" />
                    <Text style={styles.emptySub}>{loadError}</Text>
                    <TouchableOpacity style={styles.primaryBtn} onPress={() => { setLoading(true); load(); }}>
<CrystalFace color={VOICES.merchant.accent} radius={14} />
                        <Text style={styles.primaryBtnText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            ) : rows.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="bed-outline" size={48} color="rgba(255,255,255,0.15)" />
                    <Text style={styles.emptyTitle}>No rooms on your account yet</Text>
                    <Text style={styles.emptySub}>If you run a hotel or guesthouse, ask G868 for your claim link. It connects your property to this account.</Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={VOICES.merchant.accent} />}
                >
                    {rows.map((row) => {
                        const st = rateStatus(row);
                        const d = drafts[row.id] || { rate: '', days: 30 };
                        const note = notes[row.id];
                        const saving = savingId === row.id;
                        return (
                            <View key={row.id} style={[styles.card, glassSurface(0.12), ghostBorder()]}>
                                <View style={styles.cardTop}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.cardTitle}>{row.name}</Text>
                                        <Text style={styles.cardMeta}>
                                            {[row.location_zone, row.max_guests ? `up to ${row.max_guests} guests` : null, row.nights ? `${row.nights}-night stays` : null].filter(Boolean).join(' · ')}
                                        </Text>
                                    </View>
                                    <Text style={[styles.status, { color: st.color }]}>{st.label}</Text>
                                </View>
                                {row.quoted_rate_per_night_cents ? (
                                    <Text style={styles.current}>
                                        Current rate <Text style={styles.currentStrong}>{fmtTTD(row.quoted_rate_per_night_cents)}</Text> a night
                                        {row.rate_set_by_hotel ? '' : ' (entered by G868)'}
                                    </Text>
                                ) : null}
                                <Text style={styles.label}>New nightly rate (TT$)</Text>
                                <TextInput
                                    style={styles.input}
                                    keyboardType="decimal-pad"
                                    placeholder="e.g. 1200"
                                    placeholderTextColor="rgba(255,255,255,0.3)"
                                    value={d.rate}
                                    onChangeText={(t) => setDrafts((x) => ({ ...x, [row.id]: { ...d, rate: t } }))}
                                    accessibilityLabel={`New nightly rate for ${row.name}`}
                                />
                                <Text style={styles.label}>Good for</Text>
                                <View style={styles.chips}>
                                    {DAY_OPTIONS.map((days) => (
                                        <TouchableOpacity key={days}
                                            style={[styles.chip, d.days === days && { backgroundColor: VOICES.merchant.accent }]}
                                            onPress={() => setDrafts((x) => ({ ...x, [row.id]: { ...d, days } }))}
                                            accessibilityRole="button" accessibilityState={{ selected: d.days === days }}>
                                            <Text style={styles.chipText}>{days === 14 ? '2 weeks' : `${days} days`}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                                <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.5 }]} onPress={() => save(row)} disabled={saving} accessibilityRole="button">
<CrystalFace color={VOICES.merchant.accent} radius={14} />
                                    {saving ? <ActivityIndicator color="#E9F5F3" /> : <Text style={styles.primaryBtnText}>Save rate</Text>}
                                </TouchableOpacity>
                                {(row.periods || []).length > 0 && (
                                    <View style={{ marginTop: 14 }}>
                                        <Text style={styles.label}>Your rates</Text>
                                        {row.periods!.map((p) => (
                                            <View key={p.id} style={styles.periodRow}>
                                                <Text style={styles.periodText}>{fmtTTD(p.rate_cents)} · {fmtDay(p.from)} to {fmtDay(p.to)}</Text>
                                                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Cancel rate from ${fmtDay(p.from)}`} disabled={busy === `${row.id}:c${p.id}`}
                                                    onPress={() => act(row, `c${p.id}`, async () => await supabase.rpc('merchant_cancel_lodging_rate', { p_period_id: p.id }), 'Rate cancelled.')}>
                                                    <Text style={styles.cancelText}>Cancel</Text>
                                                </TouchableOpacity>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <Text style={[styles.label, { marginTop: 14 }]}>Your rates page (optional)</Text>
                                <TextInput style={styles.input} autoCapitalize="none" keyboardType="url" placeholder="https://yourhotel.com/rates"
                                    placeholderTextColor="rgba(255,255,255,0.3)" value={urls[row.id] ?? row.rate_source_url ?? ''}
                                    onChangeText={(t) => setUrls((u) => ({ ...u, [row.id]: t }))} accessibilityLabel={`Rates page for ${row.name}`} />
                                <View style={styles.chips}>
                                    <TouchableOpacity style={styles.chip} accessibilityRole="button" disabled={busy === `${row.id}:url`}
                                        onPress={() => act(row, 'url', async () => await supabase.rpc('merchant_set_rate_source', { p_lodging_id: row.id, p_url: (urls[row.id] ?? '').trim() || null }), 'Website saved.')}>
                                        <Text style={styles.chipText}>Save address</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.chip, !row.rate_source_url && { opacity: 0.4 }]} accessibilityRole="button" disabled={!row.rate_source_url || busy === `${row.id}:read`}
                                        onPress={() => act(row, 'read', async () => await supabase.functions.invoke('merchant', { body: { action: 'read_hotel_rate', lodging_id: row.id } }), 'We found a rate on your website. Check it below.')}>
                                        <Text style={styles.chipText}>{busy === `${row.id}:read` ? 'Reading…' : 'Read my website'}</Text>
                                    </TouchableOpacity>
                                </View>

                                {row.pending_suggestion ? (() => {
                                    const sg = row.pending_suggestion!;
                                    const needsTTD = sg.currency !== 'TTD' || !sg.rate_cents;
                                    return (
                                        <View style={styles.suggestion}>
                                            <Text style={styles.current}>We found <Text style={styles.currentStrong}>{sg.amount_text}</Text>{sg.source === 'booking_com' ? ' on Booking.com' : ' on your website'}.
                                                {sg.currency === 'USD' ? ' It is in US dollars: type your TT$ rate.' : needsTTD ? ' Type your TT$ rate to use it.' : ''}</Text>
                                            {needsTTD && (
                                                <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="Your TT$ rate" placeholderTextColor="rgba(255,255,255,0.3)"
                                                    value={acceptRates[row.id] ?? ''} onChangeText={(t) => setAcceptRates((a) => ({ ...a, [row.id]: t }))} accessibilityLabel="Your TT dollar rate" />
                                            )}
                                            <View style={styles.chips}>
                                                <TouchableOpacity style={[styles.chip, { backgroundColor: VOICES.merchant.accent }]} accessibilityRole="button"
                                                    onPress={() => {
                                                        const cents = needsTTD ? toCents(acceptRates[row.id] ?? '') : null;
                                                        if (needsTTD && !cents) { setNotes((n) => ({ ...n, [row.id]: { ok: false, text: 'Type the TT$ nightly rate to accept this.' } })); return; }
                                                        act(row, 'decide', async () => await supabase.rpc('merchant_decide_rate_suggestion', { p_suggestion_id: sg.id, p_accept: true, p_rate_cents: cents }), 'Accepted for the next 30 days.');
                                                    }}>
                                                    <Text style={styles.chipText}>Use for 30 days</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity style={styles.chip} accessibilityRole="button"
                                                    onPress={() => act(row, 'decide', async () => await supabase.rpc('merchant_decide_rate_suggestion', { p_suggestion_id: sg.id, p_accept: false }), 'Dismissed.')}>
                                                    <Text style={styles.chipText}>Dismiss</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    );
                                })() : null}

                                {note ? <Text style={[styles.note, { color: note.ok ? '#22C55E' : '#EF4444' }]}>{note.text}</Text> : null}
                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: VOICES.merchant.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 8 },
    backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: VOICES.merchant.text, fontWeight: '800', fontSize: 17, fontFamily: 'SpaceGrotesk' },
    headerSub: { color: VOICES.merchant.textMuted, fontSize: 12, fontFamily: 'Manrope' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
    emptyTitle: { color: VOICES.merchant.text, fontWeight: '700', fontSize: 18, textAlign: 'center', fontFamily: 'SpaceGrotesk' },
    emptySub: { color: VOICES.merchant.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: 'Manrope' },
    scroll: { paddingTop: 8, paddingHorizontal: 20, gap: 16 },
    card: { borderRadius: 18, padding: 16 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
    cardTitle: { color: VOICES.merchant.text, fontWeight: '700', fontSize: 15, fontFamily: 'SpaceGrotesk' },
    cardMeta: { color: VOICES.merchant.textMuted, fontSize: 12, marginTop: 2, fontFamily: 'Manrope' },
    status: { fontSize: 11, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
    current: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 12, fontFamily: 'Manrope' },
    currentStrong: { color: VOICES.merchant.text, fontWeight: '700' },
    label: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 11, letterSpacing: 1.5, marginBottom: 6, marginTop: 4, fontFamily: 'SpaceGrotesk' },
    input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: VOICES.merchant.text, fontSize: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10, fontFamily: 'Manrope' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.06)', minHeight: 40, justifyContent: 'center' },
    chipText: { color: VOICES.merchant.text, fontWeight: '600', fontSize: 13, fontFamily: 'Manrope' },
    primaryBtn: { overflow: 'hidden', backgroundColor: VOICES.merchant.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    primaryBtnText: { color: VOICES.merchant.text, fontWeight: '700', fontFamily: 'SpaceGrotesk' },
    note: { fontSize: 12, marginTop: 10, fontFamily: 'Manrope' },
    periodRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
    periodText: { color: VOICES.merchant.text, fontSize: 13, fontFamily: 'Manrope' },
    cancelText: { color: '#EF4444', fontWeight: '700', fontSize: 12, fontFamily: 'SpaceGrotesk', padding: 8 },
    suggestion: { marginTop: 4, marginBottom: 6, padding: 12, borderRadius: 14, backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
});
