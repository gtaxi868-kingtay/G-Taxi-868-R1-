import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { initializeSupabaseClient } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');

// What G868 owes this business (room money at its own rate + 1% lobby tap
// share) and a one-tap payout request. Same rules as the business website:
// bank details first, one payout at a time, G868 approves, then transfers.
type Earnings = {
    success: boolean; error?: string;
    owed_room_cents: number; owed_lobby_cents: number; lobby_held_back_cents: number;
    payouts: { id: string; status: 'requested' | 'approved' | 'paid' | 'rejected'; total_cents: number }[];
    has_bank_details: boolean;
};

const fmt = (c: number) => `TT$${(c / 100).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function payoutLine(e: Pick<Earnings, 'owed_room_cents' | 'owed_lobby_cents' | 'payouts' | 'has_bank_details'>): { canRequest: boolean; text: string } {
    const open = e.payouts.find((p) => p.status === 'requested' || p.status === 'approved');
    const total = e.owed_room_cents + e.owed_lobby_cents;
    if (open) return { canRequest: false, text: `${fmt(open.total_cents)} ${open.status === 'requested' ? 'is waiting for approval' : 'is approved and on its way'}.` };
    if (total <= 0) return { canRequest: false, text: 'Nothing to collect yet.' };
    if (!e.has_bank_details) return { canRequest: false, text: `${fmt(total)} to collect. Add your bank details to request it.` };
    return { canRequest: true, text: `${fmt(total)} to collect.` };
}

export function BusinessPayoutCard() {
    const [data, setData] = useState<Earnings | null>(null);
    const [loading, setLoading] = useState(true);
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [showBank, setShowBank] = useState(false);
    const [bank, setBank] = useState({ bank: '', holder: '', number: '' });

    const load = useCallback(async () => {
        try {
            const { data: d, error } = await supabase.rpc('merchant_earnings');
            if (error) throw error;
            setData(d?.success ? d : null);
            if (!d?.success) setNote({ ok: false, text: d?.error || 'Could not load your earnings.' });
        } catch {
            setNote({ ok: false, text: 'Offline or no connection. Pull down to try again.' });
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const run = async (call: () => Promise<{ data: any; error: any }>, ok: string) => {
        setBusy(true); setNote(null);
        try {
            const { data: d, error } = await call();
            if (error && !d) throw error;
            if (d?.success === false) { setNote({ ok: false, text: d.error || 'That did not work.' }); return false; }
            setNote({ ok: true, text: ok });
            await load();
            return true;
        } catch { setNote({ ok: false, text: 'No connection. Nothing was sent.' }); return false; }
        finally { setBusy(false); }
    };

    if (loading) return <View style={st.card}><ActivityIndicator color={VOICES.merchant.accent} /></View>;
    const line = data ? payoutLine(data) : null;

    return (
        <View style={st.card}>
            <Text style={st.title}>Payouts</Text>
            {data && line ? (
                <>
                    <Text style={st.row}>Room money {fmt(data.owed_room_cents)} · Lobby share {fmt(data.owed_lobby_cents)}</Text>
                    {data.lobby_held_back_cents > 0 ? <Text style={st.muted}>{fmt(data.lobby_held_back_cents)} is covering your subscription or fees.</Text> : null}
                    <Text style={st.body}>{line.text}</Text>
                    <View style={st.actions}>
                        <TouchableOpacity accessibilityRole="button" disabled={!line.canRequest || busy} style={[st.primary, (!line.canRequest || busy) && { opacity: 0.35 }]}
                            onPress={() => run(async () => await supabase.rpc('merchant_request_payout'), 'Requested. G868 will review it and send the transfer.')}>
                            {busy ? <ActivityIndicator color="#E9F5F3" /> : <Text style={st.primaryText}>Request payout</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" style={st.secondary} onPress={() => setShowBank((v) => !v)}>
                            <Text style={st.secondaryText}>{data.has_bank_details ? 'Change bank' : 'Add bank details'}</Text>
                        </TouchableOpacity>
                    </View>
                    {showBank && (
                        <View style={{ marginTop: 10, gap: 8 }}>
                            <TextInput style={st.input} placeholder="Bank (e.g. Republic Bank)" placeholderTextColor="rgba(255,255,255,0.3)" value={bank.bank} onChangeText={(t) => setBank({ ...bank, bank: t })} accessibilityLabel="Bank name" />
                            <TextInput style={st.input} placeholder="Account holder" placeholderTextColor="rgba(255,255,255,0.3)" value={bank.holder} onChangeText={(t) => setBank({ ...bank, holder: t })} accessibilityLabel="Account holder" />
                            <TextInput style={st.input} placeholder="Account number" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="number-pad" value={bank.number} onChangeText={(t) => setBank({ ...bank, number: t })} accessibilityLabel="Account number" />
                            <TouchableOpacity accessibilityRole="button" style={st.primary} disabled={busy}
                                onPress={async () => {
                                    const ok = await run(async () => await supabase.rpc('merchant_set_payout_account', { p_bank_name: bank.bank, p_account_holder: bank.holder, p_account_number: bank.number }), 'Bank details saved.');
                                    if (ok) { setBank({ bank: '', holder: '', number: '' }); setShowBank(false); }
                                }}>
                                <Text style={st.primaryText}>Save bank details</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </>
            ) : null}
            {note ? <Text style={[st.note, { color: note.ok ? '#22C55E' : '#EF4444' }]}>{note.text}</Text> : null}
        </View>
    );
}

const st = StyleSheet.create({
    card: { borderRadius: 18, padding: 16, marginBottom: 16, backgroundColor: 'rgba(6,10,12,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
    title: { color: '#E9F5F3', fontWeight: '800', fontSize: 15, fontFamily: 'SpaceGrotesk', marginBottom: 6 },
    row: { color: '#E9F5F3', fontSize: 13, fontFamily: 'Manrope' },
    body: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 6, fontFamily: 'Manrope' },
    muted: { color: '#F59E0B', fontSize: 12, marginTop: 4, fontFamily: 'Manrope' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
    primary: { backgroundColor: VOICES.merchant.accent, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: '#E9F5F3', fontWeight: '700', fontFamily: 'SpaceGrotesk' },
    secondary: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, minHeight: 46, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
    secondaryText: { color: '#E9F5F3', fontWeight: '600', fontFamily: 'Manrope' },
    input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: '#E9F5F3', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', fontFamily: 'Manrope' },
    note: { fontSize: 12, marginTop: 10, fontFamily: 'Manrope' },
});
