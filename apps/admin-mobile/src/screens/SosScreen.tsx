import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Linking, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { initializeSupabaseClient } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');
const BG = VOICES.admin.bg;

// G Guardian SOS desk. Every open SOS with who, where and what car, and the
// three things a guardian does: say "I'm on it" (the rider's screen then
// shows that a person has the alert), call people, and close it. An SOS
// nobody acknowledges is re-pushed every 2 minutes
// (escalate_unacknowledged_sos), so this screen is never silently stale.

type OpenSos = {
    log_id: string;
    ride_id: string | null;
    status: 'triggered' | 'acknowledged';
    created_at: string;
    acknowledged_at: string | null;
    escalations: number;
    raised_by_role: string | null;
    rider_name: string | null;
    rider_phone: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    vehicle: string | null;
    plate: string | null;
    lat: number | null;
    lng: number | null;
    pickup_address: string | null;
    dropoff_address: string | null;
};

function minutesAgo(iso: string) {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m === 0 ? 'just now' : `${m} min ago`;
}

function call(phone: string | null) {
    if (!phone) return;
    Linking.openURL(`tel:${phone.startsWith('+') ? phone : '+' + phone.replace(/\D/g, '')}`);
}

export function SosScreen() {
    const insets = useSafeAreaInsets();
    const [items, setItems] = useState<OpenSos[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const { data, error: err } = await supabase.rpc('guardian_open_sos');
        if (err) setError(err.message);
        else { setError(null); setItems((data as OpenSos[]) || []); }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 10000);
        return () => clearInterval(t);
    }, [load]);

    const acknowledge = async (id: string) => {
        setBusy(id);
        const { data, error: err } = await supabase.rpc('guardian_acknowledge_sos', { p_log_id: id });
        setBusy(null);
        if (err || !data?.success) {
            Alert.alert('Could not mark it', data?.error || err?.message || 'Try again.');
            return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        load();
    };

    const close = (id: string) => {
        Alert.alert('Close this SOS?', 'Only close it once the person is safe.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'False alarm', onPress: () => resolve(id, true) },
            { text: 'Safe, resolved', style: 'destructive', onPress: () => resolve(id, false) },
        ]);
    };

    const resolve = async (id: string, falseAlarm: boolean) => {
        setBusy(id);
        const { data, error: err } = await supabase.rpc('guardian_resolve_sos', { p_log_id: id, p_false_alarm: falseAlarm });
        setBusy(null);
        if (err || !data?.success) {
            Alert.alert('Could not close it', data?.error || err?.message || 'Try again.');
            return;
        }
        load();
    };

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: BG }}
            contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#fff" />}
        >
            <Text style={st.h1}>SOS</Text>
            <Text style={st.sub}>Open alerts. Tap "I'm on it" so the rider knows a person has it.</Text>

            {loading && <ActivityIndicator color="#FF4D4D" style={{ marginTop: 30 }} />}
            {error && <Text style={st.error}>Could not load alerts: {error}</Text>}
            {!loading && !error && items.length === 0 && (
                <Text style={st.empty}>No open SOS. You will be alerted the moment one comes in.</Text>
            )}

            {items.map((it) => {
                const open = it.status === 'triggered';
                return (
                    <View key={it.log_id} style={[st.card, open ? st.cardOpen : st.cardAck]}>
                        <Text style={[st.badge, open ? st.badgeOpen : st.badgeAck]}>
                            {open ? `UNANSWERED · ${minutesAgo(it.created_at)}` : `ON IT · since ${minutesAgo(it.acknowledged_at || it.created_at)}`}
                        </Text>
                        <Text style={st.line}>Raised by the {it.raised_by_role || 'rider'}</Text>
                        <Text style={st.line}>Rider: {it.rider_name || 'unknown'} {it.rider_phone ? `· ${it.rider_phone}` : ''}</Text>
                        <Text style={st.line}>Driver: {it.driver_name || 'unknown'} {it.driver_phone ? `· ${it.driver_phone}` : ''}</Text>
                        {(it.vehicle || it.plate) && <Text style={st.line}>Car: {[it.vehicle, it.plate].filter(Boolean).join(' · ')}</Text>}
                        {it.dropoff_address && <Text style={st.line}>Going to: {it.dropoff_address}</Text>}
                        {it.emergency_contact_phone && (
                            <Text style={st.line}>Emergency contact: {it.emergency_contact_name || ''} {it.emergency_contact_phone}</Text>
                        )}

                        {open && (
                            <TouchableOpacity style={[st.btn, st.primary]} disabled={busy === it.log_id}
                                onPress={() => acknowledge(it.log_id)} accessibilityRole="button" accessibilityLabel="I'm on it">
                                <Text style={st.primaryText}>{busy === it.log_id ? '...' : "I'M ON IT"}</Text>
                            </TouchableOpacity>
                        )}

                        <View style={st.row}>
                            <TouchableOpacity style={[st.btn, st.secondary, st.half]} disabled={!it.rider_phone} onPress={() => call(it.rider_phone)}>
                                <Text style={st.secondaryText}>CALL RIDER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[st.btn, st.secondary, st.half]} disabled={!it.driver_phone} onPress={() => call(it.driver_phone)}>
                                <Text style={st.secondaryText}>CALL DRIVER</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={st.row}>
                            <TouchableOpacity style={[st.btn, st.secondary, st.half]} disabled={it.lat == null}
                                onPress={() => Linking.openURL(`https://maps.google.com/?q=${it.lat},${it.lng}`)}>
                                <Text style={st.secondaryText}>OPEN MAP</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[st.btn, st.secondary, st.half]} onPress={() => Linking.openURL('tel:999')}>
                                <Text style={st.secondaryText}>CALL 999</Text>
                            </TouchableOpacity>
                        </View>
                        {it.emergency_contact_phone && (
                            <TouchableOpacity style={[st.btn, st.secondary]} onPress={() => call(it.emergency_contact_phone)}>
                                <Text style={st.secondaryText}>CALL EMERGENCY CONTACT</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => close(it.log_id)} disabled={busy === it.log_id}>
                            <Text style={st.closeText}>Close this SOS</Text>
                        </TouchableOpacity>
                    </View>
                );
            })}
        </ScrollView>
    );
}

const st = StyleSheet.create({
    h1: { color: '#FF4D4D', fontSize: 28, fontWeight: '900' },
    sub: { color: 'rgba(255,255,255,0.65)', marginTop: 4, marginBottom: 16 },
    error: { color: '#FFB3B3', marginTop: 12 },
    empty: { color: 'rgba(255,255,255,0.7)', marginTop: 24, textAlign: 'center' },
    card: { borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1 },
    cardOpen: { backgroundColor: 'rgba(255,77,77,0.12)', borderColor: 'rgba(255,77,77,0.7)' },
    cardAck: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.15)' },
    badge: { fontWeight: '900', fontSize: 12, letterSpacing: 1, marginBottom: 8 },
    badgeOpen: { color: '#FF4D4D' },
    badgeAck: { color: '#34D399' },
    line: { color: '#FFFFFF', fontSize: 14, marginBottom: 3 },
    btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
    primary: { backgroundColor: '#FF4D4D' },
    primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
    secondary: { backgroundColor: 'rgba(255,255,255,0.08)' },
    secondaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
    row: { flexDirection: 'row', gap: 10 },
    half: { flex: 1 },
    closeText: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 12 },
});
