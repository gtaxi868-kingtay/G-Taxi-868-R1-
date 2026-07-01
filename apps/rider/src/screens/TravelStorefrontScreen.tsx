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
import { LUXE } from '@gtaxi/design-system/tokens';
import type { AppScreenProps } from '../navigation/types';

const DESTINATIONS = [
    { code: 'ALL', label: 'All' },
    { code: 'TAB', label: 'Tobago' },
    { code: 'BGI', label: 'Barbados' },
    { code: 'GND', label: 'Grenada' },
    { code: 'ANU', label: 'Antigua' },
    { code: 'SKB', label: 'St Kitts' },
];

// Cool, desaturated per-destination tints (violet / cyan / teal family only — no warm
// outliers). Rendered at low alpha behind a scrim; the destination photo leads when present.
const DEST_TINT: Record<string, [string, string]> = {
    TAB: ['#0E7FA8', '#0B4C6B'],
    BGI: ['#6D28D9', '#3B1E7A'],
    GND: ['#0E7490', '#134152'],
    ANU: ['#3B5BA5', '#1E2F5E'],
    SKB: ['#7C3AED', '#4C1D95'],
    DEFAULT: ['#1A1038', '#0A0F1E'],
};

function fmtAmount(cents: number) {
    return (cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 });
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
            const { data, error: fnError } = await supabase.functions.invoke('travel', {
                body: destFilter !== 'ALL' ? { action: 'get_packages', destination_code: destFilter } : { action: 'get_packages' },
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
        const tint = DEST_TINT[item.destination_code] ?? DEST_TINT.DEFAULT;
        const flightInfo = item.flight_info || {};
        const hotelInfo = item.hotel_info || {};
        const nights = hotelInfo.nights || '';
        const heroImage = item.image_url || item.hero_image || null;

        return (
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    navigation.navigate('TravelPackageDetail', { packageId: item.id });
                }}
                style={styles.card}
            >
                {/* Hero: destination photo when present, cool tint otherwise — always scrimmed */}
                <View style={styles.hero}>
                    {heroImage ? (
                        <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                        <LinearGradient colors={[tint[0], tint[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                    )}
                    <LinearGradient
                        colors={['rgba(7,7,15,0)', 'rgba(7,7,15,0.55)', 'rgba(7,7,15,0.96)']}
                        locations={[0.3, 0.7, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                    {item.urgency && item.urgency !== 'available' && (
                        <View style={styles.urgencyBadge}>
                            <Text style={styles.urgencyText}>
                                {item.urgency === 'last_few' ? `${item.seats_remaining} left` : 'Filling up'}
                            </Text>
                        </View>
                    )}
                    <View style={styles.heroCaption}>
                        <Text style={styles.cardRoute}>{item.origin_code} → {item.destination_code}</Text>
                        <Text style={styles.cardTitle}>{item.title}</Text>
                    </View>
                </View>

                {/* Body */}
                <View style={styles.cardBody}>
                    {/* The one lit edge */}
                    <LinearGradient
                        colors={[LUXE.signature[0], LUXE.signature[1], 'rgba(52,230,236,0.04)']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.litHairline}
                    />
                    <View style={styles.detailRow}>
                        <Text style={styles.detailText}>{(flightInfo.airline || 'FLIGHT')} · {(flightInfo.cabin || 'ECONOMY')}</Text>
                        {nights ? <Text style={styles.detailText}>{nights}N · {(hotelInfo.name || 'HOTEL')}</Text> : null}
                        {item.includes_airport_transfer ? <Text style={styles.detailText}>TRANSFER</Text> : null}
                    </View>
                    <View style={styles.cardFooter}>
                        <View>
                            <Text style={styles.departure}>{fmtDate(item.departure_at)}</Text>
                            <Text style={styles.seats}>{item.seats_remaining} SEATS REMAINING</Text>
                        </View>
                        <View style={styles.priceBlock}>
                            <Text style={styles.priceLabel}>FROM · TTD</Text>
                            <Text style={styles.price}>{fmtAmount(item.price_per_person_cents)}</Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
                    <Ionicons name="chevron-back" size={22} color={LUXE.ice} />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.headerKicker}>ESCAPES</Text>
                    <Text style={styles.headerTitle}>Caribbean Escapes</Text>
                </View>
                <TouchableOpacity
                    onPress={() => navigation.navigate('TravelMyBookings')}
                    style={styles.iconBtnCyan}
                >
                    <Ionicons name="bookmark-outline" size={18} color={LUXE.cyanBright} />
                </TouchableOpacity>
            </View>

            {/* Destination filter chips */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                style={styles.chipsScroll}
            >
                {DESTINATIONS.map(d => {
                    const active = destFilter === d.code;
                    return (
                        <TouchableOpacity
                            key={d.code}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setDestFilter(d.code);
                            }}
                            style={[styles.chip, active && styles.chipActive]}
                        >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={LUXE.cyan} />
                </View>
            ) : error ? (
                <View style={styles.center}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <Text style={[styles.emptyTitle, { color: '#EF4444' }]}>Failed to load</Text>
                    <Text style={styles.emptySub}>{error}</Text>
                    <TouchableOpacity style={styles.glassCta} onPress={() => load()}>
                        <Text style={styles.glassCtaText}>RETRY</Text>
                    </TouchableOpacity>
                </View>
            ) : packages.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="airplane-outline" size={44} color={LUXE.iceFaint} />
                    <Text style={styles.emptyTitle}>No packages yet</Text>
                    <Text style={styles.emptySub}>
                        {destFilter !== 'ALL'
                            ? `No packages to ${DESTINATIONS.find(d => d.code === destFilter)?.label} right now.`
                            : 'New Caribbean packages drop regularly. Check back soon.'}
                    </Text>
                    <TouchableOpacity style={styles.glassCta} onPress={() => navigation.navigate('TravelWaitlist')}>
                        <Text style={styles.glassCtaText}>JOIN WAITLIST</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={packages}
                    keyExtractor={i => i.id}
                    renderItem={renderPackage}
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LUXE.cyan} />}
                    ListFooterComponent={
                        <TouchableOpacity
                            style={styles.waitlistFooter}
                            onPress={() => navigation.navigate('TravelWaitlist')}
                        >
                            <View style={styles.footerDot} />
                            <Text style={styles.waitlistFooterText}>NOTIFY ME OF NEW DESTINATIONS</Text>
                        </TouchableOpacity>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: LUXE.base },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14 },
    iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: LUXE.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: LUXE.glassBorder, alignItems: 'center', justifyContent: 'center' },
    iconBtnCyan: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(91,240,245,0.5)', alignItems: 'center', justifyContent: 'center' },
    headerKicker: { color: LUXE.iceFaint, fontSize: 9, letterSpacing: LUXE.tracking.wide },
    headerTitle: { color: LUXE.ice, fontFamily: LUXE.serifSemi, fontSize: 26, lineHeight: 30, marginTop: 1 },

    chipsScroll: { flexGrow: 0 },
    chips: { paddingHorizontal: 20, gap: 8, paddingBottom: 18 },
    chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, backgroundColor: LUXE.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: LUXE.glassBorder },
    chipActive: { borderColor: 'rgba(91,240,245,0.6)', backgroundColor: 'rgba(52,230,236,0.10)' },
    chipText: { color: LUXE.iceMuted, fontWeight: '500', fontSize: 12, letterSpacing: 0.5 },
    chipTextActive: { color: LUXE.cyanBright },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 },
    emptyTitle: { color: LUXE.ice, fontFamily: LUXE.serif, fontSize: 22 },
    emptySub: { color: LUXE.iceFaint, fontSize: 13, textAlign: 'center', lineHeight: 20 },

    glassCta: { marginTop: 8, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 99, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(91,240,245,0.6)', backgroundColor: 'rgba(52,230,236,0.10)', shadowColor: LUXE.cyan, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 16 },
    glassCtaText: { color: LUXE.cyanBright, fontWeight: '500', fontSize: 11, letterSpacing: 2 },

    list: { padding: 20, gap: 18 },
    card: { borderRadius: 22, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: LUXE.glassBorder, backgroundColor: LUXE.glassFill },
    hero: { height: 172, justifyContent: 'flex-end' },
    heroCaption: { padding: 16 },
    cardRoute: { color: LUXE.iceGhost, fontSize: 9, letterSpacing: 2 },
    cardTitle: { color: LUXE.ice, fontFamily: LUXE.serifSemi, fontSize: 28, lineHeight: 30, marginTop: 2 },
    urgencyBadge: { position: 'absolute', top: 14, right: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: 'rgba(7,7,15,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(239,68,68,0.6)' },
    urgencyText: { color: '#FCA5A5', fontWeight: '500', fontSize: 9, letterSpacing: 1 },

    cardBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
    litHairline: { height: 1, borderRadius: 1, marginBottom: 14 },
    detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16 },
    detailText: { color: LUXE.iceMuted, fontSize: 8.5, letterSpacing: 1.5 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    departure: { color: LUXE.ice, fontFamily: LUXE.serif, fontSize: 17 },
    seats: { color: LUXE.iceFaint, fontSize: 8, letterSpacing: 1.5, marginTop: 3 },
    priceBlock: { alignItems: 'flex-end' },
    priceLabel: { color: LUXE.iceFaint, fontSize: 8, letterSpacing: 2 },
    price: { color: LUXE.platinum, fontWeight: '500', fontSize: 26, fontVariant: ['tabular-nums'], marginTop: 1 },

    waitlistFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: 16 },
    footerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUXE.cyan, shadowColor: LUXE.cyan, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 },
    waitlistFooterText: { color: LUXE.iceMuted, fontSize: 10, letterSpacing: 2 },
});
