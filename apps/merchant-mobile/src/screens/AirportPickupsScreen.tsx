import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { initializeSupabaseClient } from '@gtaxi/core';
import { Chip, GoldKey, Empty, Field, PageHeader } from '../ui/kit';
import { Mood, type as T, useMood, useStyles } from '../ui/mood';

const { supabase } = initializeSupabaseClient('native');

// A hotel books its guest's airport pickup by flight number. With live flight
// tracking the pickup follows the arrival; without it the hotel types the time.
type Pickup = { id: string; status: string; scheduled_for: string | null; total_fare_cents: number | null; ride_pin: string | null; metadata: Record<string, any> };

const todayTT = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const emptyForm = () => ({ guest_name: '', guest_phone: '', flight_number: '', flight_date: todayTT(), airport: 'POS', arrival_time: '', child_seat: false, wheelchair: false, note: '' });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Time not set');

export function pickupLabel(p: Pickup): string {
    const problem = p.metadata?.flight_problem;
    if (problem === 'cancelled') return 'Flight cancelled: call your guest';
    if (problem === 'diverted') return 'Flight diverted: call your guest';
    if (p.status === 'scheduled') return p.metadata?.flight_tracked ? 'Booked, following the flight' : 'Booked';
    if (p.status === 'searching') return 'Finding a driver';
    if (['assigned', 'arrived', 'in_progress'].includes(p.status)) return 'Driver on the way';
    if (['completed', 'payment_confirmed', 'closed'].includes(p.status)) return 'Done';
    return p.status;
}

export function AirportPickupsScreen({ navigation }: { navigation: { goBack: () => void } }) {
    const m = useMood();
    const s = useStyles(makeStyles);
    const [form, setForm] = useState(emptyForm);
    const [tracked, setTracked] = useState<boolean | null>(null);
    const [pickups, setPickups] = useState<Pickup[]>([]);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [booking, setBooking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'list_airport_pickups' } });
        if (error || !data?.success) setNotice(data?.error || 'Could not load your pickups.');
        else setPickups(data.pickups ?? []);
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const set = <K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) => {
        setForm((f) => ({ ...f, [k]: v }));
        if (k === 'flight_number' || k === 'flight_date') setTracked(null);
    };

    const check = async () => {
        setChecking(true);
        setNotice(null);
        const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'flight_status', flight_number: form.flight_number, flight_date: form.flight_date } });
        setChecking(false);
        if (error && !data) { setNotice('No connection. Try again.'); return; }
        setTracked(data?.tracked ?? false);
        if (!data?.success) setNotice(data?.error || 'Could not find that flight.');
        else if (!data.tracked) setNotice(data.message);
        else setNotice(`${data.flight?.ident ?? 'Flight'} found. ${data.flight?.status ?? ''}`.trim());
    };

    const book = async () => {
        setBooking(true);
        setNotice(null);
        const { data, error } = await supabase.functions.invoke('merchant', { body: { action: 'book_airport_pickup', ...form } });
        setBooking(false);
        if (error && !data) { setNotice('No connection. The pickup was not booked.'); return; }
        if (!data?.success) { setNotice(data?.error || 'Could not book the pickup.'); return; }
        setNotice(`${data.message} PIN ${data.ride_pin}.`);
        setForm(emptyForm());
        setTracked(null);
        load();
    };

    const ready = form.guest_name && form.guest_phone && form.flight_number && (tracked !== false || form.arrival_time);

    return (
        <View style={s.root}>
            <PageHeader title="Airport pickups" sub="Book your guest's ride from Piarco or Tobago." onBack={navigation.goBack} />
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
                <Field label="Guest name (for the sign)" value={form.guest_name} onChangeText={(v) => set('guest_name', v)} />
                <Field label="Guest phone or WhatsApp" value={form.guest_phone} onChangeText={(v) => set('guest_phone', v)} keyboardType="phone-pad" />
                <Field label="Flight number" value={form.flight_number} onChangeText={(v) => set('flight_number', v)} autoCapitalize="characters" placeholder="BW 523" />
                <Field label="Arrival date (YYYY-MM-DD)" value={form.flight_date} onChangeText={(v) => set('flight_date', v)} />
                <View style={s.chips}>
                    <Chip label="Piarco" on={form.airport === 'POS'} onPress={() => set('airport', 'POS')} />
                    <Chip label="Tobago" on={form.airport === 'TAB'} onPress={() => set('airport', 'TAB')} />
                </View>
                <GoldKey label="Check flight" busy={checking} disabled={!form.flight_number} onPress={check} />
                {tracked === false && <View style={{ marginTop: 12 }}><Field label="Landing time (HH:MM, Trinidad time)" value={form.arrival_time} onChangeText={(v) => set('arrival_time', v)} placeholder="14:30" /></View>}
                <View style={s.toggle}><Text style={s.toggleText}>Child seat</Text><Switch value={form.child_seat} onValueChange={(v) => set('child_seat', v)} accessibilityLabel="Child seat" /></View>
                <View style={s.toggle}><Text style={s.toggleText}>Wheelchair</Text><Switch value={form.wheelchair} onValueChange={(v) => set('wheelchair', v)} accessibilityLabel="Wheelchair" /></View>
                <Field label="Note for the driver (optional)" value={form.note} onChangeText={(v) => set('note', v)} maxLength={200} />
                <GoldKey label="Book pickup" busy={booking} disabled={!ready} onPress={book} />
                {notice ? <Text style={s.notice}>{notice}</Text> : null}

                <Text style={s.section}>Your pickups</Text>
                {loading ? <ActivityIndicator color={m.gold} /> : pickups.length === 0 ? <Empty icon="airplane-outline" title="No pickups yet" /> : pickups.map((p) => (
                    <View key={p.id} style={s.card}>
                        <Text style={s.cardTitle}>{p.metadata?.guest_name ?? 'Guest'}</Text>
                        <Text style={s.cardSub}>{pickupLabel(p)}</Text>
                        <Text style={s.cardSub}>{when(p.scheduled_for)}{p.ride_pin ? ` · PIN ${p.ride_pin}` : ''}</Text>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const makeStyles = (m: Mood) => StyleSheet.create({
    root: { flex: 1, backgroundColor: m.page },
    body: { paddingHorizontal: 18, paddingBottom: 32 },
    chips: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
    toggleText: { fontSize: 15, color: m.ink },
    notice: { marginTop: 12, fontSize: 14, lineHeight: 20, color: m.ink },
    section: { marginTop: 24, marginBottom: 8, fontSize: 17, fontWeight: '700', color: m.ink },
    card: { padding: 14, marginBottom: 10, borderRadius: 18, backgroundColor: m.card, borderWidth: 2, borderColor: m.line },
    cardTitle: { fontSize: 15, fontWeight: '700', color: m.ink },
    cardSub: { marginTop: 2, fontSize: 13, color: m.dim },
});
