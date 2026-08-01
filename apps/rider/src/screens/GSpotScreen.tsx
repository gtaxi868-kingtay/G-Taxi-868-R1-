import React, { useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';
import { useGSpot, type GSpotVenue, type GSpotRedeemCode } from '../hooks/useGSpot';

const rider = VOICES.rider;

const formatTTD = (cents: number) => `$${(cents / 100).toFixed(2)} TTD`;

export function GSpotScreen({ navigation }: AppScreenProps<'GSpot'>) {
    const insets = useSafeAreaInsets();
    const { venues, memberships, loading, refreshing, busy, refresh, join, cancel, generateRedeemCode } = useGSpot();
    const [activeCode, setActiveCode] = useState<GSpotRedeemCode | null>(null);

    const activeMembership = memberships.find((m) => m.status === 'active');

    const onJoin = async (venue: GSpotVenue) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
            'Join G Spot',
            `Join ${venue.name} for ${formatTTD(venue.membership_price_cents)}/month, charged to your wallet now?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Join',
                    onPress: async () => {
                        const result = await join(venue.id);
                        if (!result.success) {
                            Alert.alert('Error', result.error || 'Join failed');
                            return;
                        }
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    },
                },
            ],
        );
    };

    const onCancel = async () => {
        if (!activeMembership) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert('Cancel Membership', 'This ends your G Spot membership at the end of this billing cycle. Continue?', [
            { text: 'Keep Membership', style: 'cancel' },
            {
                text: 'Cancel Membership',
                style: 'destructive',
                onPress: async () => {
                    const result = await cancel(activeMembership.id);
                    if (!result.success) Alert.alert('Error', result.error || 'Cancel failed');
                    else setActiveCode(null);
                },
            },
        ]);
    };

    const onShowCode = async () => {
        if (!activeMembership) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const result = await generateRedeemCode(activeMembership.id);
        if (!result.success || !result.code) {
            Alert.alert('Error', result.error || 'Could not generate code');
            return;
        }
        setActiveCode(result.code);
    };

    const subsidyRemaining = activeMembership
        ? activeMembership.drink_subsidy_cap_cents - activeMembership.drink_subsidy_used_cents
        : 0;

    if (loading) {
        return (
            <View style={[s.root, s.center]}>
                <ActivityIndicator size="large" color={rider.accent} />
            </View>
        );
    }

    return (
        <View style={s.root}>
            <StatusBar style="light" />
            <View style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color={rider.text} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>G Spot</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView
                contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={rider.accent} />}
            >
                <Text style={s.heading}>Bar membership, on your wallet</Text>
                <Text style={s.subheading}>
                    Pickup, dropoff, and discounted drinks at a partnered venue — billed to your wallet each month.
                </Text>

                {activeMembership && (
                    <View style={[s.card, ghostBorder(0.15)]}>
                        <View style={s.membershipBadge}>
                            <Ionicons name="wine" size={16} color={SURFACE.base} />
                            <Text style={s.membershipBadgeText}>ACTIVE MEMBER</Text>
                        </View>
                        <Text style={s.venueName}>{activeMembership.venue?.name}</Text>
                        <Text style={s.venueAddress}>{activeMembership.venue?.address}</Text>

                        <View style={s.statsRow}>
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: rider.platinum }]}>{formatTTD(subsidyRemaining)}</Text>
                                <Text style={s.statLabel}>Drink Credit Left</Text>
                            </View>
                            <View style={s.statSep} />
                            <View style={s.statBox}>
                                <Text style={[s.statValue, { color: rider.platinum }]}>{formatTTD(activeMembership.monthly_price_cents)}</Text>
                                <Text style={s.statLabel}>Per Month</Text>
                            </View>
                        </View>

                        {activeCode ? (
                            <View style={s.codeBox}>
                                <Text style={s.codeLabel}>SHOW THIS AT THE BAR</Text>
                                <Text style={s.codeValue}>{activeCode.code}</Text>
                                <Text style={s.codeExpiry}>Expires {new Date(activeCode.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                            </View>
                        ) : (
                            <TouchableOpacity onPress={onShowCode} disabled={busy} style={[s.primaryCta, busy && { opacity: 0.5 }]}>
                                {busy ? <ActivityIndicator color={SURFACE.base} size="small" /> : (
                                    <>
                                        <Ionicons name="qr-code" size={18} color={SURFACE.base} style={{ marginRight: 8 }} />
                                        <Text style={s.primaryCtaText}>SHOW CODE AT BAR</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity onPress={onCancel} style={s.secondaryCta}>
                            <Text style={s.secondaryCtaText}>Cancel Membership</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!activeMembership && (
                    <>
                        <Text style={s.sectionLabel}>PARTNERED VENUES</Text>
                        {venues.length === 0 ? (
                            <View style={[s.card, ghostBorder(0.15), { alignItems: 'center' }]}>
                                <Ionicons name="wine-outline" size={40} color={rider.textMuted} />
                                <Text style={[s.subheading, { textAlign: 'center', marginTop: 12, marginBottom: 0 }]}>
                                    No venues open for membership yet — check back soon.
                                </Text>
                            </View>
                        ) : venues.map((venue) => (
                            <View key={venue.id} style={[s.card, ghostBorder(0.15)]}>
                                <Text style={s.venueName}>{venue.name}</Text>
                                <Text style={s.venueAddress}>{venue.address}</Text>
                                <View style={s.statsRow}>
                                    <View style={s.statBox}>
                                        <Text style={[s.statValue, { color: rider.platinum }]}>{formatTTD(venue.membership_price_cents)}</Text>
                                        <Text style={s.statLabel}>Per Month</Text>
                                    </View>
                                    <View style={s.statSep} />
                                    <View style={s.statBox}>
                                        <Text style={[s.statValue, { color: rider.platinum }]}>{formatTTD(venue.drink_subsidy_cap_cents)}</Text>
                                        <Text style={s.statLabel}>Drink Credit/Mo</Text>
                                    </View>
                                </View>
                                <TouchableOpacity onPress={() => onJoin(venue)} disabled={busy} style={[s.primaryCta, busy && { opacity: 0.5 }]}>
                                    {busy ? <ActivityIndicator color={SURFACE.base} size="small" /> : (
                                        <Text style={s.primaryCtaText}>JOIN — CHARGED TO WALLET</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ))}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: SURFACE.base },
    center: { justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '800', color: rider.text },
    scroll: { paddingHorizontal: 20 },

    heading: { fontSize: 24, fontWeight: '800', color: rider.text, marginBottom: 8 },
    subheading: { fontSize: 14, color: rider.textMuted, lineHeight: 20, marginBottom: 24 },
    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: rider.textMuted, marginBottom: 14, textTransform: 'uppercase' },

    card: { backgroundColor: SURFACE.containerLow, borderRadius: 24, padding: 24, marginBottom: 16 },
    membershipBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: rider.accent, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 16 },
    membershipBadgeText: { fontSize: 12, fontWeight: '800', color: SURFACE.base, letterSpacing: 1 },
    venueName: { fontSize: 22, fontWeight: '800', color: rider.text, marginBottom: 4 },
    venueAddress: { fontSize: 13, color: rider.textMuted, marginBottom: 20 },

    statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, marginBottom: 20, alignItems: 'center' },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
    statLabel: { fontSize: 11, color: rider.textMuted, textAlign: 'center' },
    statSep: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.1)' },

    primaryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: rider.accent, borderRadius: 14, paddingVertical: 14 },
    primaryCtaText: { fontSize: 14, fontWeight: '800', color: SURFACE.base, letterSpacing: 0.5 },
    secondaryCta: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    secondaryCtaText: { fontSize: 13, fontWeight: '700', color: rider.textMuted },

    codeBox: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 20, marginBottom: 8 },
    codeLabel: { fontSize: 11, fontWeight: '700', color: rider.textMuted, letterSpacing: 1.5, marginBottom: 8 },
    codeValue: { fontSize: 36, fontWeight: '900', color: rider.accent, letterSpacing: 6, fontFamily: 'monospace' },
    codeExpiry: { fontSize: 11, color: rider.textMuted, marginTop: 8 },
});
