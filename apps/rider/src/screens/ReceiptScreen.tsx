import React from 'react';
import {
    View, StyleSheet, TouchableOpacity, ScrollView,
    Dimensions, Platform
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';

import { tokens } from '../design-system/tokens';

const { width, height } = Dimensions.get('window');

// --- Rider Design Tokens (Deprecated local, using tokens) ---
const R = {
    bg: tokens.colors.background.base,
    surface: tokens.colors.background.surface,
    border: tokens.colors.glass.stroke,
    purple: tokens.colors.primary.purple,
    purpleLight: tokens.colors.primary.cyan,
    gold: '#F59E0B',
    green: tokens.colors.status.success,
    white: tokens.colors.text.primary,
    muted: tokens.colors.text.secondary,
};

export function ReceiptScreen({ navigation, route }: any) {
    const { ride } = route.params;
    const insets = useSafeAreaInsets();

    const date = new Date(ride.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const totalFare = ((ride.total_fare_cents || 0) / 100).toFixed(2);
    const distanceKm = ride.distance_meters ? (ride.distance_meters / 1000).toFixed(1) : '—';
    const durationMin = ride.duration_seconds ? Math.round(ride.duration_seconds / 60) : '—';

    const handleDone = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>

                {/* Header Row: [← back circle] */}
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="close" size={24} color="#FFF" />
                </TouchableOpacity>

                {/* Central Card with Dashed Divider */}
                <View style={s.receiptWrapper}>
                    <View style={s.card}>

                        {/* Header: Blue checkmark + "Paid" */}
                        <View style={s.statusHeader}>
                            <View style={[s.checkCircle, { backgroundColor: tokens.colors.primary.cyan }]}>
                                <Ionicons name="checkmark" size={32} color="#FFF" />
                            </View>
                            <Txt variant="headingM" weight="heavy" color={tokens.colors.primary.cyan} style={{ marginTop: 24, letterSpacing: 4 }}>PAID SUCCESS</Txt>
                            <Txt variant="bodyReg" color={R.muted} style={{ marginTop: 8 }}>{dateStr} · {timeStr}</Txt>
                        </View>

                        <View style={s.dashDivider} />

                        {/* Stats Row */}
                        <View style={s.statsRow}>
                            <View style={s.stat}>
                                <Txt variant="headingM" weight="bold" color="#FFF">{distanceKm}</Txt>
                                <Txt variant="small" color={R.muted}>KILOMETERS</Txt>
                            </View>
                            <View style={s.statVerticalLine} />
                            <View style={s.stat}>
                                <Txt variant="headingM" weight="bold" color="#FFF">{durationMin}</Txt>
                                <Txt variant="small" color={R.muted}>MINUTES</Txt>
                            </View>
                        </View>

                        <View style={s.dashDivider} />

                        {/* Breakdown: Base fare, Tip, Total */}
                        <View style={s.breakdown}>
                            <View style={s.row}>
                                <Txt variant="bodyReg" color={R.muted}>Base Fare</Txt>
                                <Txt variant="bodyBold" color="#FFF">${totalFare}</Txt>
                            </View>
                            
                            {ride.wait_fare_cents > 0 && (
                                <View style={s.row}>
                                    <Txt variant="bodyReg" color={R.gold}>Wait Time Surcharge</Txt>
                                    <Txt variant="bodyBold" color={R.gold}>+${(ride.wait_fare_cents / 100).toFixed(2)}</Txt>
                                </View>
                            )}
                            
                            {/* NEW: Split Payment Breakdown (Truth Layer) */}
                            {ride.wallet_deduction_cents > 0 && (
                                <View style={s.splitItem}>
                                    <View style={s.row}>
                                        <Txt variant="small" color="#00FFFF">Wallet Deduction</Txt>
                                        <Txt variant="small" color="#00FFFF">-${(ride.wallet_deduction_cents / 100).toFixed(2)}</Txt>
                                    </View>
                                </View>
                            )}
                            {ride.cash_payment_cents > 0 && (
                                <View style={s.splitItem}>
                                    <View style={s.row}>
                                        <Txt variant="small" color={R.gold}>Cash Paid</Txt>
                                        <Txt variant="small" color={R.gold}>${(ride.cash_payment_cents / 100).toFixed(2)}</Txt>
                                    </View>
                                </View>
                            )}

                            <View style={s.row}>
                                <Txt variant="bodyReg" color={R.muted}>Tip</Txt>
                                <Txt variant="bodyBold" color="#FFF">$0.00</Txt>
                            </View>
                            <View style={[s.row, { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }]}>
                                <Txt variant="headingM" weight="heavy" color="#FFF">Total</Txt>
                                <Txt variant="headingM" weight="heavy" color={R.gold}>${(( (ride.total_fare_cents || 0) + (ride.wait_fare_cents || 0) ) / 100).toFixed(2)}</Txt>
                            </View>
                        </View>

                        <View style={s.dashDivider} />

                        {/* Address Summary */}
                        <View style={s.addresses}>
                            <View style={s.addrRow}>
                                <View style={[s.marker, { backgroundColor: R.purple }]} />
                                <Txt variant="small" color={R.muted} numberOfLines={1} style={{ flex: 1, marginLeft: 12 }}>{ride.pickup_address}</Txt>
                            </View>
                            <View style={s.addrRow}>
                                <View style={[s.marker, { backgroundColor: R.gold }]} />
                                <Txt variant="small" color={R.muted} numberOfLines={1} style={{ flex: 1, marginLeft: 12 }}>{ride.dropoff_address}</Txt>
                            </View>
                        </View>

                        <View style={s.footer}>
                            <Txt variant="small" color={R.muted} style={{ textAlign: 'center' }}>Thanks for riding with G-Taxi</Txt>
                        </View>

                    </View>
                </View>

                <TouchableOpacity style={s.doneBtn} onPress={handleDone}>
                    <Txt variant="headingM" weight="heavy" color={tokens.colors.primary.cyan}>BACK TO HOME</Txt>
                </TouchableOpacity>

            </ScrollView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    scroll: { flexGrow: 1, paddingHorizontal: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },

    receiptWrapper: { flex: 1, justifyContent: 'center' },
    card: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 40, padding: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },

    statusHeader: { alignItems: 'center', marginBottom: 40 },
    checkCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', shadowColor: tokens.colors.primary.cyan, shadowRadius: 20, shadowOpacity: 0.4 },

    dashDivider: { height: 1.5, width: '120%', marginLeft: '-10%', borderStyle: 'dotted', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginVertical: 32 },

    statsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    stat: { alignItems: 'center' },
    statVerticalLine: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.05)' },

    breakdown: { gap: 16 },
    splitItem: { backgroundColor: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

    addresses: { gap: 16 },
    addrRow: { flexDirection: 'row', alignItems: 'center' },
    marker: { width: 10, height: 10, borderRadius: 5 },

    footer: { marginTop: 40 },
    doneBtn: { alignSelf: 'center', marginTop: 48, padding: 20 },
});
