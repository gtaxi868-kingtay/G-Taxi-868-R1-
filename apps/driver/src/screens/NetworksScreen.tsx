import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';
import { useAuth } from '../context/AuthContext';
import type { AppScreenProps } from '../navigation/types';

const V = VOICES.driver;

interface Network {
    commander_id: string;
    network_name: string;
    area: string | null;
    is_business: boolean;
    driver_count: number;
    rides_30d: number;
    rides_per_day: number;
    driver_earnings_per_day_cents: number;
    avg_fare_cents: number;
}

interface MyStatus {
    is_driver: boolean;
    current_commander_id: string | null;
    current_network_name: string | null;
    joined_at: string | null;
    can_switch_at: string | null;
    pending_request_id: string | null;
    pending_commander_id: string | null;
    pending_network_name: string | null;
}

interface JoinRequest {
    request_id: string;
    requested_at: string;
    message: string | null;
    driver_name: string | null;
    vehicle_type: string | null;
    vehicle_model: string | null;
    rating: number | null;
    rating_count: number;
    verified: boolean;
    completed_rides: number;
    current_network: string | null;
}

const ttd = (cents: number) => `TT$${(cents / 100).toFixed(0)}`;
const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });

export function NetworksScreen({ navigation }: AppScreenProps<'Networks'>) {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [networks, setNetworks] = useState<Network[]>([]);
    const [status, setStatus] = useState<MyStatus | null>(null);
    const [ownCommanderId, setOwnCommanderId] = useState<string | null>(null);
    const [requests, setRequests] = useState<JoinRequest[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!user) return;
        try {
            const [netRes, statusRes, ownRes] = await Promise.all([
                supabase.rpc('get_driver_networks'),
                supabase.rpc('get_my_network_status'),
                supabase.from('pod_commanders').select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle(),
            ]);
            if (netRes.error) throw netRes.error;
            setNetworks((netRes.data as Network[]) || []);
            setStatus((statusRes.data as MyStatus) || null);
            const ownId = ownRes.data?.id ?? null;
            setOwnCommanderId(ownId);
            if (ownId) {
                const { data: reqs } = await supabase.rpc('get_network_join_requests');
                setRequests((reqs as JoinRequest[]) || []);
            } else {
                setRequests([]);
            }
        } catch (e: any) {
            Alert.alert('Could not load networks', e?.message || 'Try again in a moment.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => { load(); }, [load]);

    const askToJoin = (net: Network) => {
        const switching = !!status?.current_network_name;
        Alert.alert(
            `Ask to join ${net.network_name}?`,
            (switching ? `You'll leave ${status!.current_network_name} if they say yes. ` : '') +
            `While in a network you keep 78% of each fare instead of 80% — the other 2% goes to ${net.network_name} for vouching for you. ` +
            `You can move again 30 days after joining.`,
            [
                { text: 'Not now', style: 'cancel' },
                {
                    text: 'Send request',
                    onPress: async () => {
                        setBusyId(net.commander_id);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        const { data, error } = await supabase.rpc('request_network_join', { p_commander_id: net.commander_id });
                        setBusyId(null);
                        if (error || !data?.success) {
                            Alert.alert('Could not send', data?.error || error?.message || 'Try again.');
                            return;
                        }
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        Alert.alert('Request sent', `${net.network_name} will see it and decide. We'll let you know.`);
                        load();
                    },
                },
            ],
        );
    };

    const cancelRequest = async () => {
        if (!status?.pending_request_id) return;
        setBusyId('cancel');
        const { data, error } = await supabase.rpc('cancel_network_join', { p_request_id: status.pending_request_id });
        setBusyId(null);
        if (error || !data?.success) {
            Alert.alert('Could not cancel', data?.error || error?.message || 'Try again.');
            return;
        }
        load();
    };

    const decide = async (req: JoinRequest, approve: boolean) => {
        setBusyId(req.request_id);
        const { data, error } = await supabase.rpc('decide_network_join', { p_request_id: req.request_id, p_approve: approve });
        setBusyId(null);
        if (error || !data?.success) {
            Alert.alert('Could not update', data?.error || error?.message || 'Try again.');
            return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        load();
    };

    const switchLocked = !!status?.can_switch_at && new Date(status.can_switch_at) > new Date();

    const buttonFor = (net: Network) => {
        if (net.commander_id === ownCommanderId) return { label: 'Your network', disabled: true };
        if (net.commander_id === status?.current_commander_id) return { label: "You're in", disabled: true };
        if (net.commander_id === status?.pending_commander_id) return { label: 'Requested', disabled: true };
        if (switchLocked) return { label: 'Locked', disabled: true };
        return { label: 'Ask to join', disabled: false };
    };

    return (
        <View style={[s.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
                    <Ionicons name="chevron-back" size={22} color={V.text} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Networks</Text>
            </View>

            {loading ? (
                <View style={s.center}><ActivityIndicator color={V.accent} /></View>
            ) : (
                <ScrollView
                    contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={V.accent} />}
                >
                    <Text style={s.lede}>
                        A network is a business or driver who vouches for you. Compare how their drivers are doing, then ask to join.
                    </Text>

                    <View style={s.statusCard}>
                        <Text style={s.statusLabel}>Your network</Text>
                        {status?.current_network_name ? (
                            <>
                                <Text style={s.statusName}>{status.current_network_name}</Text>
                                {status.can_switch_at && (
                                    <Text style={s.statusSub}>
                                        {switchLocked
                                            ? `You can move to another network from ${fmtDate(status.can_switch_at)}.`
                                            : 'You can move to another network any time.'}
                                    </Text>
                                )}
                            </>
                        ) : (
                            <Text style={s.statusSub}>You're not in a network. You keep 80% of every fare.</Text>
                        )}
                        {status?.pending_network_name && (
                            <View style={s.pendingRow}>
                                <Ionicons name="time-outline" size={16} color={V.gold} />
                                <Text style={s.pendingText} numberOfLines={2}>Waiting on {status.pending_network_name}</Text>
                                <TouchableOpacity onPress={cancelRequest} disabled={busyId === 'cancel'} accessibilityRole="button">
                                    <Text style={s.cancelText}>{busyId === 'cancel' ? 'Cancelling…' : 'Cancel'}</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>

                    {ownCommanderId && (
                        <View style={s.section}>
                            <Text style={s.sectionTitle}>Asking to join your network</Text>
                            {requests.length === 0 ? (
                                <Text style={s.empty}>No requests right now.</Text>
                            ) : requests.map((r) => (
                                <View key={r.request_id} style={s.reqCard}>
                                    <Text style={s.reqName}>{r.driver_name || 'Driver'}</Text>
                                    <Text style={s.reqMeta}>
                                        {[r.vehicle_model || r.vehicle_type, `${r.completed_rides} rides`,
                                          r.rating_count > 0 && r.rating != null ? `${Number(r.rating).toFixed(1)} rating` : null,
                                          r.verified ? 'verified' : 'not yet verified'].filter(Boolean).join(' · ')}
                                    </Text>
                                    {r.current_network && <Text style={s.reqMeta}>Currently with {r.current_network}</Text>}
                                    {r.message && <Text style={s.reqMsg}>"{r.message}"</Text>}
                                    <View style={s.reqActions}>
                                        <TouchableOpacity style={s.declineBtn} onPress={() => decide(r, false)} disabled={busyId === r.request_id} accessibilityRole="button">
                                            <Text style={s.declineText}>Decline</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={s.approveBtn} onPress={() => decide(r, true)} disabled={busyId === r.request_id} accessibilityRole="button">
                                            {busyId === r.request_id ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.approveText}>Vouch for them</Text>}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={s.section}>
                        <Text style={s.sectionTitle}>All networks · last 30 days</Text>
                        {networks.length === 0 ? (
                            <Text style={s.empty}>No networks are open yet.</Text>
                        ) : networks.map((n) => {
                            const btn = buttonFor(n);
                            const isNew = n.rides_30d === 0;
                            return (
                                <View key={n.commander_id} style={s.netCard}>
                                    <View style={s.netTop}>
                                        <View style={{ flex: 1 }}>
                                            <View style={s.netNameRow}>
                                                <Text style={s.netName} numberOfLines={1}>{n.network_name}</Text>
                                                {n.is_business && (
                                                    <View style={s.badge}><Text style={s.badgeText}>Business</Text></View>
                                                )}
                                            </View>
                                            {n.area ? <Text style={s.netArea} numberOfLines={1}>{n.area}</Text> : null}
                                        </View>
                                        <TouchableOpacity
                                            style={[s.joinBtn, btn.disabled && s.joinBtnDisabled]}
                                            onPress={() => askToJoin(n)}
                                            disabled={btn.disabled || busyId === n.commander_id}
                                            accessibilityRole="button"
                                        >
                                            {busyId === n.commander_id
                                                ? <ActivityIndicator color="#000" size="small" />
                                                : <Text style={[s.joinText, btn.disabled && s.joinTextDisabled]}>{btn.label}</Text>}
                                        </TouchableOpacity>
                                    </View>
                                    {isNew ? (
                                        <Text style={s.newNote}>
                                            New network{n.driver_count > 0 ? ` · ${n.driver_count} driver${n.driver_count === 1 ? '' : 's'}` : ''} — no rides yet.
                                        </Text>
                                    ) : (
                                        <View style={s.stats}>
                                            <View style={s.stat}><Text style={s.statNum}>{n.driver_count}</Text><Text style={s.statLabel}>drivers</Text></View>
                                            <View style={s.stat}><Text style={s.statNum}>{n.rides_per_day}</Text><Text style={s.statLabel}>rides / day</Text></View>
                                            <View style={s.stat}><Text style={s.statNum}>{ttd(n.driver_earnings_per_day_cents)}</Text><Text style={s.statLabel}>per driver / day</Text></View>
                                            <View style={s.stat}><Text style={s.statNum}>{ttd(n.avg_fare_cents)}</Text><Text style={s.statLabel}>avg fare</Text></View>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: V.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: V.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: V.text, fontWeight: '800', fontSize: 20 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, gap: 18 },
    lede: { color: V.textMuted, fontSize: 14, lineHeight: 20 },
    statusCard: { backgroundColor: 'rgba(230,180,80,0.08)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(230,180,80,0.25)', padding: 18 },
    statusLabel: { color: V.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
    statusName: { color: V.text, fontSize: 22, fontWeight: '800' },
    statusSub: { color: V.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
    pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
    pendingText: { flex: 1, color: V.text, fontSize: 13 },
    cancelText: { color: V.accent, fontWeight: '700', fontSize: 13 },
    section: { gap: 10 },
    sectionTitle: { color: V.text, fontSize: 16, fontWeight: '800' },
    empty: { color: V.textMuted, fontSize: 13 },
    reqCard: { backgroundColor: V.surface, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 16, gap: 4 },
    reqName: { color: V.text, fontSize: 16, fontWeight: '700' },
    reqMeta: { color: V.textMuted, fontSize: 12.5 },
    reqMsg: { color: V.text, fontSize: 13, fontStyle: 'italic', marginTop: 4 },
    reqActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
    declineBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', backgroundColor: V.surfaceHigh },
    declineText: { color: V.text, fontWeight: '700', fontSize: 14 },
    approveBtn: { flex: 1.4, paddingVertical: 12, borderRadius: 14, alignItems: 'center', backgroundColor: V.accent },
    approveText: { color: '#000', fontWeight: '800', fontSize: 14 },
    netCard: { backgroundColor: V.surface, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 16, gap: 12 },
    netTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    netNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    netName: { color: V.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
    badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(230,180,80,0.15)' },
    badgeText: { color: V.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    netArea: { color: V.textMuted, fontSize: 12.5, marginTop: 2 },
    joinBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: V.accent, minWidth: 104, alignItems: 'center' },
    joinBtnDisabled: { backgroundColor: V.surfaceHigh },
    joinText: { color: '#000', fontWeight: '800', fontSize: 13 },
    joinTextDisabled: { color: V.textMuted },
    newNote: { color: V.textMuted, fontSize: 12.5 },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: V.surfaceHigh, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
    statNum: { color: V.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
    statLabel: { color: V.textMuted, fontSize: 10, marginTop: 2, textAlign: 'center' },
});
