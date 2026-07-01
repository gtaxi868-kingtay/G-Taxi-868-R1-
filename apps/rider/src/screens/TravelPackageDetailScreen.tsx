import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import type { AppScreenProps } from '../navigation/types';

function fmtPrice(cents: number) {
    return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-TT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const DEST_EXPERIENCES: Record<string, { tagline: string; highlights: string[] }> = {
    BGI: {
        tagline: "Where the Caribbean begins",
        highlights: [
            "Carlisle Bay at sunrise — turquoise water, zero crowds",
            "Oistins fish fry — real local flavour, no tourist pricing",
            "Crane Beach sunset — the photo that makes everyone ask where you went",
        ],
    },
    GND: {
        tagline: "The island they haven't overrun yet",
        highlights: [
            "Grand Anse Beach — 3km of near-empty white sand on a working budget",
            "St George's spice market — nutmeg, colour, and no tourist tax",
            "Secret waterfall hike — 45 min in, worth every step",
        ],
    },
    TAB: {
        tagline: "Home, but on island time",
        highlights: [
            "Pigeon Point at sunrise — the T&T you've been sleeping on",
            "Nylon Pool — standing in the middle of the sea, clear as glass",
            "Buccoo Reef snorkel — your first time underwater",
        ],
    },
    ANU: {
        tagline: "365 beaches — pick your own",
        highlights: [
            "Half Moon Bay — no bar, no crowd, just the beach",
            "Nelson's Dockyard — UNESCO history you can walk through",
            "Shirley Heights Sunday — every local on the same hilltop at sunset",
        ],
    },
    SKB: {
        tagline: "The Caribbean with no attitude",
        highlights: [
            "Brimstone Hill Fortress — volcanic ridge with a colonial fort on top",
            "Frigate Bay strip — local rum at Caribbean prices",
            "South Peninsula road — Atlantic on one side, Caribbean on the other",
        ],
    },
    SLU: {
        tagline: "Two volcanoes, one island",
        highlights: [
            "The Pitons at dawn — the most dramatic view in the Caribbean",
            "Sulfur Springs drive-in volcano — nothing like it anywhere else",
            "Marigot Bay — superyachts and local fishing boats side by side",
        ],
    },
};

export function TravelPackageDetailScreen({ route, navigation }: AppScreenProps<'TravelPackageDetail'>) {
    const { packageId } = route.params;
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [pkg, setPkg] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [travelerCount, setTravelerCount] = useState(1);
    const [booking, setBooking] = useState(false);
    const [walletBalance, setWalletBalance] = useState<number | null>(null);

    const fetchPkg = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('travel', {
                body: { action: 'get_packages', package_id: packageId },
            });
            if (fnErr) throw fnErr;
            const found = data?.packages?.[0];
            if (found) {
                setPkg(found);
            } else {
                setError('This package is no longer available.');
            }
        } catch (err: any) {
            setError(err?.message || 'Could not load package details. Check your connection.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const fetchPkgOnMount = async () => {
            await fetchPkg();
        };

        const fetchWallet = async () => {
            if (!user) return;
            const { data } = await supabase
                .from('wallets')
                .select('balance_cents')
                .eq('user_id', user.id)
                .single();
            if (data) setWalletBalance(data.balance_cents);
        };

        fetchPkgOnMount();
        fetchWallet();
    }, [packageId, user]);

    const totalCents = pkg ? pkg.price_per_person_cents * travelerCount : 0;
    const canAfford = walletBalance !== null ? walletBalance >= totalCents : false;

    const handleBook = async () => {
        if (!pkg || !user) return;

        Alert.alert(
            'Confirm Booking',
            `${travelerCount} traveler${travelerCount > 1 ? 's' : ''} to ${pkg.destination_name}\n\nTotal: ${fmtPrice(totalCents)}\n\nPaid from wallet.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Book Now',
                    onPress: async () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        setBooking(true);
                        try {
                            const { data, error } = await supabase.functions.invoke('travel', {
                                body: { action: 'book_travel_package', package_id: packageId, traveler_count: travelerCount, payment_method: 'wallet' },
                            });
                            if (error || data?.error) throw new Error(error?.message || data?.error);
                            navigation.replace('TravelBookingConfirmation', {
                                bookingId: data.booking_id,
                                packageTitle: pkg.title,
                                totalCents,
                                travelerCount,
                                departureAt: pkg.departure_at,
                                airportTransferRideId: data.airport_transfer_ride_id,
                            });
                        } catch (err: any) {
                            const code = err.message?.includes('SOLD_OUT') ? 'This package just sold out.' :
                                err.message?.includes('INSUFFICIENT') ? 'Insufficient wallet balance. Please top up.' :
                                err.message || 'Booking failed. Please try again.';
                            Alert.alert('Booking Failed', code);
                        } finally {
                            setBooking(false);
                        }
                    },
                },
            ]
        );
    };

    if (loading) {
        return (
            <View style={[styles.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color="#34E6EC" />
            </View>
        );
    }

    if (error || !pkg) {
        return (
            <View style={[styles.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }]}>
                <Ionicons name="cloud-offline-outline" size={48} color="rgba(255,255,255,0.3)" />
                <Text style={{ color: '#EAF3F6', fontSize: 17, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
                    {error || 'Package not found'}
                </Text>
                <TouchableOpacity
                    onPress={fetchPkg}
                    style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#6D28D9', borderRadius: 12 }}
                >
                    <Text style={{ color: '#EAF3F6', fontWeight: '700' }}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const flightInfo = pkg.flight_info || {};
    const hotelInfo = pkg.hotel_info || {};
    const destCode = pkg.destination_code as string;
    const experience = DEST_EXPERIENCES[destCode] ?? null;

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color="#EAF3F6" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{pkg.origin_code} → {pkg.destination_code}</Text>
            </View>

            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}>
                {/* Title card */}
                <LinearGradient
                    colors={['rgba(52,230,236,0.2)', 'rgba(52,230,236,0.05)']}
                    style={styles.titleCard}
                >
                    <Text style={styles.title}>{pkg.title}</Text>
                    <Text style={styles.destination}>{pkg.destination_name}</Text>
                    <View style={styles.departurePill}>
                        <Ionicons name="calendar-outline" size={14} color="#34E6EC" />
                        <Text style={styles.departureText}>Departs {fmtDate(pkg.departure_at)}</Text>
                    </View>
                    <Text style={styles.seatsLeft}>{pkg.seats_remaining} seats remaining</Text>
                </LinearGradient>

                {/* ── EXPERIENCE FIRST (Jobs' sequence) ───────────────────────────── */}
                {experience && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>WHY YOU'LL GO BACK</Text>
                        <LinearGradient
                            colors={['rgba(200,169,110,0.12)', 'rgba(200,169,110,0.04)']}
                            style={styles.experienceCard}
                        >
                            <Text style={styles.experienceTagline}>"{experience.tagline}"</Text>
                            <View style={styles.highlightList}>
                                {experience.highlights.map((h, i) => (
                                    <View key={i} style={styles.highlightRow}>
                                        <View style={styles.highlightDot} />
                                        <Text style={styles.highlightText}>{h}</Text>
                                    </View>
                                ))}
                            </View>
                        </LinearGradient>
                    </View>
                )}
                {/* ──────────────────────────────────────────────────────────────────── */}

                {/* Price per person — shown after experience, not before */}
                <View style={[styles.section, { marginBottom: 8 }]}>
                    <View style={styles.priceRow}>
                        <View>
                            <Text style={styles.priceLabel}>Price per person</Text>
                            <Text style={styles.priceValue}>{fmtPrice(pkg.price_per_person_cents)}</Text>
                        </View>
                        <View style={styles.includesFlag}>
                            <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
                            <Text style={styles.includesFlagText}>flights + hotel included</Text>
                        </View>
                    </View>
                </View>

                {/* Flight info */}
                {(flightInfo.airline || flightInfo.flight_number) && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>FLIGHT</Text>
                        <View style={styles.infoCard}>
                            <InfoRow icon="airplane-outline" label="Airline" value={flightInfo.airline || 'Caribbean Airlines'} />
                            {flightInfo.flight_number && <InfoRow icon="barcode-outline" label="Flight" value={flightInfo.flight_number} />}
                            <InfoRow icon="layers-outline" label="Class" value={flightInfo.cabin || 'Economy'} />
                            {flightInfo.return_flight && <InfoRow icon="airplane-outline" label="Return" value={flightInfo.return_flight} />}
                        </View>
                    </View>
                )}

                {/* Hotel info */}
                {(hotelInfo.name || hotelInfo.nights) && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>ACCOMMODATION</Text>
                        <View style={styles.infoCard}>
                            {hotelInfo.name && <InfoRow icon="bed-outline" label="Hotel" value={hotelInfo.name} />}
                            {hotelInfo.nights && <InfoRow icon="moon-outline" label="Nights" value={`${hotelInfo.nights} nights`} />}
                            {hotelInfo.room_type && <InfoRow icon="key-outline" label="Room" value={hotelInfo.room_type} />}
                            {hotelInfo.board && <InfoRow icon="restaurant-outline" label="Board" value={hotelInfo.board} />}
                        </View>
                    </View>
                )}

                {/* What's included */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>WHAT'S INCLUDED</Text>
                    <View style={styles.infoCard}>
                        <IncludeRow icon="airplane" label="Return flights from POS" />
                        <IncludeRow icon="bed" label="Hotel accommodation" />
                        {pkg.includes_airport_transfer && <IncludeRow icon="car" label="G-Taxi airport transfer" />}
                        <IncludeRow icon="shield-checkmark" label="G-Taxi booking guarantee" />
                    </View>
                </View>

                {/* Traveler count */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>TRAVELERS</Text>
                    <View style={[styles.infoCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 }]}>
                        <Text style={{ color: '#EAF3F6', fontWeight: '600', fontSize: 15 }}>Number of travelers</Text>
                        <View style={styles.counter}>
                            <TouchableOpacity
                                onPress={() => { if (travelerCount > 1) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTravelerCount(t => t - 1); } }}
                                style={styles.counterBtn}
                            >
                                <Ionicons name="remove" size={18} color="#EAF3F6" />
                            </TouchableOpacity>
                            <Text style={styles.counterVal}>{travelerCount}</Text>
                            <TouchableOpacity
                                onPress={() => { if (travelerCount < Math.min(pkg.seats_remaining, 10)) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTravelerCount(t => t + 1); } }}
                                style={styles.counterBtn}
                            >
                                <Ionicons name="add" size={18} color="#EAF3F6" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Wallet balance info */}
                {walletBalance !== null && (
                    <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
                        <Text style={{ color: walletBalance >= totalCents ? 'rgba(255,255,255,0.4)' : '#EF4444', fontSize: 13 }}>
                            Wallet balance: {fmtPrice(walletBalance)}
                            {walletBalance < totalCents ? '  — insufficient, please top up' : ''}
                        </Text>
                    </View>
                )}
            </ScrollView>

            {/* Book CTA */}
            <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
                <View>
                    <Text style={styles.ctaLabel}>Total for {travelerCount} traveler{travelerCount > 1 ? 's' : ''}</Text>
                    <Text style={styles.ctaPrice}>{fmtPrice(totalCents)}</Text>
                </View>
                <TouchableOpacity
                    style={[styles.ctaBtn, (!canAfford || booking) && { opacity: 0.5 }]}
                    onPress={handleBook}
                    disabled={!canAfford || booking}
                >
                    {booking ? (
                        <ActivityIndicator size="small" color="#EAF3F6" />
                    ) : (
                        <Text style={styles.ctaBtnText}>Book Now</Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
            <Ionicons name={icon as any} size={18} color="rgba(255,255,255,0.4)" />
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, flex: 1 }}>{label}</Text>
            <Text style={{ color: '#EAF3F6', fontWeight: '600', fontSize: 13 }}>{value}</Text>
        </View>
    );
}

function IncludeRow({ icon, label }: { icon: string; label: string }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
            <Ionicons name={icon as any} size={18} color="#22C55E" />
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#07070F' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: 'rgba(255,255,255,0.6)', fontWeight: '700', fontSize: 16 },
    scroll: { paddingTop: 8 },
    titleCard: { marginHorizontal: 20, borderRadius: 24, padding: 24, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(52,230,236,0.2)' },
    title: { color: '#EAF3F6', fontWeight: '800', fontSize: 22 },
    destination: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4 },
    departurePill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, backgroundColor: 'rgba(52,230,236,0.12)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
    departureText: { color: '#34E6EC', fontSize: 13, fontWeight: '600' },
    seatsLeft: { color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 8 },
    section: { marginBottom: 20, paddingHorizontal: 20 },
    sectionTitle: { color: 'rgba(255,255,255,0.3)', fontWeight: '700', fontSize: 11, letterSpacing: 2, marginBottom: 8 },
    infoCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
    counter: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    counterBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
    counterVal: { color: '#EAF3F6', fontWeight: '700', fontSize: 18, minWidth: 28, textAlign: 'center' },
    ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, backgroundColor: 'rgba(10,10,15,0.95)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
    ctaLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
    ctaPrice: { color: '#EAF3F6', fontWeight: '800', fontSize: 22 },
    ctaBtn: { backgroundColor: '#6D28D9', borderRadius: 20, paddingHorizontal: 32, paddingVertical: 16 },
    ctaBtnText: { color: '#EAF3F6', fontWeight: '800', fontSize: 16 },
    experienceCard: { borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(200,169,110,0.2)' },
    experienceTagline: { color: '#C8A96E', fontWeight: '700', fontSize: 17, fontStyle: 'italic', marginBottom: 16, lineHeight: 24 },
    highlightList: { gap: 12 },
    highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    highlightDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C8A96E', marginTop: 6, flexShrink: 0 },
    highlightText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, flex: 1 },
    priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 20, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
    priceLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 2 },
    priceValue: { color: '#EAF3F6', fontWeight: '800', fontSize: 24 },
    includesFlag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    includesFlagText: { color: '#22C55E', fontSize: 12, fontWeight: '600' },
});
