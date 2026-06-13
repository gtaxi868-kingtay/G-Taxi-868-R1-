import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    FlatList, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@gtaxi/core';
import type { AppScreenProps } from '../navigation/types';

const DESTINATIONS = [
    { code: 'ALL', label: 'All' },
    { code: 'TAB', label: 'Tobago' },
    { code: 'BGI', label: 'Barbados' },
    { code: 'GND', label: 'Grenada' },
    { code: 'ANU', label: 'Antigua' },
    { code: 'SKB', label: 'St Kitts' },
];

const DEST_COLORS: Record<string, [string, string]> = {
    TAB: ['#0EA5E9', '#0369A1'],
    BGI: ['#8B5CF6', '#6D28D9'],
    GND: ['#10B981', '#047857'],
    ANU: ['#F59E0B', '#B45309'],
    SKB: ['#EC4899', '#BE185D'],
    DEFAULT: ['#3B82F6', '#1D4ED8'],
};

function fmtPrice(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function TravelStorefrontScreen({ navigation }: AppScreenProps<'TravelStorefront'>) {
    const insets = useSafeAreaInsets();
    const [packages, setPackages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [destFilter, setDestFilter] = useState('ALL');

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const { data, error: fnError } = await supabase.functions.invoke('get_travel_packages', {
                body: destFilter !== 'ALL' ? { destination_code: destFilter } : {},
            });
            if (fnError) {
                setError(fnError.message || 'Failed to load packages');
            } else if (data?.packages) {
                setPackages(data.packages);
            } else {
                setPackages([]);
            }
        } catch (err: any) {
            setError(err?.message || 'Something went wrong. Pull down to retry.');
        }
        setLoading(false);
        setRefreshing(false);
    }, [destFilter]);

    useEffect(() => { load(); }, [load]);

    const onRefresh = () => { setRefreshing(true); load(true); };

    const renderPackage = ({ item }: { item: any }) => {
        const colors = DEST_COLORS[item.destination_code] ?? DEST_COLORS.DEFAULT;
        const flightInfo = item.flight_info || {};
        const hotelInfo = item.hotel_info || {};
        const nights = hotelInfo.nights || '';

        return (
            <TouchableOpacity
                activeOpacity={0.88}
                onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    navigation.navigate('TravelPackageDetail', { packageId: item.id });
                }}
                style={styles.card}
            >
                <LinearGradient
                    colors={[colors[0] + '33', colors[1] + '18']}
                    style={styles.cardGrad}
                >
                    {/* Header */}
                    <View style={styles.cardHeader}>
                        <View>
                            <Text style={styles.cardRoute}>
                                {item.origin_code} → {item.destination_code}
                            </Text>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                        </View>
                        {item.urgency !== 'available' && (
                            <View style={[styles.urgencyBadge,
                                { backgroundColor: item.urgency === 'last_few' ? '#EF4444' : '#F59E0B' }]}>
                                <Text style={styles.urgencyText}>
                                    {item.urgency === 'last_few' ? `${item.seats_remaining} left` : 'Filling up'}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Details row */}
                    <View style={styles.detailRow}>
                        <View style={styles.detailItem}>
                            <Ionicons name="airplane-outline" size={14} color="rgba(255,255,255,0.6)" />
                            <Text style={styles.detailText}>
                                {flightInfo.airline || 'Flight'} · {flightInfo.cabin || 'Economy'}
                            </Text>
                        </View>
                        {nights ? (
                            <View style={styles.detailItem}>
                                <Ionicons name="bed-outline" size={14} color="rgba(255,255,255,0.6)" />
                                <Text style={styles.detailText}>{nights}N · {hotelInfo.name || 'Hotel'}</Text>
                            </View>
                        ) : null}
                        {item.includes_airport_transfer && (
                            <View style={styles.detailItem}>
                                <Ionicons name="car-outline" size={14} color="rgba(255,255,255,0.6)" />
                                <Text style={styles.detailText}>Transfer incl.</Text>
                            </View>
                        )}
                    </View>

                    {/* Footer */}
                    <View style={styles.cardFooter}>
                        <View>
                            <Text style={styles.departure}>{fmtDate(item.departure_at)}</Text>
                            <Text style={styles.seats}>{item.seats_remaining} seats remaining</Text>
                        </View>
                        <View style={styles.priceBlock}>
                            <Text style={styles.priceLabel}>per person</Text>
                            <Text style={styles.price}>{fmtPrice(item.price_per_person_cents)}</Text>
                        </View>
                    </View>
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.headerTitle}>Caribbean Escapes</Text>
                    <Text style={styles.headerSub}>Fly + Stay packages from POS</Text>
                </View>
                <TouchableOpacity
                    onPress={() => navigation.navigate('TravelMyBookings')}
                    style={styles.myBookingsBtn}
                >
                    <Ionicons name="receipt-outline" size={20} color="#3B82F6" />
                </TouchableOpacity>
            </View>

            {/* Destination filter chips */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                style={styles.chipsScroll}
            >
                {DESTINATIONS.map(d => (
                    <TouchableOpacity
                        key={d.code}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setDestFilter(d.code);
                        }}
                        style={[styles.chip, destFilter === d.code && styles.chipActive]}
                    >
                        <Text style={[styles.chipText, destFilter === d.code && styles.chipTextActive]}>
                            {d.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#3B82F6" />
                </View>
            ) : error ? (
                <View style={styles.center}>
                    <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
                    <Text style={[styles.emptyTitle, { color: '#EF4444' }]}>Failed to load</Text>
                    <Text style={styles.emptySub}>{error}</Text>
                    <TouchableOpacity style={styles.waitlistBtn} onPress={() => load()}>
                        <Text style={styles.waitlistBtnText}>Retry →</Text>
                    </TouchableOpacity>
                </View>
            ) : packages.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="airplane-outline" size={48} color="rgba(255,255,255,0.2)" />
                    <Text style={styles.emptyTitle}>No packages yet</Text>
                    <Text style={styles.emptySub}>
                        {destFilter !== 'ALL'
                            ? `No packages to ${DESTINATIONS.find(d => d.code === destFilter)?.label} right now.`
                            : 'New Caribbean packages drop regularly. Check back soon.'}
                    </Text>
                    <TouchableOpacity
                        style={styles.waitlistBtn}
                        onPress={() => navigation.navigate('TravelWaitlist')}
                    >
                        <Text style={styles.waitlistBtnText}>Join Waitlist →</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={packages}
                    keyExtractor={i => i.id}
                    renderItem={renderPackage}
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}
                    ListFooterComponent={
                        <TouchableOpacity
                            style={styles.waitlistFooter}
                            onPress={() => navigation.navigate('TravelWaitlist')}
                        >
                            <Ionicons name="notifications-outline" size={16} color="#3B82F6" />
                            <Text style={styles.waitlistFooterText}>Get notified about new destinations</Text>
                        </TouchableOpacity>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0A0A0F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#FFF', fontWeight: '800', fontSize: 20 },
    headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 1 },
    myBookingsBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(59,130,246,0.12)', alignItems: 'center', justifyContent: 'center' },

    chipsScroll: { flexGrow: 0 },
    chips: { paddingHorizontal: 20, gap: 8, paddingBottom: 16 },
    chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    chipActive: { backgroundColor: 'rgba(59,130,246,0.2)', borderColor: '#3B82F6' },
    chipText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 13 },
    chipTextActive: { color: '#3B82F6' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
    emptyTitle: { color: '#FFF', fontWeight: '700', fontSize: 18, textAlign: 'center' },
    emptySub: { color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
    waitlistBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 99, backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: '#3B82F6' },
    waitlistBtnText: { color: '#3B82F6', fontWeight: '700' },

    list: { padding: 20, gap: 16 },
    card: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
    cardGrad: { padding: 20 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
    cardRoute: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 1 },
    cardTitle: { color: '#FFF', fontWeight: '800', fontSize: 18, marginTop: 2 },
    urgencyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
    urgencyText: { color: '#FFF', fontWeight: '700', fontSize: 11 },
    detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
    detailItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    detailText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    departure: { color: '#FFF', fontWeight: '700', fontSize: 14 },
    seats: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
    priceBlock: { alignItems: 'flex-end' },
    priceLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
    price: { color: '#FFF', fontWeight: '800', fontSize: 22 },

    waitlistFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, padding: 16 },
    waitlistFooterText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
});
