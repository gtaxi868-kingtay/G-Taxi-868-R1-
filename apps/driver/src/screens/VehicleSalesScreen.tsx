import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, FlatList,
    ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { ENV } from '@gtaxi/shared/env';
import type { AppScreenProps } from '../navigation/types';

const ACCENT = '#E6B450';

interface Vehicle {
    id: string;
    make: string;
    model: string;
    year: number;
    color?: string;
    vehicle_type: string;
    price_cents: number;
    image_url?: string;
    dealer?: { business_name: string; phone?: string; address?: string };
}

const TYPE_LABELS: Record<string, string> = {
    standard: 'Standard',
    xl: 'XL',
    premium: 'Premium',
    eco: 'Eco',
};

function fmt(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

export function VehicleSalesScreen({ navigation }: AppScreenProps<'VehicleSales'>) {
    const insets = useSafeAreaInsets();
    const { session } = useAuth();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<string>('all');
    const [submitting, setSubmitting] = useState<string | null>(null);
    const [noteVisible, setNoteVisible] = useState<string | null>(null);
    const [note, setNote] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const url = `${ENV.SUPABASE_URL}/functions/v1/dealer_brokerage?action=list_vehicles`;
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${session?.access_token}`,
                    apikey: ENV.SUPABASE_ANON_KEY,
                },
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to load vehicles');
            setVehicles(json.data?.vehicles || []);
        } catch (e: any) {
            setError(e?.message || 'Could not load inventory. Try again.');
        } finally {
            setLoading(false);
        }
    }, [session]);

    useEffect(() => { load(); }, [load]);

    const submitLead = async (vehicleId: string) => {
        setSubmitting(vehicleId);
        setNoteVisible(null);
        try {
            const url = `${ENV.SUPABASE_URL}/functions/v1/dealer_brokerage?action=create_lead`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session?.access_token}`,
                    apikey: ENV.SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ vehicle_id: vehicleId, notes: note || undefined }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Submission failed');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Interest Submitted',
                'The dealer will contact you within 1 business day to discuss financing options.',
                [{ text: 'OK' }]
            );
            setNote('');
        } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not submit interest. Please try again.');
        } finally {
            setSubmitting(null);
        }
    };

    const filtered = filter === 'all' ? vehicles : vehicles.filter(v => v.vehicle_type === filter);

    const renderVehicle = ({ item }: { item: Vehicle }) => {
        const isSubmitting = submitting === item.id;
        const showingNote = noteVisible === item.id;
        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.typeChip}>
                        <Text style={styles.typeChipText}>{TYPE_LABELS[item.vehicle_type] || item.vehicle_type}</Text>
                    </View>
                    <Text style={styles.price}>{fmt(item.price_cents)}</Text>
                </View>

                <Text style={styles.vehicleName}>{item.year} {item.make} {item.model}</Text>
                {item.color && <Text style={styles.vehicleSub}>{item.color}</Text>}
                {item.dealer && (
                    <Text style={styles.vehicleSub}>
                        {item.dealer.business_name}{item.dealer.address ? ` · ${item.dealer.address}` : ''}
                    </Text>
                )}

                {showingNote && (
                    <TextInput
                        style={styles.noteInput}
                        placeholder="Any notes? (trade-in, financing questions...)"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        value={note}
                        onChangeText={setNote}
                        multiline
                        numberOfLines={3}
                    />
                )}

                <View style={styles.cardActions}>
                    <TouchableOpacity
                        style={styles.noteBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setNoteVisible(showingNote ? null : item.id);
                        }}
                    >
                        <Ionicons name="chatbubble-outline" size={16} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.interestBtn, isSubmitting && { opacity: 0.5 }]}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            submitLead(item.id);
                        }}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator size="small" color="#000" />
                        ) : (
                            <Text style={styles.interestBtnText}>I'm Interested</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>Vehicle Sales</Text>
                    <Text style={styles.headerSub}>Finance your next taxi</Text>
                </View>
            </View>

            {/* Filter chips */}
            <View style={styles.filterRow}>
                {['all', 'standard', 'xl', 'premium', 'eco'].map(f => (
                    <TouchableOpacity
                        key={f}
                        style={[styles.filterChip, filter === f && styles.filterChipActive]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilter(f); }}
                    >
                        <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                            {f === 'all' ? 'All' : TYPE_LABELS[f]}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color={ACCENT} /></View>
            ) : error ? (
                <View style={styles.center}>
                    <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
                    <Text style={[styles.emptyTitle, { color: '#EF4444' }]}>Failed to load</Text>
                    <Text style={styles.emptySub}>{error}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={load}>
                        <Text style={styles.retryBtnText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : filtered.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="car-outline" size={48} color="rgba(255,255,255,0.2)" />
                    <Text style={styles.emptyTitle}>No vehicles available</Text>
                    <Text style={styles.emptySub}>Check back soon for new inventory.</Text>
                </View>
            ) : (
                <FlatList
                    data={filtered}
                    keyExtractor={i => i.id}
                    renderItem={renderVehicle}
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
                    showsVerticalScrollIndicator={false}
                    onRefresh={load}
                    refreshing={loading}
                    ListHeaderComponent={
                        <Text style={styles.listHint}>
                            Tap "I'm Interested" — our dealer partner will contact you about financing within 1 business day.
                        </Text>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#08090D' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#EAF3F6', fontWeight: '800', fontSize: 20 },
    headerSub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
    filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12, flexWrap: 'wrap' },
    filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    filterChipActive: { backgroundColor: ACCENT + '26', borderColor: ACCENT },
    filterChipText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
    filterChipTextActive: { color: ACCENT },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
    emptyTitle: { color: '#EAF3F6', fontSize: 18, fontWeight: '700', textAlign: 'center' },
    emptySub: { color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
    retryBtn: { backgroundColor: ACCENT, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 16, marginTop: 8 },
    retryBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
    list: { padding: 20, gap: 16 },
    listHint: { color: 'rgba(255,255,255,0.3)', fontSize: 12, lineHeight: 18, marginBottom: 8, textAlign: 'center' },
    card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 24, padding: 20, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    typeChip: { backgroundColor: 'rgba(230,180,80,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
    typeChipText: { color: ACCENT, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
    price: { color: ACCENT, fontSize: 18, fontWeight: '800' },
    vehicleName: { color: '#EAF3F6', fontSize: 18, fontWeight: '700' },
    vehicleSub: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
    noteInput: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, color: '#EAF3F6', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginTop: 4 },
    cardActions: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'center' },
    noteBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    interestBtn: { flex: 1, height: 40, borderRadius: 12, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
    interestBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
});
