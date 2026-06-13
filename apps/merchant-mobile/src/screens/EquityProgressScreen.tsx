import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';

const { supabase } = initializeSupabaseClient('native');
const GOLD = '#F59E0B';
const ACCENT = '#8B5CF6';

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysAtCurrentRate(current: number, target: number, totalBookings: number, firstBookingDate: string | null): string {
    if (!firstBookingDate || totalBookings < 2) return '—';
    const daysSince = (Date.now() - new Date(firstBookingDate).getTime()) / (1000 * 60 * 60 * 24);
    const rate = totalBookings / daysSince;
    if (rate <= 0) return '—';
    const remaining = target - current;
    return `~${Math.ceil(remaining / rate)} days`;
}

export function EquityProgressScreen({ navigation, route }: any) {
    const { contract_id } = route?.params || {};
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const [contracts, setContracts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        const load = async () => {
            const { data: merchant } = await supabase.from('merchants').select('id').eq('created_by', user.id).maybeSingle();
            if (!merchant) { setLoading(false); return; }

            let query = supabase
                .from('equity_contracts')
                .select(`
                    *,
                    travel_properties(name, destination_name, cover_image_url)
                `)
                .eq('merchant_id', merchant.id)
                .neq('status', 'cancelled');

            if (contract_id) query = query.eq('id', contract_id);

            const { data } = await query.order('created_at', { ascending: false });
            setContracts(data || []);
            setLoading(false);
        };
        load();
    }, [user, contract_id]);

    if (loading) {
        return (
            <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={GOLD} />
            </View>
        );
    }

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={22} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Equity Progress</Text>
            </View>

            {contracts.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="trending-up-outline" size={48} color="rgba(255,255,255,0.15)" />
                    <Text style={styles.emptyTitle}>No equity contracts</Text>
                    <Text style={styles.emptySub}>Once you join the G-Taxi Equity Pipeline, your progress toward ownership will appear here.</Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
                    {contracts.map(contract => {
                        const prop = contract.travel_properties;
                        const t1pct = Math.min(100, (contract.current_room_nights_delivered / contract.tier_1_rooms) * 100);
                        const t2pct = Math.min(100, (contract.current_room_nights_delivered / contract.tier_2_rooms) * 100);
                        const vestT1 = contract.current_room_nights_delivered >= contract.tier_1_rooms;
                        const vestT2 = contract.current_room_nights_delivered >= contract.tier_2_rooms;

                        return (
                            <View key={contract.id} style={styles.contractCard}>
                                <LinearGradient
                                    colors={['rgba(245,158,11,0.12)', 'rgba(245,158,11,0.04)']}
                                    style={styles.contractGrad}
                                >
                                    {/* Property name + status */}
                                    <View style={styles.contractHeader}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.propName}>{prop?.name || 'Property'}</Text>
                                            <Text style={styles.propDest}>{prop?.destination_name}</Text>
                                        </View>
                                        <View style={[styles.statusBadge, { backgroundColor: contract.current_equity_pct > 0 ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)' }]}>
                                            <Text style={[styles.statusText, { color: contract.current_equity_pct > 0 ? GOLD : 'rgba(255,255,255,0.4)' }]}>
                                                {contract.current_equity_pct > 0 ? `${contract.current_equity_pct}% vested` : contract.status}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Room nights counter */}
                                    <View style={styles.nightsRow}>
                                        <Text style={styles.nightsNum}>{contract.current_room_nights_delivered}</Text>
                                        <Text style={styles.nightsLabel}>room-nights delivered</Text>
                                    </View>

                                    {/* Tier 1 progress */}
                                    <View style={styles.tierSection}>
                                        <View style={styles.tierRow}>
                                            <Text style={styles.tierLabel}>
                                                Tier 1 — {contract.tier_1_equity_pct}% equity
                                            </Text>
                                            <Text style={styles.tierTarget}>
                                                {vestT1 ? '✓ Vested' : `${contract.current_room_nights_delivered}/${contract.tier_1_rooms} nights`}
                                            </Text>
                                        </View>
                                        <View style={styles.progressBar}>
                                            <View style={[styles.progressFill, { width: `${t1pct}%` as any, backgroundColor: vestT1 ? GOLD : ACCENT }]} />
                                        </View>
                                        {!vestT1 && (
                                            <Text style={styles.projectedLabel}>
                                                Projected: {daysAtCurrentRate(contract.current_room_nights_delivered, contract.tier_1_rooms, contract.current_room_nights_delivered, contract.signed_at)}
                                            </Text>
                                        )}
                                    </View>

                                    {/* Tier 2 progress */}
                                    <View style={styles.tierSection}>
                                        <View style={styles.tierRow}>
                                            <Text style={styles.tierLabel}>
                                                Tier 2 — {contract.tier_2_equity_pct}% equity
                                            </Text>
                                            <Text style={styles.tierTarget}>
                                                {vestT2 ? '✓ Vested' : `${contract.current_room_nights_delivered}/${contract.tier_2_rooms} nights`}
                                            </Text>
                                        </View>
                                        <View style={styles.progressBar}>
                                            <View style={[styles.progressFill, { width: `${t2pct}%` as any, backgroundColor: vestT2 ? GOLD : 'rgba(245,158,11,0.4)' }]} />
                                        </View>
                                    </View>

                                    {/* Capital deployed */}
                                    {contract.capital_deployed_cents > 0 && (
                                        <View style={styles.capitalRow}>
                                            <Ionicons name="cash-outline" size={16} color={GOLD} />
                                            <Text style={styles.capitalText}>
                                                TTD ${(contract.capital_deployed_cents / 100).toLocaleString()} platform capital deployed
                                            </Text>
                                        </View>
                                    )}

                                    {/* Contract details */}
                                    {contract.signed_at && (
                                        <Text style={styles.signedDate}>Contract signed {fmtDate(contract.signed_at)}</Text>
                                    )}

                                    {/* Legal document */}
                                    {contract.legal_document_url && (
                                        <TouchableOpacity
                                            style={styles.legalBtn}
                                            onPress={() => {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                Linking.openURL(contract.legal_document_url);
                                            }}
                                        >
                                            <Ionicons name="document-text-outline" size={16} color={ACCENT} />
                                            <Text style={styles.legalBtnText}>View Contract Document</Text>
                                        </TouchableOpacity>
                                    )}
                                </LinearGradient>
                            </View>
                        );
                    })}

                    {/* Explainer */}
                    <View style={styles.explainer}>
                        <Text style={styles.explainerTitle}>How Equity Vesting Works</Text>
                        <Text style={styles.explainerBody}>
                            G-Taxi routes travelers to your property through Caribbean Escapes packages. Every confirmed guest-night counts toward your vesting milestones.{'\n\n'}
                            Tier 1 (150 nights) → 5% equity in your property holding company.{'\n'}
                            Tier 2 (400 nights) → an additional 10% equity (15% total).{'\n\n'}
                            Platform capital may be deployed to cover renovation or marketing costs, accelerating vesting at G-Taxi's discretion.
                        </Text>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 20 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
    emptyTitle: { color: '#FFF', fontWeight: '700', fontSize: 18, textAlign: 'center' },
    emptySub: { color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 19, textAlign: 'center' },
    scroll: { padding: 20, gap: 20 },
    contractCard: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)' },
    contractGrad: { padding: 22, gap: 16 },
    contractHeader: { flexDirection: 'row', alignItems: 'flex-start' },
    propName: { color: '#FFF', fontWeight: '800', fontSize: 18 },
    propDest: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 2 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
    statusText: { fontWeight: '700', fontSize: 11, textTransform: 'capitalize' },
    nightsRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    nightsNum: { color: GOLD, fontWeight: '900', fontSize: 40 },
    nightsLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
    tierSection: { gap: 6 },
    tierRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    tierLabel: { color: 'rgba(255,255,255,0.6)', fontWeight: '600', fontSize: 13 },
    tierTarget: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
    progressBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 99 },
    projectedLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 11 },
    capitalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 12, padding: 12 },
    capitalText: { color: GOLD, fontSize: 13, fontWeight: '600' },
    signedDate: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },
    legalBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(139,92,246,0.08)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(139,92,246,0.15)' },
    legalBtnText: { color: ACCENT, fontWeight: '600', fontSize: 13 },
    explainer: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
    explainerTitle: { color: '#FFF', fontWeight: '700', fontSize: 15, marginBottom: 10 },
    explainerBody: { color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 20 },
});
