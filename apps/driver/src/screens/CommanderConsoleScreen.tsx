import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@gtaxi/core';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
    primary: '#1DE0E6',
    background: '#0B0E12',
    borderLight: 'rgba(255,255,255,0.10)',
    textPrimary: '#F2F5F8',
    textSecondary: 'rgba(242,245,248,0.68)',
    textTertiary: 'rgba(242,245,248,0.42)',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
};
const SURFACE = { base: '#0B0E12', elevated: '#1A1F27' };

type Tab = 'health' | 'drivers' | 'pucks' | 'merchants' | 'succession';
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'health', label: 'Health', icon: 'pulse' },
    { key: 'drivers', label: 'Drivers', icon: 'people' },
    { key: 'pucks', label: 'G-Touch', icon: 'radio' },
    { key: 'merchants', label: 'G-Partner', icon: 'storefront' },
    { key: 'succession', label: 'Succession', icon: 'git-branch' },
];

// Allowed puck lifecycle transitions (mirrors commander_update_puck_status).
const PUCK_NEXT: Record<string, string[]> = {
    assigned: ['activated'],
    activated: ['live', 'suspended'],
    live: ['suspended', 'replaced'],
    suspended: ['live', 'replaced'],
};

const RANK_NEXT: Record<string, { rank: string; label: string } | null> = {
    driver: { rank: 'senior_driver', label: 'Promote to Senior' },
    senior_driver: { rank: 'commander_candidate', label: 'Promote to Candidate' },
    commander_candidate: null,
};

export function CommanderConsoleScreen() {
    const navigation = useNavigation();
    const [tab, setTab] = useState<Tab>('health');
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [health, setHealth] = useState<any>(null);
    const [drivers, setDrivers] = useState<any[]>([]);
    const [pucks, setPucks] = useState<any[]>([]);
    const [merchants, setMerchants] = useState<any[]>([]);
    const [successors, setSuccessors] = useState<any[]>([]);
    const [territoryId, setTerritoryId] = useState<string | null>(null);

    const loadTab = useCallback(async (which: Tab) => {
        setLoading(true);
        try {
            if (which === 'health') {
                const { data } = await supabase.functions.invoke('get_territory_health');
                if (data?.success) setHealth(data.health);
            } else if (which === 'drivers') {
                const { data } = await supabase.functions.invoke('commander_get_territory');
                if (data?.success) {
                    setDrivers(data.drivers || []);
                    setTerritoryId(data.commander?.territory_id || null);
                }
            } else if (which === 'pucks') {
                const { data } = await supabase.functions.invoke('commander_get_pucks');
                if (data?.success) setPucks(data.nodes || []);
            } else if (which === 'merchants') {
                // No dedicated list endpoint; read pending merchants for the territory.
                if (territoryId) {
                    const { data } = await supabase
                        .from('merchants')
                        .select('id, name, category, activation_status')
                        .eq('territory_id', territoryId)
                        .eq('activation_status', 'pending');
                    setMerchants(data || []);
                } else {
                    const { data: terr } = await supabase.functions.invoke('commander_get_territory');
                    const tid = terr?.commander?.territory_id || null;
                    setTerritoryId(tid);
                    if (tid) {
                        const { data } = await supabase
                            .from('merchants')
                            .select('id, name, category, activation_status')
                            .eq('territory_id', tid)
                            .eq('activation_status', 'pending');
                        setMerchants(data || []);
                    }
                }
            } else if (which === 'succession') {
                const { data } = await supabase.functions.invoke('commander_set_successor', { body: { action: 'list' } });
                if (data?.success) setSuccessors(data.successors || []);
            }
        } catch (err: any) {
            Alert.alert('Load failed', err.message);
        } finally {
            setLoading(false);
        }
    }, [territoryId]);

    useEffect(() => { loadTab(tab); }, [tab, loadTab]);

    const promoteDriver = async (driver: any) => {
        const next = RANK_NEXT[driver.rank as string];
        if (!next) return;
        setBusyId(driver.id);
        try {
            const { data, error } = await supabase.functions.invoke('commander_promote_driver', {
                body: { driver_id: driver.id, target_rank: next.rank, reason: 'Promoted from console' },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Promotion failed');
            await loadTab('drivers');
        } catch (err: any) {
            Alert.alert('Could not promote', err.message);
        } finally {
            setBusyId(null);
        }
    };

    const changePuck = async (node: any, status: string) => {
        setBusyId(node.id);
        try {
            const { data, error } = await supabase.functions.invoke('commander_update_puck_status', {
                body: { node_id: node.id, lifecycle_status: status },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Update failed');
            await loadTab('pucks');
        } catch (err: any) {
            Alert.alert('Could not update G-Touch Point', err.message);
        } finally {
            setBusyId(null);
        }
    };

    const activateMerchant = async (merchant: any) => {
        setBusyId(merchant.id);
        try {
            const { data, error } = await supabase.functions.invoke('commander_onboard_merchant', {
                body: { merchant_id: merchant.id, action: 'activate' },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Activation failed');
            setMerchants((prev) => prev.filter((m) => m.id !== merchant.id));
        } catch (err: any) {
            Alert.alert('Could not activate', err.message);
        } finally {
            setBusyId(null);
        }
    };

    const confirmSuccessor = async (s: any) => {
        setBusyId(s.id);
        try {
            const { data, error } = await supabase.functions.invoke('commander_set_successor', {
                body: { action: 'confirm', successor_id: s.successor_id },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed');
            await loadTab('succession');
        } catch (err: any) {
            Alert.alert('Could not confirm', err.message);
        } finally {
            setBusyId(null);
        }
    };

    const removeSuccessor = async (s: any) => {
        setBusyId(s.id);
        try {
            const { data, error } = await supabase.functions.invoke('commander_set_successor', {
                body: { action: 'remove', successor_id: s.successor_id },
            });
            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed');
            await loadTab('succession');
        } catch (err: any) {
            Alert.alert('Could not remove', err.message);
        } finally {
            setBusyId(null);
        }
    };

    const handoffTerritory = (s: any) => {
        Alert.alert(
            'Hand Off Territory',
            `Transfer command of this territory to ${s.successor?.full_name || 'this successor'}? You will step down as G-Lead.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Hand Off',
                    style: 'destructive',
                    onPress: async () => {
                        setBusyId(s.id);
                        try {
                            const { data, error } = await supabase.functions.invoke('commander_handoff', {
                                body: { to_user_id: s.successor_id, reason: 'Voluntary handoff from console' },
                            });
                            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Handoff failed');
                            Alert.alert('Done', 'Territory handed off.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
                        } catch (err: any) {
                            Alert.alert('Handoff failed', err.message);
                        } finally {
                            setBusyId(null);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="chevron-back" color={COLORS.textPrimary} size={28} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>TERRITORY CONSOLE</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.tabBar}>
                {TABS.map((t) => (
                    <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
                        <Ionicons name={t.icon} size={18} color={tab === t.key ? COLORS.background : COLORS.textSecondary} />
                        <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></View>
            ) : (
                <ScrollView contentContainerStyle={styles.scroll}>
                    {tab === 'health' && (
                        health ? (
                            <>
                                <View style={styles.scoreCard}>
                                    <Text style={styles.scoreLabel}>TERRITORY HEALTH</Text>
                                    <Text style={styles.scoreValue}>{health.score ?? '—'}<Text style={styles.scoreMax}>/100</Text></Text>
                                    <Text style={styles.scoreGrade}>{health.grade || ''}</Text>
                                </View>
                                {health.breakdown && Object.entries(health.breakdown).map(([k, v]: any) => (
                                    <View key={k} style={styles.row}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.rowTitle}>{k.replace(/_/g, ' ')}</Text>
                                            <Text style={styles.rowMeta}>{v.detail}</Text>
                                        </View>
                                        <Text style={styles.rowValue}>{v.score}/{v.max}</Text>
                                    </View>
                                ))}
                            </>
                        ) : <Text style={styles.empty}>No health data</Text>
                    )}

                    {tab === 'drivers' && (
                        drivers.length === 0 ? <Text style={styles.empty}>No drivers in territory</Text> :
                        drivers.map((d) => {
                            const next = RANK_NEXT[d.rank as string];
                            return (
                                <View key={d.id} style={styles.row}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.rowTitle}>{d.name || 'Driver'}</Text>
                                        <Text style={styles.rowMeta}>{(d.rank || 'driver').replace(/_/g, ' ')} · {d.is_online ? 'online' : 'offline'}</Text>
                                    </View>
                                    {next && (
                                        busyId === d.id ? <ActivityIndicator color={COLORS.primary} /> :
                                        <TouchableOpacity style={styles.smallBtn} onPress={() => promoteDriver(d)}>
                                            <Text style={styles.smallBtnText}>{next.label}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            );
                        })
                    )}

                    {tab === 'pucks' && (
                        pucks.length === 0 ? <Text style={styles.empty}>No G-Touch Points deployed</Text> :
                        pucks.map((p) => {
                            const transitions = PUCK_NEXT[p.lifecycle_status] || [];
                            return (
                                <View key={p.id} style={styles.puckRow}>
                                    <View style={styles.puckHead}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.rowTitle}>{p.location_name || p.merchant?.name || 'G-Touch Point'}</Text>
                                            <Text style={styles.rowMeta}>{p.lifecycle_status} · {p.battery_level ?? '—'}%</Text>
                                        </View>
                                        {busyId === p.id && <ActivityIndicator color={COLORS.primary} />}
                                    </View>
                                    {transitions.length > 0 && busyId !== p.id && (
                                        <View style={styles.puckActions}>
                                            {transitions.map((t) => (
                                                <TouchableOpacity key={t} style={styles.smallBtn} onPress={() => changePuck(p, t)}>
                                                    <Text style={styles.smallBtnText}>{t}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            );
                        })
                    )}

                    {tab === 'merchants' && (
                        merchants.length === 0 ? <Text style={styles.empty}>No pending G-Partners</Text> :
                        merchants.map((m) => (
                            <View key={m.id} style={styles.row}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.rowTitle}>{m.name}</Text>
                                    <Text style={styles.rowMeta}>{m.category || 'local'} · {m.activation_status}</Text>
                                </View>
                                {busyId === m.id ? <ActivityIndicator color={COLORS.primary} /> :
                                <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => activateMerchant(m)}>
                                    <Text style={[styles.smallBtnText, { color: COLORS.background }]}>Activate</Text>
                                </TouchableOpacity>}
                            </View>
                        ))
                    )}

                    {tab === 'succession' && (
                        successors.length === 0 ? <Text style={styles.empty}>No successors named</Text> :
                        successors.map((sc) => (
                            <View key={sc.id} style={styles.puckRow}>
                                <View style={styles.puckHead}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.rowTitle}>{sc.successor?.full_name || sc.successor?.email || 'Successor'}</Text>
                                        <Text style={styles.rowMeta}>Priority {sc.priority} · {sc.status}</Text>
                                    </View>
                                    {busyId === sc.id && <ActivityIndicator color={COLORS.primary} />}
                                </View>
                                {busyId !== sc.id && (
                                    <View style={styles.puckActions}>
                                        {sc.status === 'pending' && (
                                            <TouchableOpacity style={styles.smallBtn} onPress={() => confirmSuccessor(sc)}>
                                                <Text style={styles.smallBtnText}>Confirm</Text>
                                            </TouchableOpacity>
                                        )}
                                        {sc.status === 'confirmed' && (
                                            <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => handoffTerritory(sc)}>
                                                <Text style={[styles.smallBtnText, { color: COLORS.background }]}>Hand Off</Text>
                                            </TouchableOpacity>
                                        )}
                                        <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => removeSuccessor(sc)}>
                                            <Text style={[styles.smallBtnText, { color: COLORS.error }]}>Remove</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        ))
                    )}

                    <View style={{ height: 40 }} />
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
    backButton: { padding: 4 },
    headerTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 2, color: COLORS.textPrimary },
    tabBar: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, gap: 4 },
    tabActive: { backgroundColor: COLORS.primary },
    tabLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textSecondary },
    tabLabelActive: { color: COLORS.background },
    scroll: { padding: 20 },
    empty: { color: COLORS.textTertiary, textAlign: 'center', paddingVertical: 40, fontSize: 14 },
    scoreCard: { backgroundColor: SURFACE.elevated, borderRadius: 24, padding: 24, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: COLORS.primary + '30' },
    scoreLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 2, color: COLORS.primary, marginBottom: 8 },
    scoreValue: { fontSize: 48, fontWeight: '800', color: COLORS.textPrimary },
    scoreMax: { fontSize: 22, color: COLORS.textTertiary },
    scoreGrade: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE.elevated, padding: 16, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.borderLight },
    rowTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, textTransform: 'capitalize' },
    rowMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, textTransform: 'capitalize' },
    rowValue: { fontSize: 15, fontWeight: '800', color: COLORS.primary },
    puckRow: { backgroundColor: SURFACE.elevated, padding: 16, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.borderLight },
    puckHead: { flexDirection: 'row', alignItems: 'center' },
    puckActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    smallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: COLORS.borderLight },
    smallBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary, textTransform: 'capitalize' },
    approveBtn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    rejectBtn: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.30)' },
});
